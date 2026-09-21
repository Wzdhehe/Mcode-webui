// server/routes/fs.js — 文件系统 API（feat-workspace-lhl)
//
// GET  /api/fs/read?path=xxx&showHidden=0  读取目录
// POST /api/fs/mkdir                       创建目录 { path }

import { readDirectory, createDirectory } from '../lib/fs-util.js'

// 安全检查：禁止访问 public 目录以外、/proc /sys 等系统路径
function safePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null
  // 禁止绝对路径跳出 home
  if (rawPath.includes('..')) return null
  return rawPath
}

export function handleFsRead(req, res) {
  const url = new URL(req.url, `http://localhost`)
  let rawPath = url.searchParams.get('path') || ''
  const showHidden = url.searchParams.get('showHidden') === '1'

  if (!rawPath) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'missing path' }))
    return
  }

  const result = readDirectory(rawPath, { showHidden })
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(result))
}

export function handleFsMkdir(req, res) {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    let data
    try { data = JSON.parse(body) } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'invalid json' }))
      return
    }

    const path = safePath(data.path)
    if (!path) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: 'invalid path' }))
      return
    }

    const result = createDirectory(path)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  })
}
