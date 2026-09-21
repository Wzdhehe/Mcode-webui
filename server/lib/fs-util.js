// server/lib/fs-util.js — 文件系统工具类（feat-workspace-lhl)
//
// 提供目录浏览、条目详情、创建目录等功能。
// 后续可用于 sidebar 文件树管理。

import { readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, resolve, extname, basename } from 'node:path'
import { homedir } from 'node:os'

// 展开 ~ 为用户主目录（前端地址栏允许输入 ~/xxx）
function expandHome(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

// 权限字符串
function modeToString(mode) {
  const octal = (mode & 0o777).toString(8).padStart(3, '0')
  return octal
}

// 图标类型
function getIconType(name, stat) {
  if (stat.isDirectory()) return 'folder'
  const ext = extname(name).toLowerCase()
  const iconMap = {
    '.js': 'file-code', '.mjs': 'file-code', '.cjs': 'file-code',
    '.ts': 'file-code', '.tsx': 'file-code', '.jsx': 'file-code',
    '.py': 'file-code', '.rs': 'file-code', '.go': 'file-code',
    '.json': 'file-json', '.yaml': 'file-yaml', '.yml': 'file-yaml',
    '.html': 'file-html', '.css': 'file-css', '.scss': 'file-css',
    '.md': 'file-md', '.txt': 'file-text', '.log': 'file-text',
    '.png': 'file-image', '.jpg': 'file-image', '.jpeg': 'file-image',
    '.gif': 'file-image', '.svg': 'file-image', '.webp': 'file-image',
    '.mp3': 'file-audio', '.wav': 'file-audio', '.ogg': 'file-audio',
    '.mp4': 'file-video', '.mkv': 'file-video', '.avi': 'file-video',
    '.pdf': 'file-pdf',
    '.zip': 'file-archive', '.tar': 'file-archive', '.gz': 'file-archive',
    '.exe': 'file-exe', '.sh': 'file-sh',
  }
  return iconMap[ext] || 'file'
}

// 读取目录条目
export function readDirectory(targetPath, opts = {}) {
  const { limit = 500, showHidden = false } = opts
  const absPath = resolve(expandHome(targetPath || '~'))

  let parent = null
  try {
    parent = resolve(absPath, '..')
  } catch {}

  let entries = []
  let skipped = 0
  try {
    const items = readdirSync(absPath, { withFileTypes: true })
    for (const item of items) {
      if (!showHidden && item.name.startsWith('.')) continue
      if (entries.length >= limit) { skipped = items.length - entries.length; break }

      try {
        const fullPath = join(absPath, item.name)
        const stat = statSync(fullPath)
        entries.push({
          name: item.name,
          path: fullPath,
          type: item.isDirectory() ? 'dir' : 'file',
          size: stat.size,
          mtime: stat.mtimeMs,
          mode: modeToString(stat.mode),
          icon: getIconType(item.name, stat),
          // isSymlink 暂不暴露
        })
      } catch {}
    }
  } catch (e) {
    return { ok: false, error: e.message, path: absPath }
  }

  // 排序：目录优先，按名称
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return {
    ok: true,
    path: absPath,
    parent,
    home: homedir(),
    entries,
    skipped,
    total: entries.length,
  }
}

// 创建目录
export function createDirectory(targetPath) {
  const absPath = resolve(expandHome(targetPath))
  try {
    mkdirSync(absPath, { recursive: true })
    return { ok: true, path: absPath }
  } catch (e) {
    return { ok: false, error: e.message, path: absPath }
  }
}
