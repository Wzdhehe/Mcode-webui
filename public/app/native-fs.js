// webui/public/app/native-fs.js — v6.0 (feat-workspace-lhl)
//
// 统一目录选择器：
//   Electron 桌面环境 → 使用 preload 暴露的 IPC dialog.showOpenDirectory
//   纯浏览器环境     → 使用 browser-fs-access 的 directoryOpen (File System Access API)
//
// 主入口：打开目录选择对话框。
// 返回 Promise<{ ok: true, dir: string } | { ok: false, reason: 'cancel' | 'error', error?: string }>

import { directoryOpen } from '/node_modules/browser-fs-access/dist/index.modern.js'

/**
 * 检测当前是否在 Electron 桌面环境中运行
 */
function isElectron() {
  return typeof window !== 'undefined' &&
    window.location.protocol === 'http:' &&
    window.location.hostname === '127.0.0.1'
}

/**
 * Electron 环境：使用 preload 暴露的 IPC 获取目录路径
 */
async function pickDirectoryElectron() {
  if (typeof window.dialog?.showOpenDirectory !== 'function') {
    throw new Error('Electron dialog API 不可用')
  }
  const result = await window.dialog.showOpenDirectory({
    title: '选择工作目录',
  })
  if (result.canceled || !result.filePaths?.length) {
    return null
  }
  return result.filePaths[0]
}

/**
 * 浏览器环境：使用 browser-fs-access 获取目录
 * 注意：File System Access API 返回的是 FileSystemDirectoryHandle，不是路径
 */
async function pickDirectoryBrowser() {
  try {
    const handle = await directoryOpen({
      mode: 'read',
      recursive: false,
    })
    // directoryOpen 返回的是目录句柄数组，取第一个
    if (!handle || !handle.length) {
      return null
    }
    const dirHandle = Array.isArray(handle) ? handle[0] : handle
    // FileSystemDirectoryHandle 没有 path 属性，需要特殊处理
    // 在 Electron 中可以尝试从 handle 获取路径
    if (dirHandle?.path) {
      return dirHandle.path
    }
    // 无法获取路径，返回 handle 的 name 作为标识
    return dirHandle?.name || null
  } catch (e) {
    if (e?.name === 'AbortError' || e?.message === 'canceled') {
      return null
    }
    throw e
  }
}

// 主入口：打开目录选择对话框
export async function pickDirectory(options = {}) {
  try {
    const dir = isElectron()
      ? await pickDirectoryElectron()
      : await pickDirectoryBrowser()

    if (!dir) {
      return { ok: false, reason: 'cancel' }
    }

    return { ok: true, dir }
  } catch (e) {
    const msg = e?.message ? e.message : String(e)
    // 忽略用户取消
    if (msg === 'canceled' || msg === 'cancel' || e?.name === 'AbortError') {
      return { ok: false, reason: 'cancel' }
    }
    console.error('[native-fs] pickDirectory error:', msg)
    return { ok: false, reason: 'error', error: msg }
  }
}
