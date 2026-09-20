// webui/public/app/native-fs.js — v3.0 (feat-workspace-lhl)
//
// 分层目录选择器，按优先级自动选择最优方案：
//
//  优先级 1: window.electron.dialog  (Electron 环境)
//    ✅ 直接调 OS 原生目录选择器（等同于 dialog.showOpenDialog）
//    ✅ 无"上传"按钮，纯目录选择 UI
//    ✅ Windows / macOS / Linux 全平台支持
//    ✅ 绝对路径直接返回，无需 resolve
//    ⚠️ 仅在 Electron 环境下可用
//
//  优先级 2: showDirectoryPicker()  (Chromium 浏览器)
//    ✅ 直接调 OS 原生目录选择器
//    ✅ 无上传按钮
//    ⚠️ 仅限 Chromium 内核（Chrome/Edge/Arc/Brave 等）
//    ⚠️ 首次调用弹出"允许此网站访问文件系统"提示（仅一次）
//
//  优先级 3: webkitdirectory input  (Firefox / Safari / 其他)
//    ⚠️ UI 是文件上传风格（有"上传"按钮），但功能正常
//    ✅ 所有现代浏览器支持
//    ⚠️ 无法直接拿到绝对路径 → 通过后端 resolve 搜索
//
// 调用方只需调用 pickDirectory()，其余内部处理。

import { API_SUFFIX } from './state.js'

const SUPPORTS_FSA = typeof window !== 'undefined' && 'showDirectoryPicker' in window
// Electron: window.dialog 由 electron-preload.cjs 注入（Electron 环境才有 dialog 属性）
const IS_ELECTRON = typeof window !== 'undefined' && typeof window.dialog !== 'undefined' && typeof window.dialog.showOpenDirectory === 'function'

// 主入口：打开系统目录选择对话框。
// 返回 Promise<{ ok: true, dir: string } | { ok: false, reason: string, error?: string, candidates?: Candidate[] }>
export async function pickDirectory() {
  // 优先级 1: window.dialog (Electron 环境)
  if (IS_ELECTRON) {
    const result = await _pickViaElectronDialog()
    if (result.ok) return result
    if (result.reason === 'cancel') return { ok: false, reason: 'cancel' }
    // Electron dialog 失败 → 尝试浏览器方案
  }

  // 优先级 2: showDirectoryPicker (Chromium)
  if (SUPPORTS_FSA) {
    const result = await _pickViaFSA()
    if (result.ok) return result
    if (result.reason === 'cancel') return { ok: false, reason: 'cancel' }
  }

  // 优先级 3: webkitdirectory (Firefox/Safari/其他)
  const webkit = await _pickViaWebkitdirectory()
  if (webkit.ok) return webkit
  if (webkit.reason === 'cancel') return { ok: false, reason: 'cancel' }
  if (webkit.reason === 'multiple') return webkit

  return { ok: false, reason: 'error', error: '所有目录选择方案均不可用' }
}

// ===========================
// 方案 1: window.dialog.showOpenDirectory (Electron)
// ===========================
async function _pickViaElectronDialog() {
  try {
    const result = await window.dialog.showOpenDirectory({
      title: '选择工作目录',
      properties: ['openDirectory'],
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, reason: 'cancel' }
    }
    return { ok: true, dir: result.filePaths[0] }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    return { ok: false, reason: 'error', error: msg }
  }
}

// ===========================
// 方案 2: File System Access API
// ===========================
async function _pickViaFSA() {
  try {
    const handle = await window.showDirectoryPicker()
    let dir = handle.path
    if (dir && typeof dir === 'string' && dir.startsWith('/')) {
      return { ok: true, dir }
    }
    // path 不可用 → 枚举目录取第一条文件路径推断目录
    try {
      for await (const entry of handle.values()) {
        const filePath = entry.path || entry.fullPath
        if (filePath && typeof filePath === 'string' && filePath.startsWith('/')) {
          const lastSlash = filePath.lastIndexOf('/')
          const parentDir = lastSlash > 0 ? filePath.slice(0, lastSlash) : '/'
          return { ok: true, dir: parentDir }
        }
        break
      }
    } catch (_e) { /* 枚举失败 */ }
    return { ok: false, reason: 'no-path', error: '无法获取目录绝对路径' }
  } catch (e) {
    const msg = e && e.name ? e.name : (e && e.message ? e.message : String(e))
    if (msg === 'AbortError') return { ok: false, reason: 'cancel' }
    return { ok: false, reason: 'error', error: msg }
  }
}

// ===========================
// 方案 3: webkitdirectory input
// ===========================
async function _pickViaWebkitdirectory() {
  return new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    let input
    try {
      input = document.createElement('input')
      input.type = 'file'
      input.setAttribute('webkitdirectory', '')
      input.addEventListener('change', async () => {
        const files = input.files
        if (!files || !files.length) return done({ ok: true, dir: '' })
        const first = files[0]
        let folderName
        if (first.webkitRelativePath) {
          const parts = first.webkitRelativePath.split('/')
          if (parts.length > 1) parts.pop()
          folderName = parts.join('/')
        } else {
          folderName = first.name
        }
        input.value = ''
        if (!folderName) return done({ ok: true, dir: '' })
        try {
          const r = await fetch('/api/workspace/resolve' + API_SUFFIX + '&name=' + encodeURIComponent(folderName))
          const data = await r.json()
          if (!data.ok || !data.candidates || data.candidates.length === 0) {
            return done({ ok: false, reason: 'not-found', error: '找不到目录: ' + folderName })
          }
          if (data.candidates.length === 1) {
            return done({ ok: true, dir: data.candidates[0].path })
          }
          return done({ ok: false, reason: 'multiple', candidates: data.candidates, name: folderName })
        } catch (err) {
          return done({ ok: false, reason: 'error', error: err && err.message ? err.message : String(err) })
        }
      })
      input.addEventListener('cancel', () => done({ ok: false, reason: 'cancel' }))
    } catch (e) {
      return done({ ok: false, reason: 'error', error: e && e.message ? e.message : String(e) })
    }
    input.click()
  })
}
