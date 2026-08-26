# Progress — mcode-webui 跟 mcode TUI 的适配进度

> 跟踪 webui 跟 mcode TUI 新版本的适配进度。每轮结束后更新状态。
> 上游 mcode TUI: https://github.com/MiniMax-AI/MiniMax-Code (CHANGELOG.md)
> 下游 webui: 本仓库

**最后更新**: 2026-08-26 (Round 5 完成, 3 commit 落地待 push)

---

## 已完成 (Done)

### Round 1-4 — v1.0.1 LAN access security controls (PR #16 base)

- v1.0.1 baseline: 8 个 commit → `19bb851` (fork)
- Round 2 (`564af66`): CORS preflight exemption + cross-origin Authorization
- Round 3 (`3009c26`): auth.js setters sync + server-startup smoke test + doc audit
- Round 4 (`99dd587`): db.js better-sqlite3 path resolver for non-canonical layouts
- 测试: 387 pass / 0 fail / 1 skipped
- 文档: CHANGELOG / README / CAPABILITIES / SECURITY-NOTES / SKILL 全部同步
- PR #16: state=OPEN, reviewDecision=CHANGES_REQUESTED (待 reviewer re-review)

### Round 5 — v1.0.2 mcode 0.2.4 control surface 基础 (本次)

- ✅ acp.mjs: 加 10 个 RPC 包装 + 4 个 sessionUpdate 枚举
- ✅ state-bus.js: 加 6 个 cs 字段 + 6 个 broadcast
- ✅ mcode-acp.js: 加 4 个事件透传 + Goal 新/旧 shape 双兼容
- ✅ routes/chat.js: 加 6 个 handler (queue/update/delete/steer/mode/config-option)
- ✅ routes/sessions.js: 加 2 个 handler (fork/resume)
- ✅ router.js: 加 8 条新路由分发
- ✅ server.js: 启动 mcode 版本检查 (>= 0.2.4 fail-fast)
- ✅ client: events.js 加 9 个 handler + attachControlSurface
- ✅ client: i18n.js 加 25 条双语 key
- ✅ client: index.html 加 queue-badge + btn-steer DOM 节点
- ✅ client: main.css 加 queue-badge / btn-steer / 恢复 btn-mode 样式
- ✅ 23 个新单测 (state-bus 7 / routes 9 / acp RPC 4 / version check 3)
- ✅ 26 条双语 i18n key (fork/queue/steer/cancel/resume/mode/btn-plus/runtime)
- ✅ Lint 0 warning
- ✅ 测试 410 pass / 0 fail / 1 skipped
- ✅ 文档: CHANGELOG v1.0.2 + CAPABILITIES §14 + PROGRESS.md (本文件)
- ✅ 3 commit (3f124e7 feat / e0744df docs / c973f5e mirror) 落地
- ✅ 独立 verifier 2-axis audit (dispatched mavis subagent)
- ✅ 修审计发现: C1 handleStop 改用 McodeAcpClient / C2 mirror PROGRESS 同步 / I1 mcode-acp 调 broadcast / I2 btn-send stop 行为恢复 + btn-queue 独立入口 / I3 §14.1 标题 5→10 / I4 mcode-rpc UNSUPPORTED 清理 / M3 补 2 个新 test / M1+M2 PROGRESS 数字
- ⏳ **不 push** (等用户说"推", 推后会触发 PR #16 自动更新)

---

## 进行中 (In Progress)

### PR #16 推进 (等待 reviewer)

- hetaoBackend (COLLABORATOR) 还没 re-review Round 3+4
- modacker (NONE) Round 4 提了 test count drift 反馈
- Round 1-4 PR 评论 4 条 (v1.0.1 main / CORS / load-time blocker / db.js + TUI gap) 待用户粘贴
- Round 5 推送后会触发 PR #16 自动更新, 需要再写一条评论说明 v1.0.2 新增

---

## 待办 (Backlog)

### Round 6 — Goal 完整功能 (1-2 周)

- chat 顶部 Goal budget bar (progress bar: used/total)
- chat 顶部 Goal status badge (5 状态 enum)
- Goal 自动结算 toast (`status='complete'` 或 `'budget_limited'`)
- Goal 独立验证展示 (LLM-as-judge 推 `goal_update` 带 verifyResult)
- Ask 等待自动继续时展示倒计时 (mcode 0.2.4 changelog 说有, 客户端兜底 30s)
- 验证 mcode 0.2.4 真实 acp method `session/goal` 的 sub-actions (get/create/settle/verify) shape
- 8-12 个新单测

### Round 7 — Plugin Skills + Hooks + Ctrl+U (1-2 周)

- server: 新增 `acp.listSkills()` 包装 + 30s 缓存
- client: `/` palette 合并 webui 内置 + mcode 推过来的 plugin skills
- Ctrl+U 全局 keybinding 调 `/api/sessions/resume?strategy=most-recent`
- Hook observer: server 新增 `lib/hooks-observer.js` 订阅 mcode acp 推的 hook 通知
- Hook observer: client 顶栏 "Hooks" 计数 + 重大事件 toast + 历史 detail
- 验证 mcode 0.2.4 真实 hook notification method 名 (推测 `hook/pre_tool_use` 等)
- SECURITY-NOTES §10 加 webui 作为 hook observer 的信任模型
- 10-15 个新单测

### Round 8 — 体验改进 (1-2 周)

- 启动阶段展示 "Server loading" 状态, Runtime 就绪前禁止提交消息
- Composer 空闲时展示操作 Tips
- 图片绝对路径粘贴 → 简短占位符 (客户端 regex)
- 后台任务提醒去重 + 读取计数稳定 (依赖 mcode acp 任务生命周期事件, 真实事件名待验)
- 6-10 个新单测

### 日常维护

- 关注 mcode TUI 新版本 (0.2.5+, 0.3.x) CHANGELOG
- 跟进 PR #16 reviewer 反馈
- 跟踪 mcode acp 协议 schema 变化
- 跟进 mcode 新增的 slash 命令 (TUI 描述: fork / clone / goal / queue / steer / plan / tree 等)

---

## 风险 (Risks)

| ID | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | hetaoBackend 长期不 re-review PR #16 | 中 | 高 (Round 1-4 收尾卡住) | Round 5 推完主动 re-request review |
| R2 | modacker 提的 test count drift 未解 | 低 | 中 (影响 reviewer 信任) | Round 5 推完在 PR 评论解释 (CI env 差异) |
| R3 | mcode 0.2.5+ 改 acp protocol 破坏 v1.0.2 | 低 | 高 (要重做 acp.mjs) | 关注 upstream changelog, 跟 mcode TUI release 节奏 |
| R4 | 用户对 btn-plus popover UX 不满意 | 中 | 低 (改 UI 不是破坏) | Round 5 推送前先内部 demo, 收反馈再调整 |
| R5 | Goal 真实 acp method shape 跟计划猜的不一样 | 中 | 中 | Round 6 实施前先 probe mcode 0.2.4 (cli.js 进一步验证) |
| R6 | Hook notification 真实 method 名跟计划猜的不一样 | 中 | 中 | Round 7 实施前先 probe |
| R7 | mcode 旧版本用户 (0.2.3-) 装上 webui v1.0.2 直接无法启动 | 高 (必然) | 中 (用户体验差) | 启动 banner 错误信息已写双语 + 升级命令, 文档说明 |
