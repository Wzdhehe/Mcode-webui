// webui/public/app/native-fs.js — v6.0 (feat-workspace-lhl)
//
// 统一目录选择器：
//   Electron 桌面环境 → 使用 preload 暴露的 IPC dialog.showOpenDirectory
//   纯浏览器环境     → 使用 browser-fs-access 的 directoryOpen (File System Access API)
//
// 主入口：打开目录选择对话框。
// 返回 Promise<{ ok: true, dir: string } | { ok: false, reason: 'cancel' | 'error', error?: string }>

import { directoryOpen } from '/libs/browser-fs-access/index.modern.js'

/**
 * 检测当前是否在 Electron 桌面环境中运行
 * 当前只用浏览器版本的 browser-fs-access
 */
function isElectron() {
  return false
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
 *
 * 策略：先用 startIn: 'documents' 打开 Documents 让用户选择，
 *       然后用 getParent() 获取 Documents 的父目录（用户主目录）。
 *       最后用 resolve() 计算用户选择的目录相对于主目录的路径，
 *       从而拼接出完整的绝对路径。
 *
 * 关键技术点：
 *   - directoryOpen 允许用户在整个文件系统中自由导航（不仅限于 Documents）
 *   - getParent() 是 Chromium 扩展 API，可获取任意目录的父目录句柄
 *   - resolve() 计算相对路径
 */
async function pickDirectoryBrowser() {
  try {
    // 打开 Documents 作为起始参考点
    // 用户可以在打开的界面中自由导航到任意位置
    const selectedHandle = await directoryOpen({
      mode: 'read',
      recursive: false,
      startIn: 'documents',
    })

    if (!selectedHandle || !selectedHandle.length) {
      return null
    }

    const dirHandle = Array.isArray(selectedHandle) ? selectedHandle[0] : selectedHandle

    // 尝试获取 Documents 目录句柄作为基准
    let documentsHandle = null
    try {
      // 先尝试通过 getParent() 获取 Documents 的父目录
      // 从 dirHandle 向上遍历直到找到名称为 "Documents" 的目录
      let current = dirHandle
      while (current) {
        // 尝试获取父目录（Chromium 扩展 API）
        let parent = null
        try {
          parent = await current.getParent()
        } catch {
          // getParent() 不存在或失败
          break
        }

        if (!parent) break

        // 检查父目录的名称
        try {
          const name = await parent.resolve(current)
          if (name && name[0] === 'Documents') {
            documentsHandle = parent
            break
          }
        } catch {
          // resolve() 失败
        }

        current = parent
      }
    } catch (e) {
      console.warn('[native-fs] getParent traversal failed:', e)
    }

    // 如果找到了 Documents 的父目录，计算相对路径并拼接
    if (documentsHandle) {
      try {
        // 计算 dirHandle 相对于 documentsHandle 的路径
        const relativePath = await documentsHandle.resolve(dirHandle)
        if (relativePath && relativePath.length > 0) {
          // relativePath 是一个数组，如 ["Documents", "subfolder"] 或 ["Desktop", "folder"]
          // Documents 的父目录就是用户主目录
          // 拼接：父目录 + relativePath
          const absolutePath = '~/' + relativePath.join('/')
          return absolutePath
        }
      } catch (e) {
        console.warn('[native-fs] resolve failed:', e)
      }
    }

    // 兜底方案：直接返回选中的目录名称（相对路径）
    // 在 Electron 环境下调用方可以据此计算绝对路径
    if (dirHandle?.name) {
      return dirHandle.name
    }

    return null
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
