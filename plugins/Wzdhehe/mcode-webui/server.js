// mcode-webui HTTP/SSE server — bootstrap.
//
// All actual logic lives in server/lib/* + server/routes/* + server/router.js.
// This file only wires up:
//   - installGlobalErrorHandlers (uncaughtException / unhandledRejection)
//   - preflight checks (mcode.cmd exists, upload dir)
//   - initSettings() — load persistent settings, generate default token if needed
//   - http.createServer(handleRequest) + listen
//   - SIGINT / SIGTERM cleanup (close ACP singleton, close server)
//
// API surface is unchanged from the original monolithic server.js — see server/router.js
// for the URL → handler mapping.
//
// Run from inside the .minimax-code root:
//   cd ~/.minimax-code/webui
//   node server.js

import http from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import { installGlobalErrorHandlers, MCODE_CMD, UPLOAD_DIR, PORT, HOST, DEFAULT_MODEL, DEFAULT_WORKSPACE, SESSIONS_DB } from './server/lib/config.js'
import { LAN_IP } from './server/lib/lan.js'
import { handleRequest } from './server/router.js'
import { runStartupCleanup } from './server/cleanup.js'
import { shutdownMcodeAcpSingleton } from './server/lib/acp-client.js'
import { init as initSettings, getPersistPath, getTokenEnabled } from './server/lib/settings.js'
import { setTokenAuthEnabled as setAuthTokenEnabled } from './server/lib/auth.js'

installGlobalErrorHandlers()

// v0.5.ai: preflight — uploads 目录必须能写
// v1.0: mcode 不在已知位置时降级启动 (UI/静态资源仍可用, mcode 相关功能请求时报错) —
//   之前直接 process.exit(1), 插件装到非 .minimax-code 布局的目录时整包不可用
if (!existsSync(MCODE_CMD) && MCODE_CMD !== 'mcode') {
  console.warn(`[webui] mcode.cmd not found at ${MCODE_CMD} — chat features will fail; set MCODE_CMD or install mcode`)
}
mkdirSync(UPLOAD_DIR, { recursive: true })

// v1.0.2: 硬性 mcode 版本检查 (用户决策: 不考虑旧 mcode 兼容, 只适配 0.2.4+)
//   fail-fast: 旧 mcode 直接退出 + 清晰双语错误, 不做 graceful degrade
//   原因: 半残状态 (部分能用部分不能用) 体验更差, 简单直接更可控
function checkMcodeVersion() {
  try {
    const out = execFileSync(MCODE_CMD, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32', // Windows .cmd shim
    }).trim();
    // 解析 "0.2.4" 或 "v0.2.4" 或 "Minimax Code 0.2.4 (commit ...)"
    const m = out.match(/(\d+)\.(\d+)\.(\d+)/);
    if (!m) {
      throw new Error(`cannot parse mcode version from: ${out.slice(0, 80)}`);
    }
    const [_, major, minor, patch] = m;
    const version = `${major}.${minor}.${patch}`;
    const needMajor = 0, needMinor = 2, needPatch = 4;
    const ok =
      +major > needMajor ||
      (+major === needMajor && +minor > needMinor) ||
      (+major === needMajor && +minor === needMinor && +patch >= needPatch);
    if (!ok) {
      console.error('');
      console.error('==============================================================');
      console.error(`  webui v1.0.2 requires mcode >= 0.2.4`);
      console.error(`  webui v1.0.2 需要 mcode >= 0.2.4`);
      console.error(`  current / 当前版本: mcode ${version}`);
      console.error(`  upgrade / 升级: npm i -g @minimax-ai/code@latest`);
      console.error('==============================================================');
      console.error('');
      process.exit(1);
    }
    console.log(`[webui] mcode ${version} detected (>= 0.2.4 ✓)`);
  } catch (e) {
    if (e.message && e.message.includes('requires mcode')) {
      throw e; // 已知版本不匹配错误, 不 catch
    }
    if (e.code === 'ENOENT') {
      console.error('');
      console.error('==============================================================');
      console.error(`  mcode not found at ${MCODE_CMD}`);
      console.error(`  找不到 mcode: ${MCODE_CMD}`);
      console.error(`  install / 安装: npm i -g @minimax-ai/code@latest`);
      console.error('==============================================================');
      console.error('');
      process.exit(1);
    }
    // 其它错误 (timeout / parse fail) — 警告但不阻塞, 让 server 起来,
    // 真正发 prompt 时再报错
    console.warn(`[webui] mcode version check inconclusive: ${e.message}`);
  }
}
checkMcodeVersion()

runStartupCleanup()

// v1.0.1: 初始化 settings (load from disk, generate default token if needed,
//   sync auth module). The printToken callback fires ONLY on first-ever
//   startup (when the token didn't exist on disk). After that, the token
//   value lives only in the settings file; if the operator rotates via
//   the settings card, the new value is broadcast over SSE and shown in
//   the settings card until acknowledged.
let _printedFirstToken = false
initSettings({
  printToken: (token) => {
    if (_printedFirstToken) return
    _printedFirstToken = true
    // Print to stdout, NOT to .server.log — operators running interactively
    // can copy/paste; headless / service-mode users can `cat` the settings
    // file at the path printed below.
    const url = `http://${LAN_IP}:${PORT}/?token=${token}`
    console.log('')
    console.log('==============================================================')
    console.log('  webui 首次启动 — 已生成新的鉴权 token')
    console.log('==============================================================')
    console.log(`  token:   ${token}`)
    console.log(`  远程 URL: ${url}`)
    console.log('')
    console.log(`  提示: token 已持久化到 ${getPersistPath()}`)
    console.log('         远程设备必须通过该 URL (含 ?token=) 访问')
    console.log('         本机访问 (127.0.0.1) 无需 token')
    console.log('==============================================================')
    console.log('')
  },
})
// Sync tokenAuth master switch from settings → auth module
setAuthTokenEnabled(getTokenEnabled())

const server = http.createServer(handleRequest)
server.listen(PORT, HOST, () => {
  console.log(`[webui] listening on http://${HOST}:${PORT}`)
  console.log(`[webui] LAN url: http://${LAN_IP}:${PORT}`)
  console.log(`[webui] mcode cmd: ${MCODE_CMD}`)
  console.log(`[webui] default model: ${DEFAULT_MODEL}`)
  console.log(`[webui] default workspace: ${DEFAULT_WORKSPACE}`)
  console.log(`[webui] uploads: ${UPLOAD_DIR}`)
  console.log(`[webui] sessions: ${SESSIONS_DB}`)
  console.log(`[webui] settings: ${getPersistPath()}`)
})

process.on('SIGINT', () => {
  console.log('[webui] SIGINT, shutting down...')
  shutdownMcodeAcpSingleton()
  server.close(() => process.exit(0))
})
process.on('SIGTERM', () => {
  console.log('[webui] SIGTERM, shutting down...')
  shutdownMcodeAcpSingleton()
  server.close(() => process.exit(0))
})
