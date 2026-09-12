// acp.mjs — mcode acp JSON-RPC client (Node stdio, zero deps)
//
// Spawns `mcode acp` (Agent Client Protocol server) and exposes:
//   - request(method, params)  → Promise<result>
//   - notify(method, params)   → fire-and-forget
//   - on(event, handler)       → subscribe to server notifications
//   - newSession(cwd)          → {sessionId}
//   - loadSession(sid, cwd)    → {} (attach to any TUI session, 0.1.3+)
//   - listSessions()           → {sessions: [{sessionId, cwd, title, updatedAt}], nextCursor}
//   - prompt(sid, text, cbs)   → full lifecycle: init → stream chunks → stopReason
//   - stop()                   → kill subprocess
//
// Event types from mcode 0.1.3 (verified via probe):
//   - session/update {sessionUpdate: "available_commands_update"} → list of slash cmds
//   - session/update {sessionUpdate: "agent_thought_chunk"} → {messageId, content: {type, text}}
//   - session/update {sessionUpdate: "agent_message_chunk"} → {messageId, content: {type, text}}
//   - prompt response: {stopReason: "end_turn" | "max_tokens" | "refusal" | ...}
//
// v1.1 (mcode 0.3/0.4 compat, probed against 0.4.2 — see docs/acp-probe-0.4.md):
//   - extension control plane moved to the `mcode/session/*` namespace; all
//     queue/goal/steer wrappers go through extRequest() which falls back to
//     the legacy bare names on "Method not found" (0.2.x compatibility)
//   - session/cancel is GONE in 0.3+ → cancel() falls back to
//     session/close (aborts the turn, prompt resolves stopReason:"cancelled")
//     + immediate session/load re-attach
//   - set_mode takes `modeId` (0.2.4 took `mode`); resume/fork need `cwd`
//   - standalone mcode/session/{queue,goal,delegation,current_session}_update
//     notifications are normalized into sessionUpdate-shaped events
//   - session/request_permission (server→client request) is auto-answered
//     with {outcome:{outcome:"cancelled"}} and surfaced via 'serverRequest'

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_CWD = process.cwd()

// v1.0: mcode 可执行文件动态解析 — 之前硬编码 C:\Users\<author>\... 绝对路径,
//   插件分发到别人机器上必然失效。优先级: env MCODE_CMD > ~/.minimax-code/mcode.cmd > PATH 里的 mcode
function resolveMcodeCmd() {
  if (process.env.MCODE_CMD) return process.env.MCODE_CMD
  if (process.platform === 'win32') {
    const p = join(homedir(), '.minimax-code', 'mcode.cmd')
    if (existsSync(p)) return p
  }
  return 'mcode'
}

export class McodeAcpClient extends EventEmitter {
  constructor({ mcodeCmd = 'mcode', cwd = DEFAULT_CWD, debug = false } = {}) {
    super()
    this.mcodeCmd = mcodeCmd
    this.cwd = cwd
    this.debug = debug
    this.child = null
    this.buf = ''
    this.nextId = 0
    this.pending = new Map()  // id → {resolve, reject, method}
    this.capabilities = null
    this.started = false
    // v1.1: extension-method namespace discovered at runtime
    //   null = unknown, 'mcode' = 0.3+ (mcode/session/*), 'legacy' = 0.2.x (session/*)
    this.extNamespace = null
    this.sessionCwds = new Map()   // sessionId → cwd (resume/fork/cancel-reload need it)
    this.sessionConfigs = new Map() // sessionId → 最新 configOptions（model/permissionMode 下拉数据源）
    this._setModeShape = null      // 'modeId' (0.3+) | 'mode' (0.2.x)
    this._setConfigShape = null    // 'configId' (0.3+) | 'key' (0.2.x)
  }

  // 最新一次已知的 session configOptions（session/new、load、set_config_option
  // 响应和 config_option_update 通知都会刷新它）
  getSessionConfigOptions(sessionId) {
    return this.sessionConfigs.get(sessionId) || null
  }
  _trackConfigOptions(sessionId, r) {
    if (sessionId && Array.isArray(r?.configOptions)) {
      this.sessionConfigs.set(sessionId, r.configOptions)
    }
    return r
  }

  // JSON-RPC error classifiers (mcode returns -32601/"Method not found" for
  // unregistered methods and -32602/"Invalid params" for shape mismatches)
  isMethodNotFound(e) {
    return e?.code === -32601 || /Method not found/i.test(e?.message || '')
  }
  isInvalidParams(e) {
    return e?.code === -32602 || /Invalid params/i.test(e?.message || '')
  }

  // Extension methods: try the 0.3+ `mcode/session/*` name first, fall back
  // to the 0.2.x bare name when the server reports Method not found.
  async extRequest(newName, legacyName, params) {
    if (this.extNamespace !== 'legacy') {
      try {
        const r = await this.request(newName, params)
        this.extNamespace = 'mcode'
        return r
      } catch (e) {
        if (!legacyName || !this.isMethodNotFound(e)) throw e
        // fall through to the legacy name
      }
    }
    const r = await this.request(legacyName, params)
    this.extNamespace = 'legacy'
    return r
  }

  // 启动 subprocess + initialize + 解析 capabilities
  async start() {
    if (this.started) return this.capabilities
    // Windows: 直接 spawn mcode.cmd（Node CreateProcess 知道 .cmd shim，不用 cmd.exe 套）
    //   - cmd.exe /c mcode 会输出 Windows 横幅污染 stdout JSON 解析
    // Linux/macOS: spawn 'mcode' 走 PATH
    // Windows: spawn('cmd.exe', ['/c', 'mcode.cmd', 'acp']) 是 node probe 验证能 work 的姿势
    //  - 直接 spawn mcode.cmd + shell:false → Node 22+ EINVAL（不让直接 CreateProcess .cmd）
    //  - shell:true → Node 内置 cmd.exe 解释，但会输出 Windows 横幅污染 JSON
    //  - cmd.exe /c <.cmd> → cmd.exe 作为父进程，不解释不打印横幅，只 exec mcode.cmd
    const args = process.platform === 'win32'
      ? ['/c', resolveMcodeCmd(), 'acp']
      : ['acp']
    const cmd = process.platform === 'win32' ? 'cmd.exe' : 'mcode'
    this.child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,  // 关键：false 让 cmd.exe 不打印横幅
    })
    this.child.on('error', (e) => this.emit('error', e))
    this.child.on('exit', (code, signal) => {
      this.emit('exit', { code, signal })
      // 拒绝所有 pending
      for (const [id, p] of this.pending) {
        p.reject(new Error(`mcode acp exited (code=${code} signal=${signal})`))
      }
      this.pending.clear()
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk) => this._onData(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (c) => {
      if (this.debug) process.stderr.write('[acp stderr] ' + c)
    })
    // initialize
    this.capabilities = await this.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'mcode-webui', version: '0.1.0' },
      capabilities: { mcpCapabilities: { http: false, sse: false } },
    })
    this.started = true
    return this.capabilities
  }

  get cmd() {
    return process.platform === 'win32' ? resolveMcodeCmd() : 'mcode'
  }

  // 解析 stdout（每行一条 JSON）
  _onData(chunk) {
    this.buf += chunk
    let nl
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      this._dispatch(line)
    }
  }

  _dispatch(line) {
    let msg
    try { msg = JSON.parse(line) } catch (e) {
      if (this.debug) process.stderr.write('[acp] non-json line: ' + line + '\n')
      return
    }
    // 响应（带 id）
    if (typeof msg.id !== 'undefined' && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'acp error'), { data: msg.error }))
        else p.resolve(msg.result)
      }
      return
    }
    // notification（method 但无 id）
    if (msg.method) {
      // server→client REQUEST（必须应答，否则 mcode 会挂起等待）。
      // session/request_permission: 默认保守拒绝（cancelled），同时上抛
      // 'serverRequest' 事件供上层做 UI 确认。
      if (typeof msg.id !== 'undefined') {
        this.emit('serverRequest', { id: msg.id, method: msg.method, params: msg.params })
        if (msg.method === 'session/request_permission') {
          try {
            this.child.stdin.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { outcome: { outcome: 'cancelled' } },
            }) + '\n')
          } catch {}
        }
        return
      }
      // v1.1: mcode 0.3+ 把控制面推送从 session/update 的 sessionUpdate
      // 变体改成独立通知 mcode/session/*_update。归一化成原来的
      // sessionUpdate 形状，下游（mcode-acp.js）零改动。
      if (msg.method.startsWith('mcode/session/')) {
        const rest = msg.method.slice('mcode/session/'.length)
        if (rest.endsWith('_update')) {
          const u = { sessionUpdate: rest, ...(msg.params || {}) }
          this.emit('notification', { jsonrpc: '2.0', method: 'session/update', params: { sessionId: msg.params?.sessionId, update: u } })
          this.emit('sessionUpdate', u)
          this.emit(rest, u)
        }
      }
      // 内部 raw 事件
      this.emit('notification', msg)
      // 细粒度事件
      if (msg.method === 'session/update' && msg.params?.update) {
        const u = msg.params.update
        if (u.sessionUpdate === 'config_option_update' && msg.params.sessionId) {
          this._trackConfigOptions(msg.params.sessionId, { configOptions: u.configOptions })
        }
        this.emit('sessionUpdate', u)
        if (u.sessionUpdate) this.emit(u.sessionUpdate, u)
      } else {
        this.emit(msg.method, msg.params)
      }
    }
  }

  // 通用 request
  request(method, params) {
    if (!this.child) return Promise.reject(new Error('acp not started'))
    const id = ++this.nextId
    const msg = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      try {
        this.child.stdin.write(JSON.stringify(msg) + '\n')
      } catch (e) {
        this.pending.delete(id)
        reject(new Error(`acp write failed: ${e.message}`))
      }
    })
  }

  notify(method, params) {
    if (!this.child) throw new Error('acp not started')
    const msg = { jsonrpc: '2.0', method, params }
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  // --- 高级 API ---

  async newSession(cwd = this.cwd) {
    const r = await this.request('session/new', { cwd, mcpServers: [] })
    if (r?.sessionId) {
      this.sessionCwds.set(r.sessionId, cwd)
      this._trackConfigOptions(r.sessionId, r)
    }
    return r
  }

  async loadSession(sessionId, cwd = this.cwd) {
    const r = await this.request('session/load', { sessionId, cwd, mcpServers: [] })
    this.sessionCwds.set(sessionId, cwd)
    this._trackConfigOptions(sessionId, r)
    return r
  }

  async listSessions(cursor) {
    return await this.request('session/list', cursor ? { cursor } : {})
  }

  // --- v1.0.2: mcode 0.2.4 新增控制面 RPC 包装 ---
  // 真实方法名从 cli.js bundle grep 验证 (参见 plan.md Summary 节)
  // 所有方法都返回 Promise, 失败 reject (error.message 含 "Method not found" 时上层走 graceful path)

  // 取消当前运行中的 turn — 温和取消, mcode 自己 finalize, 进程保留
  // v1.1: mcode 0.3+ 移除了 session/cancel。替代路径（probe 实测）:
  //   session/close 会让运行中的 prompt 以 stopReason:"cancelled" 返回，
  //   随后立刻 session/load 重新挂载，后续 prompt 无需额外操作。
  async cancel(sessionId, cwd) {
    try {
      return await this.request('session/cancel', { sessionId })
    } catch (e) {
      if (!this.isMethodNotFound(e)) throw e
      await this.request('session/close', { sessionId })
      const useCwd = cwd || this.sessionCwds.get(sessionId) || this.cwd
      return await this.request('session/load', { sessionId, cwd: useCwd, mcpServers: [] })
    }
  }

  // 从指定消息分叉新会话 — 返回新 sessionId
  // v1.1: mcode 0.3+ 的 fork 是整会话分叉（无 atMessageId 参数）且需要
  // cwd；保留 v1.0.x 的 (sessionId, atMessageId) 签名，0.2.x 仍带消息位。
  async fork(sessionId, atMessageId, cwd) {
    const useCwd = cwd || this.sessionCwds.get(sessionId) || this.cwd
    const params = { sessionId, cwd: useCwd }
    if (atMessageId !== undefined && atMessageId !== null) params.atMessageId = atMessageId
    try {
      const r = await this.request('session/fork', params)
      if (r?.sessionId) this.sessionCwds.set(r.sessionId, useCwd)
      return r
    } catch (e) {
      if (!this.isInvalidParams(e) || atMessageId === undefined) throw e
      // 0.3+ 不认识 atMessageId（unknown stripped，不至于 Invalid params）；
      // 走到这里多半是 0.2.x 要求消息位而 cwd 多余 — 试裸形状。
      return await this.request('session/fork', { sessionId, atMessageId })
    }
  }

  // 接续已存在的 mcode session — 重载 transcript, 不重启 client
  // v1.1: 0.3+ 要求 {sessionId, cwd, mcpServers}，裸 {sessionId} → Invalid params
  async resume(sessionId, cwd) {
    const useCwd = cwd || this.sessionCwds.get(sessionId) || this.cwd
    try {
      const r = await this.request('session/resume', { sessionId, cwd: useCwd, mcpServers: [] })
      this.sessionCwds.set(sessionId, useCwd)
      return this._trackConfigOptions(sessionId, r)
    } catch (e) {
      if (!this.isInvalidParams(e)) throw e
      return await this.request('session/resume', { sessionId })
    }
  }

  // 激活 session（Session Center 语义; 0.3+）
  async activate(sessionId) {
    return await this.request('session/activate', { sessionId })
  }

  // 关闭 session 的 ACP 视图（0.3+）。turn 运行中调用 = 取消（prompt 以
  // stopReason:"cancelled" 返回）。会话本身仍留在 session/list 里。
  async closeSession(sessionId) {
    return await this.request('session/close', { sessionId })
  }

  // 队列一条消息 (LLM 响应进行中)
  //   v1.0.2 Round 6 修: 之前 v1.0.2 误用 'session/queue' (一锅烩),
  //   实际 0.2.4 是 'session/queue/enqueue'; 0.3+ 迁到 'mcode/session/queue/enqueue'
  async queue(sessionId, text) {
    return await this.extRequest('mcode/session/queue/enqueue', 'session/queue/enqueue', { sessionId, text })
  }

  // 改写队列里某条消息
  async queueUpdate(sessionId, itemId, text) {
    return await this.extRequest('mcode/session/queue/update', 'session/queue/update', { sessionId, itemId, text })
  }

  // 从队列删一条
  async queueDelete(sessionId, itemId) {
    return await this.extRequest('mcode/session/queue/delete', 'session/queue/delete', { sessionId, itemId })
  }

  // 队列项触发 steer (改当前 turn 方向)
  async queueSteer(sessionId, itemId) {
    return await this.extRequest('mcode/session/queue/steer', 'session/queue/steer', { sessionId, itemId })
  }

  // 队列清单 (0.3+ 新增; 0.2.x 没有这个面)
  async queueList(sessionId) {
    return await this.request('mcode/session/queue/list', { sessionId })
  }

  // 引导当前 turn (不等 turn 结束直接插入 steering 文本)
  async steer(sessionId, text) {
    return await this.extRequest('mcode/session/steer', 'session/steer', { sessionId, text })
  }

  // 切换 session 模式 (plan / default / acceptEdits / bypassPermissions)
  // v1.1: 0.3+ 参数名是 modeId（0.2.4 是 mode）
  async setMode(sessionId, mode) {
    if (this._setModeShape !== 'mode') {
      try {
        const r = await this.request('session/set_mode', { sessionId, modeId: mode })
        this._setModeShape = 'modeId'
        return r
      } catch (e) {
        if (!this.isInvalidParams(e)) throw e
      }
    }
    const r = await this.request('session/set_mode', { sessionId, mode })
    this._setModeShape = 'mode'
    return r
  }

  // 改 session 维度的 config (e.g. model 切换)
  // v1.1: 0.3+ 形状 {configId, value}（value 必须 string，select 控件）；
  // 0.2.4 形状 {key, value}。响应和 config_option_update 通知都会带
  // 最新 configOptions — 记录到 sessionConfigs 供前端下拉使用。
  async setConfigOption(sessionId, configId, value) {
    const val = typeof value === 'string' ? value : String(value)
    if (this._setConfigShape !== 'key') {
      try {
        const r = await this.request('session/set_config_option', { sessionId, configId, value: val })
        this._setConfigShape = 'configId'
        return this._trackConfigOptions(sessionId, r)
      } catch (e) {
        if (!this.isInvalidParams(e)) throw e
      }
    }
    const r = await this.request('session/set_config_option', { sessionId, key: configId, value: val })
    this._setConfigShape = 'key'
    return this._trackConfigOptions(sessionId, r)
  }

  // --- v1.0.2 Round 6: mcode 0.2.4 Goal RPC 包装 ---
  // 4 个 sub-action (cli.js bundle grep 验证):
  //   session/goal/get    — 拿当前 goal
  //   session/goal/create — 创建 goal (objective + 可选 tokenBudget)
  //   session/goal/patch  — 改 status / objective / tokenBudget
  //   session/goal/clear  — 清空 goal
  // 5 状态 enum (cli.js 验证): active | paused | blocked | complete | budget_limited

  // 拿当前 goal (返回 {goal: {id, sessionId, objective, status, tokenBudget, used, ...} | null})
  async goalGet(sessionId) {
    return await this.extRequest('mcode/session/goal/get', 'session/goal/get', { sessionId })
  }

  // 创建 goal
  //   params: { sessionId, objective, tokenBudget? }
  //   response: { goal: {...} }
  async goalCreate(sessionId, objective, tokenBudget) {
    const params = { sessionId, objective }
    if (tokenBudget !== undefined && tokenBudget !== null) {
      params.tokenBudget = tokenBudget
    }
    return await this.extRequest('mcode/session/goal/create', 'session/goal/create', params)
  }

  // patch goal (改 status / objective / tokenBudget)
  //   params: { sessionId, status?, objective?, tokenBudget? }
  async goalPatch(sessionId, fields) {
    return await this.extRequest('mcode/session/goal/patch', 'session/goal/patch', { sessionId, ...fields })
  }

  // 清空 goal
  async goalClear(sessionId) {
    return await this.extRequest('mcode/session/goal/clear', 'session/goal/clear', { sessionId })
  }

  // 发 prompt + 等 stopReason + 收集 thinking/answer
  // onChunk({kind: 'thought'|'message'|'other'|'done', text?, update?, stopReason?})
  async prompt(sessionId, text, onChunk) {
    // 先清理之前 listener，避免多个 prompt 串
    return await new Promise((resolve, reject) => {
      const result = { thinking: '', answer: '', messageIds: new Set(), stopReason: null, events: [] }
      const onUpdate = (u) => {
        result.events.push(u)
        if (u.sessionUpdate === 'agent_thought_chunk' && u.content?.type === 'text') {
          result.thinking += u.content.text
          if (u.messageId) result.messageIds.add(u.messageId)
          try { onChunk?.({ kind: 'thought', text: u.content.text }) } catch {}
        } else if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') {
          result.answer += u.content.text
          if (u.messageId) result.messageIds.add(u.messageId)
          try { onChunk?.({ kind: 'message', text: u.content.text }) } catch {}
        } else if (u.sessionUpdate === 'tool_call') {
          // v0.5.bs: mcode acp 工具调用开始 — 透传完整 update 给上层（字段：toolCallId/title/name/status/rawInput）
          try { onChunk?.({ kind: 'tool_call', update: u }) } catch {}
        } else if (u.sessionUpdate === 'tool_call_update') {
          // v0.5.bs: 工具完成 — 透传 rawOutput 等给上层
          try { onChunk?.({ kind: 'tool_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'usage_update') {
          // v0.5.bx: mcode acp 上下文用量（{used, size, cost} — 当前 session 已用 vs 上限）
          // 字段是累计值（不是 incremental），直接覆盖 cs.context
          // v1.1: 0.3+ 的 prompt response 不再带 usage — 用最后一条
          // usage_update 兜底，保证 prompt() 的 resolve 仍有 usage 可读
          result.usage = { used: u.used, size: u.size, cost: u.cost }
          try { onChunk?.({ kind: 'usage', update: u }) } catch {}
        } else if (u.sessionUpdate === 'plan_update') {
          // v0.5.bx-9: mcode acp 0.1.5+ 可能发 plan_update 事件（plan 模式 LLM 出方案）
          //   字段: {sessionId, planId, title, summary, options: [{label, description}]}
          //   0.1.4 probe 没发过（available_commands 也没 /plan），但先透传以备未来
          try { onChunk?.({ kind: 'plan_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'plan_removed') {
          // v0.5.bx-9: 取消 plan 模式
          try { onChunk?.({ kind: 'plan_removed', update: u }) } catch {}
        } else if (u.sessionUpdate === 'current_mode_update') {
          // v0.5.bx-9: mcode 切到 plan/ask 模式时发 — 透传给 webui 决定弹 PlanMode/Ask modal
          try { onChunk?.({ kind: 'mode_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'goal_update') {
          // v0.5.bx-9: 目标追踪（mcode 0.1.4 acp 没见，但 0.1.5+ 可能加）
          try { onChunk?.({ kind: 'goal_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'config_option_update') {
          // v0.5.by: mcode acp 0.1.5 推的 config 变化 (如 permissionMode 被改)
          // payload: { sessionId, key, value, ... } — 透传给上层, 上层按 key 分发
          try { onChunk?.({ kind: 'config_option_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'session_info_update') {
          // v0.5.by: mcode acp 0.1.5 推的 session info 变化 (mcode docs 没列具体字段, 透传)
          try { onChunk?.({ kind: 'session_info_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'queue_update') {
          // v1.0.2: mcode 0.2.4 acp 队列状态变化通知 (mcode 在消息加入/改写/删除队列时推)
          try { onChunk?.({ kind: 'queue_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'goal_update') {
          // v1.0.2: mcode 0.2.4 acp 目标状态变化通知 (active/paused/blocked/complete/budget_limited)
          try { onChunk?.({ kind: 'goal_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'delegation_update') {
          // v1.0.2: mcode 0.2.4 acp delegation 状态变化通知 (子任务开始/完成/abort)
          try { onChunk?.({ kind: 'delegation_update', update: u }) } catch {}
        } else if (u.sessionUpdate === 'current_session_update') {
          // v1.0.2: mcode 0.2.4 acp 当前 session 切换通知 (resume / switch 触发)
          try { onChunk?.({ kind: 'current_session_update', update: u }) } catch {}
        } else {
          try { onChunk?.({ kind: 'other', update: u }) } catch {}
        }
      }
      this.on('sessionUpdate', onUpdate)
      // 发 prompt
      this.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text }],
      }).then((r) => {
        result.stopReason = r?.stopReason || 'end_turn'
        // v0.5.bx: 捕获 usage 字段（Gcm schema: totalTokens/inputTokens/outputTokens/thoughtTokens/cachedReadTokens/cachedWriteTokens）
        // mcode acp 0.1.3 把 usage 放在 session/prompt response 里，不发独立 usage_update event
        if (r && r.usage) result.usage = r.usage
        // v0.5.bx-7: debug — 看 mcode 0.1.4 实际 response 结构
        if (process.env.MCODE_ACP_DEBUG) {
          console.log('[acp.prompt.response]', JSON.stringify({
            stopReason: r?.stopReason,
            hasUsage: !!r?.usage,
            usageKeys: r?.usage ? Object.keys(r.usage) : null,
            usage: r?.usage,
            respKeys: r ? Object.keys(r) : null,
            fullResp: r,
          }).slice(0, 2000))
        }
        this.off('sessionUpdate', onUpdate)
        try { onChunk?.({ kind: 'done', stopReason: result.stopReason, usage: result.usage }) } catch {}
        resolve(result)
      }).catch((e) => {
        this.off('sessionUpdate', onUpdate)
        reject(e)
      })
    })
  }

  stop() {
    if (this.child) {
      try { this.child.kill() } catch {}
      this.child = null
    }
    this.started = false
  }

  // 别名：跟 child_process 的 child.kill() 接口一致，/api/stop 能直接用
  kill() { this.stop() }
}
