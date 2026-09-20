// webui/public/app/events.js — REFACTORING.md batch 4 step 2
// Owns: attachEvents/attachModalEvents wiring, slash overlay, mode
// popover, attachments/upload, send/stopExec, plan/perm modal flows,
// keyboard nav, language toggle.

import { applyI18n, applyTheme, currentLang, setLang, t, toggleTheme } from './i18n.js'
import { MODE_ICONS, __DBG, escapeHtml, formatNumber, formatResetTime, formatTimeUntil, nextFiveHourReset, nextWeeklyReset, parseMarkdown, showToast } from './util.js'
// v1.2 (feat-workspace-lhl): 零弹窗目录选择（webkitdirectory input，见 native-fs.js）
import { refreshSessions, API_SUFFIX, CID, CID_QUERY, HEADERS, TOKEN, TOKEN_QUERY, autoRefreshTimer, clearAlerts, closeApiKeyModal, connect, es, getGeneralQuota, getPendingAuthRequests, leftOpen, markAllAlertsRead, openApiKeyModal, refreshUsage, renderUsage, renderUsagePopover, renderUsageValue, rightOpen, sessionSearchQuery, setLeftOpen, setRightOpen, setSearchQuery, setSidebarReady, setState, state, submitAuthDecision, toggleUsagePopover, tokenParam, urlParams } from './state.js'
import { ASK_ANSWERS_LS_KEY, ASK_DISMISSED_LS_KEY, ASK_MODAL_STATE, AUTH_MODAL_STATE, DISMISSED_QUESTIONS, askModalNextOrSend, askModalPqKey, askModalSkip, attachStructuredBlockHandlers, bindAskModal, buildAskUserPrompt, cancelConfirm, clearAskPresentedKeys, closeAskModal, collapsedWorkspaces, collectAskBlock, collectPlanBlock, deleteSession, hideRightForWelcome, loadAskDismissed, loadAskUserAnswers, onAskModalOptClick, onAskModalOtherInput, openAskModal, openPlanModal, parseChatLines, render, renderAlerts, renderAskBlock, renderAskModalContent, renderAskUserToolIfChanged, renderChat, renderContext, renderGoal, renderLanCardContent, renderMessage, renderPlanBlock, renderRight, renderSessions, renderTodo, renderUserFooter, resetAskDismissed, saveAskDismissed, saveAskUserAnswers, saveCollapsedWorkspaces, sendAskAnswer, setAskUserAnswer, submitAskModal, suppressAskModal, switchSession, wsShortName } from './render.js'

export let slashOpen = false
export let slashQuery = ''
export let slashActiveIdx = 0
export let slashFiltered = []
export let modeOpen = false
// v0.5.ap: 旧 settingsOpen 变量已废弃（v0.5.ap 改用 settings-modal 替代旧 settings-menu）
// 保留定义兼容可能的旧代码引用，但本文件其他地方不再使用
// let settingsOpen = false
export let attachedFiles = []
export let isSending = false

// Modal state (v0.5.bx-14: askOpen/askSelectedIdx/askSending/lastShownAskKey 已删, 用 #ask-modal ASK_MODAL_STATE)
export let planOpen = false
export let planSending = false
export let planModeOpen = false
export let permOpen = false
export let lastShownPlanKey = null
export let lastShownPermKey = null
export let lastShownPlanModeKey = null

// ============================================================
// Slash commands
// v0.5.bx-23: 删掉 11 个 mcode 0.1.5 acp 不识别的"假命令"
//   之前列的 17 个里: /sessions /plan /permission /plugins /provider /feedback /steer /init /logout /quit
//   mcode 0.1.5 acp 都不识别 (availableCommands 只有 10 个, mcode 0.1.5 acp 也不暴露 goal/plan)
//   删掉避免 user 输完发现啥也没发生
// 保留: mcode 真支持 5 个 (help/new/model/status/usage) + webui 自己处理 4 个 (goal/goal-done/goal-blocked/clear)
//   + 加 mcode 真的但 webui 漏的 4 个 (doctor/skills/mcp/compact) — 让 user 知道这些命令可用
// ============================================================
export const SLASH_COMMANDS = [
  // --- mcode 0.1.5 acp 真支持 ---
  { cmd: '/help', zh: '显示可用命令', en: 'Show available commands' },
  { cmd: '/new', zh: '开启新会话', en: 'Start a fresh session' },
  { cmd: '/model', zh: '选择模型', en: 'Choose model' },
  { cmd: '/context', zh: '只读上下文', en: 'Read-only context' },
  { cmd: '/doctor', zh: '诊断 mcode 健康度', en: 'Diagnose mcode health' },
  { cmd: '/skills', zh: '管理 skills', en: 'Manage skills' },
  { cmd: '/mcp', zh: 'MCP servers', en: 'MCP servers' },
  { cmd: '/usage', zh: '会话用量', en: 'Show session usage' },
  { cmd: '/compact', zh: '压缩上下文', en: 'Compact context' },
  // --- webui 自己处理 (不走 mcode) ---
  { cmd: '/status', zh: '当前 session 状态 (webui)', en: 'Show current session status (webui)' },
  { cmd: '/goal', zh: '设定目标 (webui 改写消息, 单轮执行)', en: 'Set goal (webui rewrites msg, single-turn)' },
  { cmd: '/goal-done', zh: '标记目标完成 (webui)', en: 'Mark goal done (webui)' },
  { cmd: '/goal-blocked', zh: '标记目标阻塞 (webui)', en: 'Mark goal blocked (webui)' },
  { cmd: '/clear', zh: '清空当前对话 (webui)', en: 'Clear current chat (webui)' },
]

export const SLASH_SKILLS = [
  { name: 'plan', zh: 'Plan Mode（先出方案再执行）', en: 'Plan Mode (plan first)' },
  { name: 'context', zh: '只读当前会话上下文', en: 'Read-only session context' },
  { name: 'feedback', zh: '提交反馈', en: 'Submit feedback' },
]

export const slashOverlay = document.getElementById('slash-overlay')
export const slashInput = document.getElementById('slash-input')
export const slashResults = document.getElementById('slash-results')

export function showSlash() {
  slashOpen = true
  slashOverlay.hidden = false
  slashInput.value = slashQuery
  filterSlash()
  setTimeout(() => slashInput.focus(), 0)
}
export function hideSlash() {
  slashOpen = false
  slashOverlay.hidden = true
  slashQuery = ''
  slashActiveIdx = 0
}
export function filterSlash() {
  const q = slashQuery.toLowerCase()
  const cmds = SLASH_COMMANDS.filter(c => {
    if (!q) return true
    return c.cmd.toLowerCase().includes(q) || c.zh.includes(q) || c.en.toLowerCase().includes(q)
  })
  const skills = SLASH_SKILLS.filter(s => {
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.zh.includes(q) || s.en.toLowerCase().includes(q)
  })
  slashFiltered = [...cmds, ...skills]  // 合并，但渲染时分 section
  slashActiveIdx = 0
  if (cmds.length === 0 && skills.length === 0) {
    slashResults.innerHTML = `<div class="slash-item empty">${t('slash_no_results')}</div>`
  } else {
    let html = ''
    let idx = 0
    if (cmds.length > 0) {
      html += `<div class="slash-section-label">${t('slash_section_cmd')}</div>`
      html += cmds.map((c, i) => {
        const active = i === 0 ? 'active' : ''
        idx++
        return `<div class="slash-item ${active}" data-idx="${i}" data-cmd="${c.cmd}" data-kind="cmd">
          <span class="slash-item-cmd">${escapeHtml(c.cmd)}</span>
          <span class="slash-item-desc">${escapeHtml(currentLang === 'zh' ? c.zh : c.en)}</span>
        </div>`
      }).join('')
    }
    if (skills.length > 0) {
      html += `<div class="slash-section-label">${t('slash_section_skill')}</div>`
      html += skills.map((s, i) => {
        const active = (cmds.length === 0 && i === 0) ? 'active' : ''
        const idxGlobal = cmds.length + i
        return `<div class="slash-item slash-skill ${active}" data-idx="${idxGlobal}" data-cmd="/skill ${s.name}" data-kind="skill">
          <span class="slash-item-cmd">${escapeHtml(s.name)}</span>
          <span class="slash-item-desc">${escapeHtml(currentLang === 'zh' ? s.zh : s.en)}</span>
        </div>`
      }).join('')
    }
    slashResults.innerHTML = html
  }
}

// ============================================================
// Mode popover
// ============================================================
export const modePopover = document.getElementById('mode-popover')
export function toggleMode() {
  modeOpen = !modeOpen
  modePopover.hidden = !modeOpen
}
export function hideMode() { modeOpen = false; modePopover.hidden = true }
export async function setMode(mode) {
  // v0.5.by: plan 模式本地 toggle — mcode 0.1.5 acp 不支持 session/set_mode (probe 验证 Method not found)
  //   fallback: send() 时给 prompt 加 plan 模板前缀, 强制 mcode 按 Plan: 格式输出
  //   这是 mcode 0.1.5 唯一可行的进 plan mode 路径
  //   (goal 模式: 之前是按钮, mcode 0.1.5 不支持, 删了按钮. 用 /goal slash command 代替)
  hideMode()
  if (mode === 'plan') {
    state.planMode = !state.planMode
    showToast(state.planMode ? t('plan_mode_on') : t('plan_mode_off'), 2500)
    return
  }
  // 权限 mode (ask/auto/full/read) — mcode 0.1.5 acp 不支持 mid-session 改 permissionMode
  //   server 仅更新 webui UI, mcode 实际 mode 不变 (启动时已固定)
  try {
    const r = await fetch('/api/permissions' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ mode })
    })
    const j = await r.json().catch(() => ({}))
    if (state.planMode) state.planMode = false
    if (j && j.ok === true) {
        showToast(t('perm_mode_note'), 4500)
    }
  } catch (e) { console.error(e) }
}

// ============================================================
// v0.5.aq: 旧 settings menu / modal 已全部废弃，chip-lan 自带开关
// ============================================================
export const settingsMenu = null  // 旧元素已删除，置 null 防止任何残留引用报错
export function toggleSettings() {}  // 旧 API no-op
export function hideSettings() {}

// ============================================================
// v0.5.z: 套餐用量（btn-menu 按钮 + 右侧 popover，mmx quota + 本机时间自算）
// - % 从 mmx API 拿
// - 重置时间纯前端算：5h 窗口边界 (0/5/10/15/20) + 周日半夜周刷新
// - 只展示 general（不显示 video）
// - 时间格式 "X天 Y小时 Z分 后重置"（去掉"钟"避免"分分钟"重复）
// ============================================================


export const fileInput = document.getElementById('file-input')
export const attachmentList = document.getElementById('attachment-list')

export async function uploadFiles(files) {
  for (const file of files) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch('/api/upload' + API_SUFFIX, { method: 'POST', body: fd, headers: HEADERS })
      if (!r.ok) { alert(`Upload failed: ${r.status}`); continue }
      const data = await r.json()
      if (data.ok) {
        attachedFiles.push(data.path)
        renderAttachments()
      }
    } catch (e) { console.error('upload', e); alert(`Upload error: ${e.message}`) }
  }
}

export function renderAttachments() {
  if (attachedFiles.length === 0) {
    attachmentList.innerHTML = ''
    return
  }
  attachmentList.innerHTML = attachedFiles.map((p, i) => {
    const name = p.split(/[\\\/]/).pop()
    return `<div class="attachment-chip">
      <span>📎 ${escapeHtml(name)}</span>
      <span class="remove" data-idx="${i}">×</span>
    </div>`
  }).join('')
}

export function removeAttachment(idx) {
  attachedFiles.splice(idx, 1)
  renderAttachments()
}

// ============================================================
// Send command
// ============================================================
export async function send() {
  const textarea = document.getElementById('input-textarea')
  const text = textarea.value.trim()
  if (!text && attachedFiles.length === 0) return
  if (isSending) return
  isSending = true
  const btn = document.getElementById('btn-send')
  btn.disabled = true
  try {
    // v0.5.ax: welcome 态（无 session）发消息时先创建 session，用当前 workspace
    if (!state?.sessionId) {
      const ws = state?.workspace?.dir || undefined
      const cr = await fetch('/api/sessions' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify({ workspace: ws })
      })
      const cd = await cr.json()
      if (!cd.ok) { alert('创建会话失败: ' + (cd.error || '未知错误')); return }
      // 等 SSE 推 state（含新 sessionId + mcodeSessionId）
      await new Promise(r => setTimeout(r, 300))
    }
    // v0.4.2: 用 mavis comm send 真正发消息到 mcode session（替代 M11 stdin 注入）
    // 附件先注入 @file 前缀（如果 mcode 端能处理）
    let content = text
    if (attachedFiles.length > 0) {
      const atPaths = attachedFiles.map(p => `@${p}`).join(' ')
      content = `${atPaths} ${content}`.trim()
    }
    // v0.5.bx-9: Plan 模式 — mcode 0.1.4 LLM 不能自己进 plan mode, webui workaround
    //   选 plan 后给 prompt 加 plan 模板前缀, 强制 mcode 按 Plan: 标题 / ## Summary / Plan complete. 格式输出
    //   webui parseChatLines 解析 + 渲染 plan 块 + 弹 plan 弹窗 (老渲染本来就 OK)
    if (state?.planMode && !state?.pendingAskUser) {
      const planTpl = `[Plan 模式 — 请按以下 markdown 格式输出]\n` +
        `Plan: <一句话标题>\n\n` +
        `## Summary\n<2-3 句总览>\n\n` +
        `## 目标\n- <目标 1>\n- <目标 2>\n- <...>\n\n` +
        `## 非目标\n- <非目标 1>\n- <...>\n\n` +
        `## 实施步骤\n1. <步骤 1>\n2. <步骤 2>\n3. <...>\n\n` +
        `Plan complete.\n` +
        `What would you like to do?\n` +
        `1. Agree and start implementation\n` +
        `2. Skip for now\n` +
        `3. Revise with feedback\n\n` +
        `---\n` +
        `用户问题: ${content}\n` +
        `---\n` +
        `(重要: 必须严格按上面 Plan 格式输出, 不要加额外解释. webui 会自动解析你的输出并显示 plan 弹窗让用户选.)`
      content = planTpl
      // v0.5.bx-9: 用了就关掉 plan mode (一次性, 不持续)
      //   user 想再来一次再点 plan chip
      state.planMode = false
      if (typeof renderRight === 'function') renderRight()
    }
    // v0.5.bx-31: 删掉 send() 里基于 pendingAskUser 的 Q/A 模板化兜底
    //   之前: 任何有 pendingAskUser 时, 用户在 chat 框发消息会被自动套成 "Q: <q>\nA: <text>"
    //   现在: chat 输入框发消息永远走正常通路, 不被套
    //   Q/A 模板化只在弹窗 submit (submitAskModal) 时走 — 用户必须明确点 × 提交 / 跳过 / 选项 / 其他+回车
    //   这样历史 ask_user 块 (不是最新回复) 也不会触发模板化, 避免"进入对话前 N 条都被套"的 bug
    //   pendingAskUser 字段已不在 render 时被设, 这里也不再读 (防御性保留 closeAskModal 清)
    const r = await fetch('/api/send' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ content, command: 'prompt' })
    })
    if (!r.ok) { alert(`Send failed: ${r.status}`); return }
    const data = await r.json()
    if (!data.ok) { alert(`Send error: ${data.error || 'unknown'}`); return }
    // 清空
    textarea.value = ''
    attachedFiles = []
    renderAttachments()
    autoResize()
  } catch (e) { console.error('send', e); alert(`Send error: ${e.message}`) }
  finally { isSending = false; btn.disabled = false }
}

// v0.5.aa: 停止按钮 — POST /api/stop，server kill 子进程
export async function stopExec() {
  const btn = document.getElementById('btn-send')
  if (btn) btn.disabled = true
  try {
    const r = await fetch('/api/stop' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({})
    })
    const data = await r.json()
    if (!data.ok) console.warn('stop failed', data)
    // 状态由 server pushState 推送回来（state.running.active 变 false，render 切回 send）
  } catch (e) {
    console.error('stop', e)
  } finally {
    if (btn) btn.disabled = false
  }
}

export function autoResize() {
  const ta = document.getElementById('input-textarea')
  if (!ta) return
  ta.style.height = 'auto'
  ta.style.height = Math.min(200, ta.scrollHeight) + 'px'
}

export function attachEvents() {
  // Input textarea
  const textarea = document.getElementById('input-textarea')
  textarea.addEventListener('input', () => {
    autoResize()
    // Slash command detection
    const v = textarea.value
    // v0.5.bx-21: 含空格的输入不再开 slash overlay — 允许 "/goal 帮我" 这种 命令+参数 格式
    //   之前 v.startsWith('/') 永远 true, 导致 "/goal 帮我" 还显示 "No matching commands" 干扰 user
    //   修后: 只有 / 开头且无空格才开 slash (完整命令后空格 = 命令已选, 进入自然语言补充)
    if (v === '/' || (v.startsWith('/') && !v.includes(' '))) {
      slashQuery = v.slice(1)
      if (!slashOpen) showSlash()
      else filterSlash()
    } else if (slashOpen) {
      hideSlash()
    }
  })
  textarea.addEventListener('keydown', (e) => {
    if (slashOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSlash(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSlash(-1) }
      else if (e.key === 'Enter') { e.preventDefault(); selectSlash() }
      else if (e.key === 'Escape') { e.preventDefault(); hideSlash() }
    } else {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
    }
  })
  textarea.addEventListener('paste', async (e) => {
    // Paste any file from clipboard (image, video, document)
    // 终端页面只能 ctrl+v 粘贴，所以这里要处理所有附件
    if (e.clipboardData?.files?.length > 0) {
      const files = Array.from(e.clipboardData.files)
      if (files.length > 0) {
        e.preventDefault()
        await uploadFiles(files)
      }
    }
  })

  // Send button
  // v0.5.aa: send 按钮根据 is-running 切 send / stop
  document.getElementById('btn-send').addEventListener('click', () => {
    if (state?.running?.active) stopExec()
    else send()
  })

  // Refresh sessions button
  document.getElementById('btn-refresh-sessions')?.addEventListener('click', refreshSessions)

  // Quota card refresh button (手动刷新 → 弹 toast)
  document.getElementById('usage-popover-refresh')?.addEventListener('click', () => refreshUsage({ manual: true }))

  // Search sessions input — 实时过滤 sidebar 列表
  // v2026-08-28 modacker fix: use the setSearchQuery setter; direct
  // assignment to the imported `let` binding throws "Assignment to
  // constant variable" because the import binding is read-only.
  //
  // v2026-08-28 modacker (autofill defense): Chrome's profile
  //   autofill ignores `autocomplete="off"` + `type="search"` for
  //   pages where it has previously cached a value. The proven
  //   workaround is the `readonly` attribute — Chrome (and other
  //   password managers) skip readonly inputs entirely, so they
  //   can't inject a value. We strip `readonly` on the very first
  //   user-driven event (focus / mousedown / keydown) so typing
  //   works normally thereafter. The DOM is observable enough
  //   that this doesn't fight the user — by the time they tap
  //   the input we have already cleared the autofill artifact.
  const searchInput = document.getElementById('search-input')
  if (searchInput) {
    // The HTML markup sets `readonly` so Chrome's autofill
    // leaves it alone. Strip on any user-initiated interaction.
    const stripReadonly = () => {
      if (searchInput.hasAttribute('readonly')) {
        searchInput.removeAttribute('readonly')
      }
    }
    searchInput.addEventListener('mousedown', stripReadonly, { once: true, capture: true })
    searchInput.addEventListener('keydown', stripReadonly, { once: true, capture: true })
    searchInput.addEventListener('focus', stripReadonly, { once: true, capture: true })
    searchInput.addEventListener('input', (e) => {
      setSearchQuery(e.target.value || '')
      renderSessions()
    })
  }

  // Attach
  document.getElementById('btn-attach').addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', (e) => {
    if (e.target.files?.length > 0) {
      uploadFiles(e.target.files)
      e.target.value = ''
    }
  })
  attachmentList.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove')) {
      removeAttachment(parseInt(e.target.getAttribute('data-idx'), 10))
    }
  })

  // Mode
  document.getElementById('btn-mode').addEventListener('click', (e) => {
    e.stopPropagation()
    toggleMode()
  })
  modePopover.addEventListener('click', (e) => {
    const item = e.target.closest('.mode-popover-item')
    if (item) setMode(item.getAttribute('data-mode'))
  })

  // Settings
  // v0.4.0: btn-settings 已移除（外观/语言/局域网在主栏已暴露）
  // document.getElementById('btn-settings').addEventListener('click', (e) => {
  //   e.stopPropagation()
  //   toggleSettings()
  // })

  // Appearance / Language buttons
  // v2026-08-28 modacker: btn-appearance now opens the appearance
  // settings card (which has the theme toggle, plus the
  // "套餐用量" toggle and key input). The theme toggle is moved
  // inside the card (#appearance-card-theme).
  const btnAppearance = document.getElementById('btn-appearance')
  const appearanceCard = document.getElementById('appearance-card')
  const appearanceCardTheme = document.getElementById('appearance-card-theme')
  function setAppearanceCardOpen(open) {
    if (!appearanceCard || !btnAppearance) return
    appearanceCard.hidden = !open
    btnAppearance.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
  function toggleAppearanceCard() {
    setAppearanceCardOpen(appearanceCard ? appearanceCard.hidden : false)
  }
  if (btnAppearance) {
    btnAppearance.addEventListener('click', (e) => {
      e.stopPropagation()
      // v2 (2026-09-20 webui-manual-audit D3): click now CYCLES the theme
      //   (toggleTheme — applies data-theme + persists to localStorage
      //   'webui-theme' + re-syncs the card checkbox/label/icon) AND
      //   toggles the appearance card open, in that order. Root cause of
      //   the audit finding "clicking does nothing": the v2026-08-28
      //   rework made the button ONLY reveal the card (whose theme toggle
      //   checkbox then needed a second, discoverable-only-by-trial
      //   interaction) — a click on the button itself had no directly
      //   observable effect (data-theme never moved, and the card is a
      //   .lan-card, invisible to any popover probe). Cycling here gives
      //   immediate feedback; the card still opens so the 套餐用量
      //   "启用" toggle (the quota master switch) stays reachable, and
      //   applyTheme() keeps its checkbox in sync with the cycled state.
      toggleTheme()
      toggleAppearanceCard()
    })
  }
  // Click outside to close.
  document.addEventListener('click', (e) => {
    if (!appearanceCard || appearanceCard.hidden) return
    if (appearanceCard.contains(e.target) || btnAppearance.contains(e.target)) return
    setAppearanceCardOpen(false)
  })
  if (appearanceCardTheme) {
    appearanceCardTheme.addEventListener('change', () => {
      toggleTheme()
    })
  }

  // v2026-08-28 modacker: 套餐用量显示开关. 关掉 → 主 UI 按钮消失.
  const appearanceCardQuota = document.getElementById('appearance-card-quota')
  if (appearanceCardQuota) {
    appearanceCardQuota.addEventListener('change', async (e) => {
      const enabled = !!e.target.checked
      try {
        const r = await fetch('/api/settings' + API_SUFFIX, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...HEADERS },
          body: JSON.stringify({ quotaEnabled: enabled }),
        })
        const d = await r.json()
        if (!d.ok) { alert('切换失败: ' + (d.error || '未知错误')); e.target.checked = !enabled; return }
        if (state) state.quotaEnabled = d.quotaEnabled === true
        render()  // re-render to update btn-usage visibility
        try { await fetch('/api/usage' + API_SUFFIX, { method: 'POST', headers: HEADERS }) } catch {}
      } catch (err) {
        console.error('[appearance-card-quota] toggle failed', err)
        alert('切换失败: ' + err.message)
        e.target.checked = !enabled
      }
    })
  }
  document.getElementById('btn-language').addEventListener('click', () => { toggleLang() })

  // Usage button → toggle popover
  document.getElementById('btn-usage').addEventListener('click', (e) => {
    e.stopPropagation()
    toggleUsagePopover()
  })

  // ----------------------------------------------------------------
  // v2 (2026-09-20 webui-manual-audit D1): anomaly-channel bell —
  //   topbar #btn-alerts toggles #alerts-popover. Opening marks all
  //   current alerts read (badge drops, list stays); the header's
  //   清空 button empties the list (state.js clearAlerts keeps the
  //   seen-id set so a reconnect snapshot can't resurrect the badge).
  //   Bind-once here, DOM owned by render.js renderAlerts().
  // ----------------------------------------------------------------
  const btnAlerts = document.getElementById('btn-alerts')
  const alertsPopover = document.getElementById('alerts-popover')
  const alertsClear = document.getElementById('alerts-clear')
  function setAlertsPopoverOpen(open) {
    if (!alertsPopover || !btnAlerts) return
    alertsPopover.hidden = !open
    btnAlerts.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) {
      // Marking-read on open — the popover shows the full list either
      // way; the badge is purely "not yet looked at".
      markAllAlertsRead()
      renderAlerts()
    }
  }
  if (btnAlerts) {
    btnAlerts.addEventListener('click', (e) => {
      e.stopPropagation()
      setAlertsPopoverOpen(alertsPopover ? alertsPopover.hidden : false)
    })
  }
  if (alertsClear) {
    alertsClear.addEventListener('click', (e) => {
      e.stopPropagation()
      clearAlerts()
    })
  }
  // Click outside closes (same pattern as the usage popover / lan card).
  document.addEventListener('click', (e) => {
    if (!alertsPopover || alertsPopover.hidden) return
    if (alertsPopover.contains(e.target) || (btnAlerts && btnAlerts.contains(e.target))) return
    setAlertsPopoverOpen(false)
  })

  // v0.5.ak: 模型切换 — btn-model click 弹 model-picker popover
  // v0.5.bh: 拉 /api/models 显示可选列表，点一个直接切（用户反馈：不想手输）
  const modelPicker = document.getElementById('model-picker')
  const modelPickerInput = document.getElementById('model-picker-input')
  const modelPickerList = document.getElementById('model-picker-list')
  async function loadModelList() {
    if (!modelPickerList) return
    modelPickerList.innerHTML = '<div class="model-picker-loading">' + t('model_picker_loading') + '</div>'
    try {
      const r = await fetch('/api/models' + API_SUFFIX, { headers: HEADERS })
      const d = await r.json()
      if (!d.ok || !Array.isArray(d.models) || d.models.length === 0) {
        // v0.5.bj: TUI 没配 model — 显示 server hint（提示用户手输）
        const hint = d.hint || t('model_picker_empty')
        modelPickerList.innerHTML = '<div class="model-picker-empty">' + hint + '</div>'
        return
      }
      const currentName = (d.current || '').toLowerCase()
      modelPickerList.innerHTML = d.models.map(m => {
        const isCurrent = (m.id || '').toLowerCase() === currentName
        return '<button class="model-picker-item-btn' + (isCurrent ? ' current' : '') + '" data-model-id="' + (m.id || '').replace(/"/g, '&quot;') + '">' +
               '<span>' + (m.label || m.id) + '</span>' +
               '<span class="provider">' + (m.provider || '') + '</span>' +
               '</button>'
      }).join('')
      // 绑定 click — 直接调 /api/set-model（v0.5.bk: 不再发 /model 命令，避免 mcode 报 invalid params + 新开对话）
      modelPickerList.querySelectorAll('.model-picker-item-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-model-id') || ''
          modelPickerInput.value = id
          modelPickerInput.dataset.fullName = id
          modelPicker.hidden = true
          try {
            await fetch('/api/set-model' + API_SUFFIX, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...HEADERS },
              body: JSON.stringify({ model: id }),
            })
            // 服务端 pushStateFor 自动更新 state，render() 会被 SSE 推过来触发
            // 但保险起见主动 fetch 一次
            const r = await fetch('/api/state' + API_SUFFIX, { headers: HEADERS })
            if (r.ok) { state = await r.json(); render() }
            showToast && showToast(t('model_switched') + ' ' + id, 1500)
          } catch (e) { console.error('[set-model]', e) }
        })
      })
    } catch (e) {
      console.error('[models] load failed', e)
      modelPickerList.innerHTML = '<div class="model-picker-empty">' + t('model_picker_empty') + '</div>'
    }
  }
  document.getElementById('btn-model').addEventListener('click', (e) => {
    e.stopPropagation()
    const wasHidden = modelPicker.hidden
    // 关掉其他 popover
    document.querySelectorAll('.mode-popover, .settings-menu, .model-picker, .workspace-picker').forEach(el => { if (el !== modelPicker) el.hidden = true })
    modelPicker.hidden = !wasHidden
    if (!modelPicker.hidden) {
      // 预填当前 model（只显示短名，去掉 provider/ 前缀）
      const fullName = (state && state.model && state.model.name) || ''
      const shortName = fullName.includes('/') ? fullName.split('/').pop() : fullName
      modelPickerInput.value = shortName
      modelPickerInput.dataset.fullName = fullName  // 保留完整路径作 fallback
      // v0.5.bh: 拉可选模型列表
      loadModelList()
      setTimeout(() => modelPickerInput.focus(), 0)
    }
  })
  document.getElementById('model-picker-cancel').addEventListener('click', (e) => {
    e.stopPropagation()
    modelPicker.hidden = true
  })
  modelPickerInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const v = modelPickerInput.value.trim()
      if (!v) return
      modelPicker.hidden = true
      // 直接调 /api/send 发 "/model <v>" 给 mcode acp
      try {
        await fetch('/api/send' + API_SUFFIX, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...HEADERS },
          body: JSON.stringify({ content: '/model ' + v }),
        })
      } catch (e) { console.error(e) }
    } else if (e.key === 'Escape') {
      modelPicker.hidden = true
    }
  })
  // 点击 popover 外关掉
  document.addEventListener('click', (e) => {
    if (modelPicker && !modelPicker.hidden && !modelPicker.contains(e.target) && e.target.id !== 'btn-model') {
      modelPicker.hidden = true
    }
  })

  // v2 (feat-workspace-lhl): 工作区弹层 — 搜索框 + recent 列表 + 原生 picker 按钮
  // 实现方案：dsh 同款后端 spawn 原生 OS 对话框（无浏览器授权弹窗）
  const wsPicker = document.getElementById('workspace-picker')
  const wsChip = document.getElementById('chip-workspace')
  const wsSearchInput = document.getElementById('ws-picker-search')
  const wsRecentList = document.getElementById('ws-picker-recent-list')
  const wsCreateBtn = document.getElementById('ws-picker-pick-btn')
  const wsNoWsBtn = document.getElementById('ws-picker-nows-btn')
  const emptyWsBtn = document.getElementById('chat-empty-workspace')

  const WS_LAST_KEY = 'webui_workspace_last_v1'
  const WS_SEARCH_DEBOUNCE_MS = 300
  const WS_RECENT_LIMIT = 20

  // 缓存
  let wsRecentCache = []  // [{dir, count}]
  let wsTmpDir = ''
  let wsSearchTimer = null

  // ---- 核心：切换工作区 ----
  async function submitWorkspaceChange(payload) {
    try {
      const r = await fetch('/api/workspace' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify(payload),
      })
      const data = await r.json()
      if (data.ok) {
        if (payload && payload.dir) {
          try { localStorage.setItem(WS_LAST_KEY, data.workspace.dir) } catch {}
        }
        wsPicker.hidden = true
        hideWsQuickPicker()
        if (state) {
          state.workspace = data.workspace
          render()
        }
      } else {
        alert('切换失败: ' + (data.error || '未知错误'))
      }
    } catch (e) {
      console.error('[ws] submit failed', e)
      alert('切换失败: ' + e.message)
    }
  }

  // ---- 搜索 & recent 列表渲染 ----
  function wsRenderRecent(items) {
    if (!wsRecentList) return
    if (!items || items.length === 0) {
      wsRecentList.innerHTML = '<div class="ws-recent-empty">暂无最近工作区</div>'
      return
    }
    const cur = (state && state.workspace && state.workspace.dir) || ''
    wsRecentList.innerHTML = items.map(item => {
      const active = item.dir === cur ? ' active' : ''
      const name = wsShortName(item.dir) || item.dir
      const count = item.count > 0 ? `<span class="ws-recent-count">${item.count}</span>` : ''
      return `<div class="ws-recent-item${active}" data-dir="${escapeHtml(item.dir)}" title="${escapeHtml(item.dir)}">
        <span class="ws-recent-name">${escapeHtml(name)}</span>${count}
      </div>`
    }).join('')

    // 点击即切换
    wsRecentList.querySelectorAll('.ws-recent-item').forEach(el => {
      el.addEventListener('click', () => {
        const dir = el.dataset.dir
        wsPicker.hidden = true
        submitWorkspaceChange({ dir, syncTui: false })
      })
    })
  }

  async function wsLoadRecent(search = '') {
    try {
      const url = '/api/workspace/recent' + API_SUFFIX + '&search=' + encodeURIComponent(search) + '&limit=' + WS_RECENT_LIMIT
      const r = await fetch(url, { headers: HEADERS })
      const data = await r.json()
      if (data && data.ok) {
        wsRecentCache = data.items || []
        wsTmpDir = data.tmpDir || wsTmpDir
        wsRenderRecent(wsRecentCache)
      }
    } catch (e) {
      console.error('[ws] load recent failed', e)
      if (wsRecentList) wsRecentList.innerHTML = '<div class="ws-recent-empty">加载失败</div>'
    }
  }

  function wsOnSearchInput() {
    clearTimeout(wsSearchTimer)
    wsSearchTimer = setTimeout(() => {
      wsLoadRecent(wsSearchInput.value.trim())
    }, WS_SEARCH_DEBOUNCE_MS)
  }

  // ---- 弹层打开 / 关闭 ----
  function openWsPicker() {
    const wasHidden = wsPicker.hidden
    document.querySelectorAll('.mode-popover, .settings-menu, .model-picker, .workspace-picker').forEach(el => { if (el !== wsPicker) el.hidden = true })
    hideWsQuickPicker()
    wsPicker.hidden = !wasHidden
    if (!wsPicker.hidden) {
      // 清搜索框，加载 recent
      if (wsSearchInput) { wsSearchInput.value = ''; wsSearchInput.focus() }
      wsLoadRecent('')
      setTimeout(() => {
        wsPicker.style.top = '50%'
        wsPicker.style.left = '50%'
        wsPicker.style.transform = 'translate(-50%, -50%)'
      }, 0)
    }
  }

  wsChip?.addEventListener('click', (e) => {
    e.stopPropagation()
    openWsPicker()
  })

  // ---- 搜索框事件 ----
  wsSearchInput?.addEventListener('input', wsOnSearchInput)
  wsSearchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); wsPicker.hidden = true }
  })

  // ---- 创建或打开新空间 → 原生 picker ----
  wsCreateBtn?.addEventListener('click', async (e) => {
    e.stopPropagation()
    try {
      const r = await fetch('/api/workspace/pick' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
      })
      const data = await r.json()
      if (data && data.ok && data.dir) {
        wsPicker.hidden = true
        submitWorkspaceChange({ dir: data.dir, syncTui: false })
      } else {
        // 用户取消（dir 为空字符串）或异常
        if (data && data.dir === '') {
          // 取消，不做操作
        } else {
          showToast(data?.error || '目录选择失败', 3000)
        }
      }
    } catch (err) {
      console.error('[ws] pick failed', err)
      showToast('目录选择失败: ' + err.message, 3000)
    }
  })

  // ---- 无需工作空间 → 临时目录 ----
  wsNoWsBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    const tmp = wsTmpDir || ''
    if (!tmp) { showToast(t('ws_nows_unavailable') || '临时目录不可用'); return }
    wsPicker.hidden = true
    submitWorkspaceChange({ dir: tmp, syncTui: false })
  })

  // ---- wsPicker 自身 Escape 关闭 ----
  wsPicker?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); wsPicker.hidden = true }
  })

  // ---- quick picker（chip 下拉）----
  const wsQuickPicker = document.getElementById('ws-quick-picker')
  const wsQuickListEl = document.getElementById('ws-quick-list')
  const wsQuickAddBtn = document.getElementById('ws-quick-add')

  // ---- 欢迎页 chip → quick picker ----
  if (emptyWsBtn) {
    emptyWsBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const hasMessages = (state?.chat?.length || 0) > 0
      if (hasMessages) {
        showToast(t('workspace_locked_in_chat'))
        return
      }
      openWsQuickPicker()
    })
  }

  function openWsQuickPicker() {
    const picker = wsQuickPicker
    if (!picker) return

    // 定位：相对于 emptyWsBtn
    const anchor = emptyWsBtn
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    picker.style.top = (rect.bottom + window.scrollY + 4) + 'px'
    picker.style.left = (rect.left + window.scrollX) + 'px'

    if (wsQuickListEl) wsQuickListEl.innerHTML = '<div class="ws-quick-loading">…</div>'
    picker.hidden = false

    wsLoadRecent('').then(() => {
      if (picker.hidden) return
      let html = ''
      const cur = (state && state.workspace && state.workspace.dir) || ''
      if (wsRecentCache.length > 0) {
        wsRecentCache.slice(0, 5).forEach(item => {
          const active = item.dir === cur ? ' active' : ''
          html += `<div class="ws-quick-item${active}" data-dir="${escapeHtml(item.dir)}">
            <span class="ws-quick-name">${escapeHtml(wsShortName(item.dir) || item.dir)}</span>
            <span class="ws-quick-count">${item.count || 0}</span>
          </div>`
        })
      } else {
        html += `<div class="ws-quick-empty">${escapeHtml(t('no_workspaces') || '暂无工作区')}</div>`
      }
      if (wsQuickListEl) wsQuickListEl.innerHTML = html

      // 点击已有工作区 = 切换
      if (wsQuickListEl) {
        wsQuickListEl.querySelectorAll('.ws-quick-item').forEach(item => {
          item.addEventListener('click', () => {
            hideWsQuickPicker()
            submitWorkspaceChange({ dir: item.dataset.dir, syncTui: false })
          })
        })
      }
    }).catch(() => {
      if (wsQuickListEl && !picker.hidden) wsQuickListEl.innerHTML = '<div class="ws-quick-empty">加载失败</div>'
    })
  }

  function hideWsQuickPicker() {
    if (wsQuickPicker) wsQuickPicker.hidden = true
  }

  // 点击 quick picker 外部关闭
  document.addEventListener('click', (e) => {
    if (wsQuickPicker && !wsQuickPicker.hidden && !wsQuickPicker.contains(e.target)) {
      const anchor = emptyWsBtn
      if (!anchor || !anchor.contains(e.target)) hideWsQuickPicker()
    }
  })

  // 「添加工作区」按钮（HTML 中的静态按钮）
  wsQuickAddBtn?.addEventListener('click', (e) => {
    e.stopPropagation()
    hideWsQuickPicker()
    openWsPicker()
  })

  // 点击 popover 外关掉
  document.addEventListener('click', (e) => {
    if (wsPicker && !wsPicker.hidden && !wsPicker.contains(e.target) && e.target.id !== 'chip-workspace' && !(wsChip && wsChip.contains(e.target))) {
      wsPicker.hidden = true
    }
  })

  // v0.5.bh: 监听网络状态变化，实时更新顶栏在线指示
  window.addEventListener('online',  () => { try { render() } catch (e) {} })
  window.addEventListener('offline', () => { try { render() } catch (e) {} })

  // v0.5.al: 启动时恢复 localStorage 保存的工作区
  try {
    const last = localStorage.getItem(WS_LAST_KEY)
    if (last) {
      // 等首屏 render 完再切（state 已有 workspace 时不覆盖）—— 但 server 端默认 workspace 跟 saved 不同才切
      fetch('/api/workspace' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify({ action: 'detect' }),
      }).then(r => r.json()).then(data => {
        if (data && data.current !== last) {
          // server 默认跟 saved 不一样 → 恢复
          return fetch('/api/workspace' + API_SUFFIX, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...HEADERS },
            body: JSON.stringify({ dir: last, syncTui: false }),
          })
        }
      }).catch(() => {})
    }
  } catch {}

  // v0.5.aq: chip-lan — v1.0.1 起改为"点开二级卡片"入口（不再直接 toggle LAN）
  const chipLan = document.getElementById('chip-lan')
  // v0.5.bp: 顶栏 LAN 访问链接 chip（LAN on 时显示当前 IP，点复制完整 URL）
  const chipLanLink = document.getElementById('chip-lan-link')
  const chipLanLinkText = document.getElementById('chip-lan-link-text')

  // v1.0.1: 二级卡片 DOM 引用
  const lanCard = document.getElementById('lan-card')
  const lanCardBroadcast = document.getElementById('lan-card-broadcast')
  const lanCardReadonly = document.getElementById('lan-card-readonly')
  const lanCardTokenAuth = document.getElementById('lan-card-token-auth')
  const lanCardTokenMask = document.getElementById('lan-card-token-mask')
  const lanCardTokenValue = document.getElementById('lan-card-token-value')
  const lanCardTokenRow = document.getElementById('lan-card-token-row')
  const lanCardTokenToggle = document.getElementById('lan-card-token-toggle')
  const lanCardTokenCopy = document.getElementById('lan-card-token-copy')
  const lanCardTokenWarning = document.getElementById('lan-card-token-warning')
  const lanCardTokenReset = document.getElementById('lan-card-token-reset')
  const lanCardTokenAck = document.getElementById('lan-card-token-ack')

  // 二级卡片开/合（chip-lan click）
  function setLanCardOpen(open) {
    if (!lanCard || !chipLan) return
    lanCard.hidden = !open
    chipLan.setAttribute('aria-expanded', open ? 'true' : 'false')
  }
  function toggleLanCard() {
    setLanCardOpen(lanCard ? lanCard.hidden : false)
  }

  // 点击 chip = 切二级卡片
  if (chipLan) {
    chipLan.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleLanCard()
    })
  }

  // 点击 chip 外部关闭卡片
  document.addEventListener('click', (e) => {
    if (!lanCard || lanCard.hidden) return
    if (lanCard.contains(e.target) || chipLan.contains(e.target)) return
    setLanCardOpen(false)
  })

  async function loadLanInfo() {
    try {
      const r = await fetch('/api/settings' + API_SUFFIX, { headers: HEADERS })
      const d = await r.json()
      if (!d.ok) return
      // v0.5.bp: 顶栏链接 chip 始终更新 URL（data-lan-url 留着点复制时用），可见性由 render() 决定
      // v1.0.1: 用 lanUrlWithToken (含 ?token=xxx) 复制给远程设备, 显示只用 lanUrl
      //   (host:port) — 防止 token 露在 top-bar 文本上
      if (chipLanLink) {
        chipLanLink.setAttribute('data-lan-url', d.lanUrlWithToken || d.lanUrl || '')
        if (chipLanLinkText) {
          const u = (d.lanUrl || '').replace(/^https?:\/\//, '')
          chipLanLinkText.textContent = u || '—'
        }
      } else {
        console.warn('[lan] chipLanLink NOT found in DOM — element missing?')
      }
      // v1.0.1: 把 settings 同步到 state, sub-card 渲染靠 state
      if (state) {
        state.lanBroadcast = d.lanBroadcast
        state.readOnly = d.readOnly
        state.tokenEnabled = d.tokenEnabled
        state.tokenAcknowledged = d.tokenAcknowledged
        state.currentToken = d.currentToken || ''
        state.tokenRotatedAt = d.tokenRotatedAt || 0
        // v2026-08-28 modacker: Token Plan feature state. The popover
        // (renderUsagePopover in state.js) reads these directly, so
        // just keep them in sync. The appearance-card-quota checkbox
        // is also synced from here.
        // v2026-08-28 modacker (A+C): also sync the external key
        //   source + file path so the modal can show "managed by
        //   env / file" and hide the "delete" button when the key
        //   is external. See server/lib/settings.js for the
        //   priority chain.
        state.quotaEnabled = d.quotaEnabled === true
        state.hasTokenPlanKey = d.hasTokenPlanKey === true
        state.tokenPlanApiKeyMasked = d.tokenPlanApiKeyMasked || ''
        state.tokenPlanApiKeySource = d.tokenPlanApiKeySource || ''
        state.tokenPlanApiKeyFilePath = d.tokenPlanApiKeyFilePath || ''
        const apCardQuota = document.getElementById('appearance-card-quota')
        if (apCardQuota) apCardQuota.checked = d.quotaEnabled === true
      }
      // Refresh the popover if it's open (otherwise the next click
      // will re-render via the click handler).
      try {
        const popover = document.getElementById('usage-popover')
        if (popover && !popover.hidden) renderUsagePopover()
      } catch {}
    } catch (e) { console.error('[lan] load failed', e) }
  }
  loadLanInfo()  // 启动时拉一次

  // v0.5.bp: 顶栏 LAN 链接点击 = 复制完整 URL 到剪贴板
  if (chipLanLink) {
    chipLanLink.addEventListener('click', async (e) => {
      e.preventDefault()
      const url = chipLanLink.getAttribute('data-lan-url') || ''
      if (!url) return
      try {
        await navigator.clipboard.writeText(url)
        showToast(t('copy_success') + ': ' + url, 1500)
      } catch (err) {
        showToast(t('copy_failed') + ': ' + err.message, 2000)
      }
    })
  }

  // ----------------------------------------------------------------
  // v1.0.1: sub-card handlers
  // ----------------------------------------------------------------

  // LAN 广播 toggle (在卡片里)
  if (lanCardBroadcast) {
    lanCardBroadcast.addEventListener('change', async (e) => {
      const enabled = !!e.target.checked
      try {
        const r = await fetch('/api/settings' + API_SUFFIX, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...HEADERS },
          body: JSON.stringify({ lanBroadcast: enabled }),
        })
        const d = await r.json()
        if (!d.ok) { alert('切换失败: ' + (d.error || '未知错误')); e.target.checked = !enabled; return }
        if (state) state.lanBroadcast = enabled
        render()
        showToast(enabled ? t('lan_title_on') : t('lan_title_off'))
      } catch (err) {
        console.error('[lan] toggle failed', err)
        alert('切换失败: ' + err.message)
        e.target.checked = !enabled
      }
    })
  }

  // 只读模式 toggle
  if (lanCardReadonly) {
    lanCardReadonly.addEventListener('change', async (e) => {
      const enabled = !!e.target.checked
      try {
        const r = await fetch('/api/settings' + API_SUFFIX, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...HEADERS },
          body: JSON.stringify({ readOnly: enabled }),
        })
        const d = await r.json()
        if (!d.ok) { alert('切换失败: ' + (d.error || '未知错误')); e.target.checked = !enabled; return }
        if (state) state.readOnly = enabled
        render()
      } catch (err) {
        console.error('[lan] readOnly toggle failed', err)
        alert('切换失败: ' + err.message)
        e.target.checked = !enabled
      }
    })
  }

  // Token 鉴权 toggle
  if (lanCardTokenAuth) {
    lanCardTokenAuth.addEventListener('change', async (e) => {
      const enabled = !!e.target.checked
      try {
        const r = await fetch('/api/settings' + API_SUFFIX, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...HEADERS },
          body: JSON.stringify({ tokenEnabled: enabled }),
        })
        const d = await r.json()
        if (!d.ok) { alert('切换失败: ' + (d.error || '未知错误')); e.target.checked = !enabled; return }
        if (state) state.tokenEnabled = enabled
        render()
      } catch (err) {
        console.error('[lan] tokenEnabled toggle failed', err)
        alert('切换失败: ' + err.message)
        e.target.checked = !enabled
      }
    })
  }

  // Token 显示/隐藏 — 用 row 事件代理, row 内部 HTML 被 renderLanCardContent
  // 替换时 (acknowledged 后) 新的按钮自动继承 handler, 不需要重新 bind
  if (lanCardTokenRow) {
    lanCardTokenRow.addEventListener('click', (e) => {
      const toggleBtn = e.target.closest('#lan-card-token-toggle')
      const copyBtn = e.target.closest('#lan-card-token-copy')
      if (toggleBtn) {
        const valueEl = document.getElementById('lan-card-token-value')
        const maskEl = document.getElementById('lan-card-token-mask')
        if (!valueEl || !maskEl) return
        const showing = !valueEl.hidden
        if (showing) {
          valueEl.hidden = true
          maskEl.hidden = false
          toggleBtn.textContent = t('lan_card_token_show')
        } else {
          valueEl.hidden = false
          maskEl.hidden = true
          toggleBtn.textContent = t('lan_card_token_hide')
        }
        return
      }
      if (copyBtn) {
        const tok = (state && state.currentToken) || ''
        if (!tok) {
          showToast(t('lan_card_token_value') + ': (empty)', 1500)
          return
        }
        ;(async () => {
          try {
            await navigator.clipboard.writeText(tok)
            showToast(t('lan_card_token_copied'), 1500)
          } catch (err) {
            showToast(t('copy_failed') + ': ' + err.message, 2000)
          }
        })()
        return
      }
    })
  }

  // Token 重置
  if (lanCardTokenReset) {
    lanCardTokenReset.addEventListener('click', async () => {
      if (!confirm(t('lan_card_reset_token_confirm'))) return
      try {
        const r = await fetch('/api/settings' + API_SUFFIX, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...HEADERS },
          body: JSON.stringify({ resetToken: true }),
        })
        const d = await r.json()
        if (!d.ok || d.tokenRotated !== true) {
          alert('重置失败: ' + (d.error || '未知错误'))
          return
        }
        // 服务端已通过 SSE 推送新 token (auth.token_rotated) — 我们的 setToken handler 会更新 localStorage + HEADERS
        // 这里再把 state 同步一下, 让 UI 立即反映
        if (state) {
          state.currentToken = d.currentToken || ''
          state.tokenAcknowledged = false
          state.tokenRotatedAt = d.tokenRotatedAt || Date.now()
        }
        // 强制显示新 token (因为 acknowledged 重置为 false)
        if (lanCardTokenValue) lanCardTokenValue.hidden = false
        if (lanCardTokenMask) lanCardTokenMask.hidden = true
        if (lanCardTokenToggle) lanCardTokenToggle.textContent = t('lan_card_token_hide')
        render()
        showToast(t('lan_card_token_rotated_toast'), 2000)
      } catch (err) {
        console.error('[lan] resetToken failed', err)
        alert('重置失败: ' + err.message)
      }
    })
  }

  // "我已保存" — 确认 token, 之后服务端不再下发 currentToken
  if (lanCardTokenAck) {
    lanCardTokenAck.addEventListener('click', async () => {
      try {
        const r = await fetch('/api/settings' + API_SUFFIX, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...HEADERS },
          body: JSON.stringify({ acknowledgeToken: true }),
        })
        const d = await r.json()
        if (!d.ok) { alert('确认失败: ' + (d.error || '未知错误')); return }
        if (state) {
          state.tokenAcknowledged = true
          state.currentToken = ''
        }
        render()
      } catch (err) {
        console.error('[lan] acknowledgeToken failed', err)
        alert('确认失败: ' + err.message)
      }
    })
  }

  // ----------------------------------------------------------------
  // v2026-08-28 modacker: API Key 配置模态框 handlers.
  // 由 popover 底部状态按钮唤起,save / delete / cancel / close / Esc
  // ----------------------------------------------------------------
  const apiKeyModal = document.getElementById('api-key-modal')
  const apiKeyInput = document.getElementById('api-key-modal-input')
  const apiKeySave = document.getElementById('api-key-modal-save')
  const apiKeyDelete = document.getElementById('api-key-modal-delete')
  const apiKeyCancel = document.getElementById('api-key-modal-cancel')
  const apiKeyClose = document.getElementById('api-key-modal-close')

  async function saveApiKey() {
    const k = (apiKeyInput?.value || '').trim()
    if (!k) { showToast(t('quota_need_key') || '请先填入 Subscription Key'); return }
    try {
      const r = await fetch('/api/settings' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify({ tokenPlanApiKey: k, quotaEnabled: true }),
      })
      const d = await r.json()
      if (!d.ok) { showToast(d.error || '保存失败'); return }
      if (apiKeyInput) apiKeyInput.value = ''
      if (state) {
        state.quotaEnabled = d.quotaEnabled === true
        state.hasTokenPlanKey = d.hasTokenPlanKey === true
        state.tokenPlanApiKeyMasked = d.tokenPlanApiKeyMasked || ''
      }
      try { await fetch('/api/usage' + API_SUFFIX, { method: 'POST', headers: HEADERS }) } catch {}
      renderUsage()
      closeApiKeyModal()
      showToast(t('quota_saved') || '已保存')
    } catch (err) {
      console.error('[api-key-modal] save failed', err)
    }
  }

  async function deleteApiKey() {
    if (!confirm(t('quota_clear_confirm') || '确定清空 Subscription Key?清空后套餐用量数据不显示。')) return
    try {
      await fetch('/api/settings' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify({ tokenPlanApiKey: '' }),
      })
      if (state) {
        state.hasTokenPlanKey = false
        state.tokenPlanApiKeyMasked = ''
      }
      try { await fetch('/api/usage' + API_SUFFIX, { method: 'POST', headers: HEADERS }) } catch {}
      renderUsage()
      closeApiKeyModal()
      showToast(t('quota_cleared') || '已清空')
    } catch (err) {
      console.error('[api-key-modal] delete failed', err)
    }
  }

  if (apiKeySave) apiKeySave.addEventListener('click', saveApiKey)
  if (apiKeyDelete) apiKeyDelete.addEventListener('click', deleteApiKey)
  if (apiKeyCancel) apiKeyCancel.addEventListener('click', closeApiKeyModal)
  if (apiKeyClose) apiKeyClose.addEventListener('click', closeApiKeyModal)
  // Click outside the modal-card to close
  if (apiKeyModal) {
    apiKeyModal.addEventListener('click', (e) => {
      if (e.target === apiKeyModal) closeApiKeyModal()
    })
  }
  // Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && apiKeyModal && !apiKeyModal.hidden) {
      closeApiKeyModal()
    }
  })
  // Enter to save when input focused
  if (apiKeyInput) {
    apiKeyInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveApiKey()
    })
  }

  // New chat
  // v0.5.ar: 新建会话 → 弹工作区选择 popover（选完工作区再调 /api/sessions）
  // v0.5.bx-33 (v1.2): 已删除 new-chat-ws-picker，改用 chat-empty-workspace chip 下拉
  const newChatPicker = document.getElementById('new-chat-ws-picker')
  const newChatCurrent = document.getElementById('new-chat-current-ws')
  const newChatList = document.getElementById('new-chat-ws-list')
  const newChatCancel = document.getElementById('new-chat-ws-cancel')
  const newChatOther = document.getElementById('new-chat-ws-other')
  // 仅在元素存在时初始化（兼容旧版 picker，v1.2+ 已移除）
  if (newChatPicker) {
  function positionNewChatPicker() {
    const btn = document.getElementById('btn-new-chat')
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    newChatPicker.style.top = (rect.bottom + 6) + 'px'
    newChatPicker.style.left = rect.left + 'px'
  }
  function openNewChatPicker() {
    // 收集所有已知 workspace（当前 + 所有 session 所属 workspace，去重）
    const currentWs = (state && state.workspace && state.workspace.dir) || ''
    const wsSet = new Set()
    if (currentWs) wsSet.add(currentWs)
    ;(state && state.sessions || []).forEach(s => { if (s.workspace) wsSet.add(s.workspace) })
    const wsList = [...wsSet]
    newChatCurrent.textContent = currentWs || '—'
    // 渲染列表（按当前工作区在顶 + 字母序）
    wsList.sort((a, b) => {
      if (a === currentWs) return -1
      if (b === currentWs) return 1
      return a.localeCompare(b)
    })
    newChatList.innerHTML = wsList.map(ws => {
      const count = (state.sessions || []).filter(s => s.workspace === ws).length
      const isCurrent = ws === currentWs
      const folderSvg = '<svg class="icon ws-picker-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
      return `<button class="ws-picker-item${isCurrent ? ' current' : ''}" data-ws="${escapeHtml(ws)}">
        ${folderSvg}
        <span class="ws-picker-item-text" title="${escapeHtml(ws)}">${escapeHtml(ws)}</span>
        <span class="ws-picker-item-count">${count}</span>
      </button>`
    }).join('')
    newChatList.querySelectorAll('.ws-picker-item').forEach(it => {
      it.addEventListener('click', async (e) => {
        e.stopPropagation()
        const ws = it.getAttribute('data-ws')
        newChatPicker.hidden = true
        await createNewSession(ws)
      })
    })
    positionNewChatPicker()
    newChatPicker.hidden = false
  }
  newChatCancel.addEventListener('click', () => { newChatPicker.hidden = true })
  newChatOther.addEventListener('click', async () => {
    // 走现有的 workspace-picker 流程：调 /api/workspace set 后再创建
    const dir = prompt('输入工作区路径（例如 D:\\\\projects\\\\myapp）')
    if (!dir || !dir.trim()) return
    newChatPicker.hidden = true
    try {
      const r = await fetch('/api/workspace' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify({ dir: dir.trim(), syncTui: true }),
      })
      const d = await r.json()
      if (!d.ok) { alert('切换工作区失败: ' + (d.error || '未知错误')); return }
    } catch (e) { alert('切换工作区失败: ' + e.message); return }
    await createNewSession(dir.trim())
  })
  // 点击 popover 外关闭
  document.addEventListener('click', (e) => {
    if (newChatPicker.hidden) return
    if (!newChatPicker.contains(e.target) && e.target.id !== 'btn-new-chat' && !e.target.closest('#btn-new-chat')) {
      newChatPicker.hidden = true
    }
  })
  } // end if (newChatPicker)

  async function createNewSession(workspace) {
    // v0.5.ak: mcode 还在跑时禁止清空 chat
    if (state && state.running && state.running.active) {
      alert('AI 还在回复中，请先等回复完成或点 ⏹ 停止。\n\n如果要开启新话题，先停止当前任务。')
      return
    }
    try {
      const r = await fetch('/api/sessions' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify({ workspace: workspace || undefined })
      })
      const d = await r.json()
      if (!d.ok) { alert('创建会话失败: ' + (d.error || '未知错误')); return }
      // 触发 SSE 拉取 state（server 端会推）
      if (typeof loadState === 'function') loadState()
    } catch (e) { console.error(e) }
  }

  document.getElementById('btn-new-chat').addEventListener('click', (e) => {
    e.stopPropagation()
    if (state && state.running && state.running.active) {
      alert('AI 还在回复中，请先等回复完成或点 ⏹ 停止。\n\n如果要开启新话题，先停止当前任务。')
      return
    }
    // v0.5.ax: "新建会话" = 切回 welcome 状态（清空当前 sessionId + chat 数组）
    // 真正的 session 创建推迟到用户发第一条消息时（带当前 workspace）
    clearCurrentSession()
  })

  // v0.5.bx-33: 删 "清理孤儿" 按钮 (用户反馈不要这个功能) — 按钮 + handler + API 一起删
  //   之前: index.html btn-cleanup-orphans + main.js click handler + router.js 路由 + handleCleanupOrphans
  //   现在: 全部清掉,代码干净,用户改主意找 git history

  // v0.5.ax: 清空当前 session，回到 welcome 页（不创建新 session，等用户发消息时再创建）
  function clearCurrentSession() {
    if (state) {
      state.sessionId = null
      state.mcodeSessionId = null
      state.sessionTitle = 'Untitled'
      state.chat = []
      state.goal = { active: false, text: null, status: null, duration: null }
      state.todo = []
      // 不改 state.workspace — 保留当前工作区（welcome 页显示短名）
    }
    // 关掉所有 popover
    document.querySelectorAll('.mode-popover, .settings-menu, .model-picker, .workspace-picker, .new-chat-picker').forEach(el => { el.hidden = true })
    newChatPicker.hidden = true
    render()
  }

  // Mobile toggles
  // v0.5.bx-37: 强制刷新按钮 — 手机/平板浏览器 hard refresh 麻烦, 一键绕过 HTTP cache
  //   行为: fetch 关键资源 (main.js/main.css/index.html) 用 cache:'reload' 覆盖 HTTP cache
  //   之后再 location.reload() 加载新版本
  document.getElementById('chip-force-reload').addEventListener('click', async () => {
    const btn = document.getElementById('chip-force-reload')
    if (btn) { btn.disabled = true; btn.classList.add('loading') }
    try {
      await Promise.allSettled([
        fetch('/app/main.js', { cache: 'reload' }),
        fetch('/styles/main.css', { cache: 'reload' }),
        fetch('/', { cache: 'reload' }),
      ])
    } catch {}
    location.reload()
  })
  document.getElementById('btn-toggle-left').addEventListener('click', () => {
    setLeftOpen(!leftOpen)
    document.getElementById('left-panel').classList.toggle('open', leftOpen)
    document.getElementById('drawer-backdrop').classList.toggle('show', leftOpen || rightOpen)
  })
  document.getElementById('btn-toggle-right').addEventListener('click', () => {
    setRightOpen(!rightOpen)
    document.getElementById('right-panel').classList.toggle('open', rightOpen)
    document.getElementById('drawer-backdrop').classList.toggle('show', leftOpen || rightOpen)
  })
  document.getElementById('drawer-backdrop').addEventListener('click', () => {
    setLeftOpen(false); setRightOpen(false)
    document.getElementById('left-panel').classList.remove('open')
    document.getElementById('right-panel').classList.remove('open')
    document.getElementById('drawer-backdrop').classList.remove('show')
  })

  // Chat hints
  document.querySelectorAll('.chat-hint').forEach(h => {
    h.addEventListener('click', () => {
      const cmd = h.getAttribute('data-cmd')
      fetch('/api/cmd' + API_SUFFIX, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...HEADERS },
        body: JSON.stringify({ cmd })
      })
    })
  })

  // Drop zone
  const chatArea = document.getElementById('chat-area')
  const dropOverlay = document.getElementById('dropzone-overlay')
  ;['dragenter', 'dragover'].forEach(ev => {
    chatArea.addEventListener(ev, (e) => {
      e.preventDefault()
      dropOverlay.classList.add('show')
    })
  })
  ;['dragleave', 'drop'].forEach(ev => {
    chatArea.addEventListener(ev, (e) => {
      e.preventDefault()
      if (ev === 'dragleave' && e.relatedTarget) return
      dropOverlay.classList.remove('show')
    })
  })
  chatArea.addEventListener('drop', async (e) => {
    e.preventDefault()
    if (e.dataTransfer?.files?.length > 0) {
      await uploadFiles(e.dataTransfer.files)
    }
  })

  // Slash overlay click
  slashResults.addEventListener('click', (e) => {
    const item = e.target.closest('.slash-item')
    if (item?.getAttribute('data-cmd')) {
      const cmd = item.getAttribute('data-cmd')
      slashQuery = cmd
      selectSlash()
    }
  })
  // v0.5.bx-21: 鼠标 hover slash item 切 active idx (跟键盘 ArrowUp/Down 一致)
  //   之前只有 click → 直接 selectSlash, 没切换高亮. Wzdhehe 反馈 "鼠标点别的, 只会选中help"
  //   修: mouseenter 切 slashActiveIdx + 重新渲染 active class
  //   注意: 不绑 mouseleave, 否则用户键盘移到 /new 后鼠标移走又跳回 /help
  slashResults.addEventListener('mouseover', (e) => {
    const item = e.target.closest('.slash-item')
    if (!item || !item.getAttribute('data-cmd')) return
    const idx = parseInt(item.getAttribute('data-idx') || '-1', 10)
    if (idx < 0 || idx === slashActiveIdx) return
    slashActiveIdx = idx
    slashResults.querySelectorAll('.slash-item').forEach((el, i) => {
      el.classList.toggle('active', i === slashActiveIdx)
    })
  })
  slashInput.addEventListener('input', (e) => {
    slashQuery = e.target.value
    filterSlash()
  })
  slashInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSlash(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSlash(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); selectSlash() }
    else if (e.key === 'Escape') { e.preventDefault(); hideSlash(); textarea.focus() }
    else if (e.key === 'Tab') { e.preventDefault(); selectSlash() }
  })

  // Document click to close popovers
  document.addEventListener('click', (e) => {
    if (modeOpen && !modePopover.contains(e.target) && e.target.id !== 'btn-mode' && !document.getElementById('btn-mode').contains(e.target)) {
      hideMode()
    }
    // v0.5.z: 点 popover 外面就关（btn-usage click 用 stopPropagation 自己处理开关）
    const up = document.getElementById('usage-popover')
    const ub = document.getElementById('btn-usage')
    if (up && !up.hidden && ub && !up.contains(e.target) && !ub.contains(e.target)) {
      toggleUsagePopover(false)
    }
    // v0.5.aq: settings modal 已删，不再需要这层 backdrop 检查
  })

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Modal shortcuts 优先
    // v0.5.bx-14: 旧 askOpen keydown 块已删, ask_user 弹窗自己有 keydown 监听 (bindAskModal)
    if (planOpen) {
      if (e.key >= '1' && e.key <= '3') {
        e.preventDefault()
        const actions = ['agree', 'skip', 'add']
        const action = actions[parseInt(e.key, 10) - 1]
        if (action === 'add') {
          const ta = document.getElementById('plan-add-context')
          ta.hidden = !ta.hidden
          if (!ta.hidden) ta.focus()
        }
        sendPlanAnswer(action)
        return
      } else if (e.key === 'Enter') {
        e.preventDefault()
        sendPlanAnswer('agree')
        return
      }
    }
    if (planModeOpen) {
      if (e.key === '1' || e.key === 'Enter') { e.preventDefault(); sendPlanModeAnswer('continue'); return }
      else if (e.key === '2' || e.key === 'Escape') { e.preventDefault(); sendPlanModeAnswer('deny'); return }
    }
    if (permOpen) {
      const map = { '1': 'ask', '2': 'auto', '3': 'full' }
      if (map[e.key]) { e.preventDefault(); sendPermAnswer(map[e.key]); return }
    }
    // Esc 关所有浮层
    if (e.key === 'Escape') {
      if (slashOpen) hideSlash()
      else if (modeOpen) hideMode()
      else { const up2 = document.getElementById('usage-popover'); if (up2 && !up2.hidden) toggleUsagePopover(false) }
    }
    // Ctrl+K / Cmd+K 聚焦输入
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      textarea.focus()
    }
  })
}

export function moveSlash(delta) {
  if (slashFiltered.length === 0) return
  slashActiveIdx = (slashActiveIdx + delta + slashFiltered.length) % slashFiltered.length
  slashResults.querySelectorAll('.slash-item').forEach((el, i) => {
    el.classList.toggle('active', i === slashActiveIdx)
    if (i === slashActiveIdx) el.scrollIntoView({ block: 'nearest' })
  })
}

export function selectSlash() {
  if (slashFiltered.length === 0) return
  const cmd = slashFiltered[slashActiveIdx].cmd
  const textarea = document.getElementById('input-textarea')
  textarea.value = cmd
  textarea.focus()
  hideSlash()
}

export function toggleLang() {
  setLang(currentLang === 'zh' ? 'en' : 'zh')
  localStorage.setItem('webui-lang', currentLang)
  applyI18n()
  render()
}

// ============================================================
// v0.5.bx-14: 旧 Ask Modal (v0.4.0) 已删除 — showAsk/hideAsk/renderAsk/sendAskAnswer
//   旧代码用 /api/answer endpoint (server 没实现, 一直 404)
//   新 ask_user 弹窗用 v0.5.bx-13 的 #ask-modal + /api/send (isAskAnswer:true)
// ============================================================

// ============================================================
// Plan Review Modal (v0.4.0)
// ============================================================
export function showPlan() {
  if (!state?.plan?.active) return
  planOpen = true
  document.getElementById('plan-modal').classList.add('show')
  renderPlan()
}
export function hidePlan() {
  planOpen = false
  document.getElementById('plan-modal').classList.remove('show')
}
export function renderPlan() {
  const p = state?.plan
  if (!p || !p.active) { hidePlan(); return }
  document.getElementById('plan-title').textContent = p.title || 'Plan'
  const summaryEl = document.getElementById('plan-summary')
  if (p.summary) {
    summaryEl.textContent = p.summary
    summaryEl.classList.remove('plan-summary-empty')
  } else {
    summaryEl.innerHTML = '<div class="plan-summary-empty">没有 Summary</div>'
  }
  document.getElementById('plan-frozen').textContent = p.totalLines > 0
    ? `Frozen · Lines 1-${Math.min(p.totalLines, 9999)} of ${p.totalLines}`
    : 'Frozen Runtime snapshot'
  const optsEl = document.getElementById('plan-options')
  const labels = (p.options && p.options.length > 0)
    ? p.options.map(o => o.label)
    : ['Agree and start implementation', 'Skip for now', 'Add context to revise']
  optsEl.innerHTML = labels.map((label, i) => {
    const primary = i === 0 ? ' primary' : ''
    return `<button class="plan-option${primary}" data-action="${['agree', 'skip', 'add'][i] || 'agree'}">
      <span class="plan-option-num">${i + 1}</span>
      <span class="plan-option-label">${escapeHtml(label)}</span>
    </button>`
  }).join('')
  optsEl.querySelectorAll('.plan-option').forEach(el => {
    el.addEventListener('click', () => {
      const action = el.getAttribute('data-action')
      if (action === 'add') {
        const ta = document.getElementById('plan-add-context')
        ta.hidden = !ta.hidden
        if (!ta.hidden) ta.focus()
      }
      sendPlanAnswer(action)
    })
  })
}
export async function sendPlanAnswer(action) {
  if (planSending) return
  planSending = true
  try {
    const ta = document.getElementById('plan-add-context')
    const extra = (action === 'add' && ta?.value) ? `\n${ta.value}` : ''
    await fetch('/api/answer' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ type: 'plan', option: action })
    })
    hidePlan()
  } catch (e) {
    console.error('plan answer', e)
  } finally {
    planSending = false
  }
}

// ============================================================
// EnterPlanMode Modal (v0.4.0)
// ============================================================
export function showPlanMode() {
  if (!state?.enterPlanMode?.active) return
  planModeOpen = true
  document.getElementById('planmode-modal').classList.add('show')
}
export function hidePlanMode() {
  planModeOpen = false
  document.getElementById('planmode-modal').classList.remove('show')
}
export async function sendPlanModeAnswer(choice) {
  try {
    await fetch('/api/answer' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ type: 'planmode', option: choice })
    })
    hidePlanMode()
  } catch (e) { console.error('planmode answer', e) }
}

// ============================================================
// Permission Modal (v0.4.0)
// ============================================================
export function showPerm() {
  if (!state?.permissionChoice?.active) return
  permOpen = true
  document.getElementById('perm-modal').classList.add('show')
  renderPerm()
}
export function hidePerm() {
  permOpen = false
  document.getElementById('perm-modal').classList.remove('show')
}
export function renderPerm() {
  const p = state?.permissionChoice
  if (!p || !p.active) { hidePerm(); return }
  document.getElementById('perm-current').textContent = `Current · ${p.current || '—'}`
}
export async function sendPermAnswer(choice) {
  try {
    await fetch('/api/answer' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ type: 'permission', option: choice })
    })
    hidePerm()
  } catch (e) { console.error('perm answer', e) }
}

// ============================================================
// 弹窗触发（render 时自动检测）
// ============================================================
export function checkModals() {
  // v0.5.bx-14: 旧 Ask 分支已删 (旧 modal 删了, 用 v0.5.bx-13 的 #ask-modal 替代, 由 openAskModal 触发)
  // Plan
  const p = state?.plan
  if (p?.active) {
    const key = `p-${p.title}-${p.summaryLines}-${p.totalLines}`
    if (key !== lastShownPlanKey) { lastShownPlanKey = key; showPlan() }
  } else {
    lastShownPlanKey = null
    if (planOpen) hidePlan()
  }
  // EnterPlanMode
  const pm = state?.enterPlanMode
  if (pm?.active) {
    if (lastShownPlanModeKey !== 'on') { lastShownPlanModeKey = 'on'; showPlanMode() }
  } else {
    lastShownPlanModeKey = null
    if (planModeOpen) hidePlanMode()
  }
  // Permission
  const pe = state?.permissionChoice
  if (pe?.active) {
    const key = `pe-${pe.current}-${pe.options?.length || 0}`
    if (key !== lastShownPermKey) { lastShownPermKey = key; showPerm() }
  } else {
    lastShownPermKey = null
    if (permOpen) hidePerm()
  }
}

// ============================================================
// Modal 事件绑定
// ============================================================
export function attachModalEvents() {
  // v0.5.bx-27: 所有 getElementById 加 null check — 老 modal 元素 (ask-close/plan-modal 等) v0.5.bx-14 已删,
  //   但 attachModalEvents 还在引用 → null.addEventListener 报 TypeError → 整个 init 失败 → 页面没 JS
  //   现在每个都检查, 元素不存在就跳过 — 单个缺失不影响整体
  const $ = (id) => document.getElementById(id)
  const on = (id, evt, fn) => { const e = $(id); if (e) e.addEventListener(evt, fn) }

  // Ask (v0.5.bx-14: 旧 ask-close 元素已删, ask-modal 是新元素)
  on('ask-close', 'click', () => {
    fetch('/api/answer' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ type: 'ask', option: 'esc' })
    }).catch(() => {})
    closeAskModal()
  })
  on('ask-modal', 'click', (e) => {
    if (e.target.id === 'ask-modal') closeAskModal()
  })
  // v2 (2026-09-20 webui-manual-audit): authorize modal Approve/Deny →
  // POST /api/auth/decision (state.js submitAuthDecision, which owns the
  // queue removal on 200/404). One decision per request: both buttons
  // disable on the first click and stay disabled while the POST is in
  // flight (render.js respects AUTH_MODAL_STATE.decidingRequestId and
  // does not re-enable them on re-render); fetch failure shows inside
  // the modal and re-enables so the user can retry. NEVER auto-approves
  // on any condition — countdown hitting 00:00 is visual only, the
  // server's 5-minute fail-closed timeout is the authority.
  const authApproveBtn = $('auth-modal-approve')
  const authDenyBtn = $('auth-modal-deny')
  const authErr = $('auth-modal-error')
  const decideAuth = async (approve) => {
    const req = getPendingAuthRequests()[0]
    if (!req) return
    // One decision per request: a POST for THIS head request already in
    // flight → ignore. (Compared by id, not truthiness — a stale id left
    // over from the previous, already-resolved head must not block the
    // next request's decision.)
    if (AUTH_MODAL_STATE.decidingRequestId === req.requestId) return
    AUTH_MODAL_STATE.decidingRequestId = req.requestId
    if (authApproveBtn) authApproveBtn.disabled = true
    if (authDenyBtn) authDenyBtn.disabled = true
    if (authErr) { authErr.hidden = true; authErr.textContent = '' }
    let r = null
    try {
      r = await submitAuthDecision(req.requestId, approve)
    } catch (e) {
      // network error — surface inside the modal + allow retry
      AUTH_MODAL_STATE.decidingRequestId = null
      if (authApproveBtn) authApproveBtn.disabled = false
      if (authDenyBtn) authDenyBtn.disabled = false
      if (authErr) {
        authErr.hidden = false
        authErr.textContent = `${t('auth_decision_failed')}: ${e?.message || String(e)}`
      }
      return
    }
    if (!(r && (r.ok || r.status === 404))) {
      // Real failure (400 / 5xx …) — surface + allow retry. 200/404 are
      // already handled inside submitAuthDecision (local queue removal
      // + modal re-render closes or advances).
      AUTH_MODAL_STATE.decidingRequestId = null
      if (authApproveBtn) authApproveBtn.disabled = false
      if (authDenyBtn) authDenyBtn.disabled = false
      if (authErr) {
        let msg = `${t('auth_decision_failed')}${r && r.status ? ' (HTTP ' + r.status + ')' : ''}`
        try {
          const j = await r.json()
          if (j && j.error) msg += ': ' + j.error
        } catch {}
        authErr.hidden = false
        authErr.textContent = msg
      }
    }
  }
  if (authApproveBtn) authApproveBtn.addEventListener('click', () => decideAuth(true))
  if (authDenyBtn) authDenyBtn.addEventListener('click', () => decideAuth(false))
  // Plan
  on('plan-close', 'click', () => {
    fetch('/api/answer' + API_SUFFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...HEADERS },
      body: JSON.stringify({ type: 'plan', option: 'skip' })
    }).catch(() => {})
    hidePlan()
  })
  on('plan-modal', 'click', (e) => {
    if (e.target.id === 'plan-modal') hidePlan()
  })
  // PlanMode
  on('planmode-close', 'click', () => sendPlanModeAnswer('deny'))
  on('planmode-modal', 'click', (e) => {
    if (e.target.id === 'planmode-modal') sendPlanModeAnswer('deny')
  })
  document.querySelectorAll('#planmode-options .choice-option').forEach(el => {
    el.addEventListener('click', () => sendPlanModeAnswer(el.getAttribute('data-choice')))
  })
  // Permission
  on('perm-close', 'click', () => hidePerm())
  on('perm-modal', 'click', (e) => {
    if (e.target.id === 'perm-modal') hidePerm()
  })
  document.querySelectorAll('#perm-options .choice-option').forEach(el => {
    el.addEventListener('click', () => sendPermAnswer(el.getAttribute('data-choice')))
  })
  // Esc 关弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (planOpen) { hidePlan() }
      else if (planModeOpen) { hidePlanMode() }
      else if (permOpen) { hidePerm() }
    }
  })
  // v0.5.bx-15 (改): 双击 logo 重置 ask_user 弹窗
  const topbarLogo = $('topbar-logo')
  if (topbarLogo) {
    topbarLogo.addEventListener('dblclick', () => {
      const hadKeys = ASK_MODAL_STATE.presentedKeys.size > 0
      ASK_MODAL_STATE.presentedKeys.clear()
      if (typeof showToast === 'function') {
        showToast(hadKeys ? t('ask_reopened') : t('ask_no_reset'))
      }
    })
  }
}

