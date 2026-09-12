# ACP surface probe — mcode 0.4.2 (2026-09-12)

实测环境: `releases/0.4.2`（`~/.minimax-code/current` 指向），Windows 11 / Node 24。
Probe 脚本: `acp-probe/probe-042*.mjs`（4 轮），原始结果 `acp-probe/probe-042*-result.json`。
方法存在性以**实测**为准 —— bundle 里能 grep 到的字符串（`session/search`、`session/tree`、
`session/root`、`session/delete`、`session/cancel` 等）**并未全部注册**到 ACP server。

## 1. initialize

`agentCapabilities`:
```json
{
  "loadSession": true,
  "mcpCapabilities": { "http": true, "sse": true },
  "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false },
  "sessionCapabilities": { "list": {}, "fork": {}, "resume": {}, "close": {} }
}
```
无 `serverInfo` 字段。协议版本 1。

## 2. 方法存在性矩阵（实测）

| 方法 | 0.4.2 状态 | 备注 |
|---|---|---|
| `session/new` {cwd, mcpServers} | ✅ | 返回 `{sessionId, modes{currentModeId,availableModes[]}, configOptions[]}` |
| `session/prompt` {sessionId, prompt:[{type:'text',text}]} | ✅ | 返回 `{stopReason}`；**response 无 usage 字段**（0.1.3 有） |
| `session/list` {} | ✅ | `{sessions:[{sessionId,cwd,updatedAt}]}`（title 需会话有标题才出现） |
| `session/load` {sessionId,cwd,mcpServers} | ✅ | 返回 modes/configOptions |
| `session/resume` {sessionId,cwd,mcpServers} | ✅ | 与 load 等价；**裸 {sessionId} → Invalid params**（0.2.4 可） |
| `session/activate` {sessionId} | ✅ | |
| `session/close` {sessionId} | ✅ | **turn 运行中 close = 取消**：prompt promise 以 `stopReason:"cancelled"` 返回 |
| `session/fork` {sessionId,cwd,mcpServers} | ⚠️ | 整会话分叉（无 atMessageId 参数）；缺 cwd → Invalid params；实测曾报 `message-boundary-not-found`，边界条件待查 |
| `session/set_mode` {sessionId,**modeId**} | ✅ | 参数名是 `modeId`（0.2.4 的 `{mode}` → Invalid params）；返回 `_meta.minimax-code/transition:"settled"` |
| `session/set_config_option` {sessionId,**configId**,value} | ✅ | value 必须为 string（select 控件）；返回更新后的 configOptions 并推 `config_option_update` |
| `mcode/session/queue/enqueue` {sessionId,text} | ✅ | `{itemId,status:"queued",position}`；**空闲时 enqueue 会自动投递开 turn** |
| `mcode/session/queue/list` {sessionId} | ✅ | 空闲时 `{items:[]}`（入队项被投递后即清空） |
| `mcode/session/queue/update` {sessionId,itemId,text} | ✅ | itemId 形如 `queue_<uuid>`（enqueue 返回值） |
| `mcode/session/queue/delete` {sessionId,itemId} | ✅ | itemId 为空报 `itemId must be a non-empty string` |
| `mcode/session/queue/steer` {sessionId,itemId} | ⚠️ | 需 admitted active turn，否则 Internal error |
| `mcode/session/steer` {sessionId,text} | ✅ | 需 admitted active turn；`{turnId,mode:"steered"}`， steer 后模型按新指令重启 turn |
| `mcode/session/goal/get` {sessionId} | ✅ | |
| `mcode/session/goal/create` {sessionId,objective,tokenBudget?} | ✅ | `{goal:{goalId,objective,status:"active",createdAt,updatedAt,tokensUsed…}}` |
| `mcode/session/goal/patch` {sessionId,status?/objective?/tokenBudget?} | ✅ | |
| `mcode/session/goal/clear` {sessionId} | ✅ | `{cleared:true}` |
| `mcode/session/delegation/get` {sessionId} | ✅ | |
| `mcode/session/delegation/stop` | 未测 | bundle 存在 |
| **`session/cancel`** | ❌ Method not found | **0.2.4 的取消途径没了**。替代：`session/close`（见上），之后用 `session/load` 重新挂载 |
| **`session/delete`** | ❌ Method not found | |
| **`session/search` / `session/tree` / `session/root` / `session/archive`** | ❌ Method not found | bundle 有字符串但未注册（TUI 桥接专用） |
| 0.2.4 裸名 `session/queue/*`、`session/goal/*`、`session/steer` | ❌ Method not found | 全部迁到 `mcode/session/*` 命名空间 |
| `mcode/session/cancel`、`mcode/session/delete`、`mcode/session/search`、`mcode/session/history` | ❌ Method not found | |

## 3. configOptions（session/new / config_option_update 载荷）

```json
[
  { "type": "select", "id": "permissionMode", "category": "_permission",
    "currentValue": "bypassPermissions", "_meta": {"minimax-code/scope": "process"},
    "options": [ {"value":"default","name":"Ask"}, {"value":"auto","name":"Auto"},
                 {"value":"bypassPermissions","name":"Full access"} ] },
  { "type": "select", "id": "model", "category": "model",
    "currentValue": "m:minimax:MiniMax-M3:v:thinking",
    "options": [ {"value":"m:minimax:MiniMax-M2.7:v:thinking","name":"MiniMax-M2.7 · thinking"},
                 {"value":"m:minimax:MiniMax-M3:v:","name":"MiniMax-M3"}, "…（含 BYOK 自定义渠道）" ] }
]
```
→ **模型切换和权限模式切换的标准 ACP 途径**就是 `session/set_config_option`。

## 4. 通知流（实测）

- `session/update` 的 `sessionUpdate` 变体：`available_commands_update`、`session_info_update`
  （`{updatedAt}`）、`agent_thought_chunk`、`agent_message_chunk`（均带 `messageId`）、
  `usage_update`（`{used, size, cost}` —— **usage 只从这里来**）、`config_option_update`
  （set_config_option 后）、`tool_call`/`tool_call_update`（用工具时）。
- **没有观察到**：`user_message_chunk`、`plan_update/plan_removed`、以及
  `mcode/session/{queue,goal,delegation,current_session}_update` 独立通知
  （goal create/patch/clear、queue enqueue/delete 均不触发推送）。
  → webui 的 goal/queue 实时刷新只能靠**变更响应 + 按需 get/list**，不能依赖推送。
- `session/request_permission`（server→client 请求）：本轮未触发
  （probe 会话为 bypassPermissions + 无工具）。schema（bundle）：
  `{sessionId, toolCall, options}`，响应 `{outcome:{outcome:"selected",optionId}}`
  或 `{outcome:{outcome:"cancelled"}}`。**客户端必须应答**，否则 mcode 挂起。

## 5. 对 webui 适配的结论

1. 方法名：queue/goal/steer 系列迁到 `mcode/session/*`（带 0.2.x 裸名回退）。
2. 取消：`session/cancel` → `session/close` + 重新 `session/load`。
3. `set_mode` 参数改 `modeId`；`resume/fork` 补 `cwd`。
4. usage 从 `usage_update` 通知累计（response.usage 已不存在）。
5. 客户端必须应答 `session/request_permission`（默认 cancelled 兜底 + 事件上抛）。
6. 新能力实际可接：`mcode/session/queue/list`、`session/activate`、`session/close`、
   `set_config_option`（模型/权限切换、configOptions 下拉数据源）。
   Session Center 的 search/delete/tree 在 ACP 面不可用 → 前端做 list 客户端过滤，
   删除/历史树不提供（不放假按钮）。
