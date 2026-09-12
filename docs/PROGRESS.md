# Progress — mcode-webui 跟 mcode TUI 的适配进度

> 跟踪 webui 跟 mcode TUI 新版本的适配进度。每轮结束后更新状态。
> 上游 mcode TUI: https://github.com/MiniMax-AI/MiniMax-Code (CHANGELOG.md)
> 下游 webui: 本仓库

**最后更新**: 2026-09-12 (v1.1.0 — mcode 0.3/0.4 适配完成, live smoke 11/11)

---

## 已完成 (Done)

### Round 1-4 — v1.0.1 LAN access security controls (PR #16 base)

- Round 2: CORS preflight exemption + cross-origin Authorization
- Round 3: auth.js setters sync + server-startup smoke test + doc audit
- Round 4: db.js better-sqlite3 path resolver for non-canonical layouts

### Round 5 — v1.0.2 mcode 0.2.4 control surface 基础

- acp.mjs: 10 个 RPC 包装 + 4 个 sessionUpdate 枚举; state-bus: goal/queue
  cs 字段 + broadcast; routes/chat.js 6 handler; routes/sessions.js fork/resume;
  客户端 queue-badge / btn-steer / btn-mode 接通 0.2.4 set_mode

### Round 6 — v1.0.3 mcode 0.2.4 Goal + 审计修复 (2026-08-26)

- acp.mjs: session/goal 4 RPC + queue() 方法名修正
- state-bus GOAL_STATUSES (5 状态) + 4 个 goal endpoint
- 客户端 Goal budget bar + Delegation card + Ask 30s 倒计时
- R6 audit 修复 (C2 XSS + I1 sendAskAnswer type 等)
- ⏳ R6 独立 verifier audit 一直未派 (遗留)

### R7 — v1.1.0 mcode 0.3/0.4 适配 + 布局收敛 (2026-09-12, 本次)

- **布局收敛**: 删除 `plugins/Wzdhehe/mcode-webui/` 手工镜像, repo root
  即插件源; package-plugin 从 root 打包, validate 校验 dist 产物
- **round 5–8 并入主树**: 把 modacker 在官方 PR 线的 round 5–8
  (better-sqlite3 resolver / Token Plan / CORS per-origin / 跨域
  token 泄露修复 + csrf-token-disclosure 测试) 从镜像移植到 root,
  与 R5/R6 功能语义合并
- **0.4.2 ACP probe** (`docs/acp-probe-0.4.md`, 4 轮): 扩展面迁到
  `mcode/session/*` 命名空间; `session/cancel` 移除 (close 替代);
  `set_mode` 参数 modeId; resume/fork 需要 cwd; usage 只在
  `usage_update` 通知; `set_config_option` 是模型/权限切换的标准面;
  queue/goal/delegation 无推送通知; 0.4.2 会话是**进程域**的
- **acp.mjs 兼容层**: extRequest() 新名优先 + 0.2.x 裸名回退;
  cancel() close+load 回退; modeId/configId 参数回退链;
  queueList/activate/closeSession 新包装; request_permission 自动应答
  (cancelled) + serverRequest 事件; mcode/session/*_update 通知归一化;
  usage 从 usage_update 累计
- **服务端**: +4 路由 (GET queue / GET config-options / POST
  acp-activate / POST acp-close); 所有 fresh-client 路由 load-first
  (进程域会话必须先挂载); fork/resume/stop 传 workspace cwd
- **前端**: renderQueue() 把 R5 的死 DOM 接活 (徽标/清单/引导/删除);
  refreshQueueList() 变更后拉取; model picker 优先 configOptions;
  修复 model picker 对导入绑定 state 赋值的 ESM bug
- **验证**: 478 测试 (477 pass / 0 fail / 1 skipped), lint 0 warning,
  `npm run verify` 全绿; live smoke (真实 0.4.2) 11/11
  (`acp-probe/smoke-webui-042.mjs`)

---

## 进行中 (In Progress)

### 官方仓库 PR 线 (待用户决策)

- `MiniMax-AI/MiniMax-Code-Plugins`: PR #16 (用户, round 1–4 基线) /
  #23 (modacker, round 5) / #31 (modacker, round 8) 全部 OPEN 未合并,
  三者互相 supersede
- 本仓库 main 已含 round 5–8 全部内容 (blob 级一致); 本地统一线 =
  `refactor/modularization` (v1.1.0)
- 待决策: 更新 #31 还是开新一轮 PR (从 dist 产出提交)

## 待办 (Backlog)

- 官方仓库 PR 整合 (见上)
- 跟踪 mcode 0.5+ CHANGELOG; 每轮适配先跑 `acp-probe/probe-042*.mjs`
  式的 probe (别信 bundle grep — 0.4.2 里 search/tree/root 的字符串
  都在但没注册)
- 已知性能债: queue/goal/steer 每请求新起一个 `mcode acp` 进程
  (~1.7s 冷启动); 0.4.2 会话进程域化后理论上可以改成长驻 client +
  按需 load, 待做
- fork 的 `message-boundary-not-found` 边界条件待查 (probe r4)
- Session Center 的 search/delete/tree: ACP 无此面, 前端只能做
  session/list 客户端过滤; mcode 官方若在 ACP 暴露再接

## 风险 (Risks)

| ID | 风险 | 缓解 |
|---|---|---|
| R1 | mcode 0.5+ 又改 ACP 面 | 每轮先 probe; extRequest 兼容层已有回退模式 |
| R2 | request_permission 自动 cancelled 会拒掉 LAN 用户的工具确认 | 后续接 webui 确认弹窗 (serverRequest 事件已上抛) |
| R3 | 官方 PR 线与本地统一线漂移 | main 已合并统一线; dist 打包流程文档化 |
