// electron-main.cjs — Electron 主进程（CommonJS）
// 职责：
//   1. 启动 Node.js server.js 子进程（真正的 webui 后端，端口 8081）
//   2. 创建 BrowserWindow，加载 Electron HTTP 服务（端口 8080）
//   3. Electron HTTP 服务代理 /api/* → Node.js 后端（8081）
//   4. 通过 IPC 处理 dialog.showOpenDirectory 调用
//
// 用户：npm run electron

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const http = require('node:http')
const path = require('node:path')
const { URL } = require('node:url')
const { spawn } = require('node:child_process')

// ---- 配置 ----
const HTTP_PORT = 8080        // Electron HTTP 服务端口（BrowserWindow 加载这个）
const BACKEND_PORT = 8081      // Node.js 后端端口（server.js 子进程）
const BACKEND_SCRIPT = path.join(__dirname, 'server.js')
const DIST_DIR = path.join(__dirname, 'public')

// ---- MIME 类型 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
}

// ---- 启动 Node.js 后端子进程 ----
let backendProcess = null

function startBackend() {
  console.log('[electron] 启动 Node.js 后端...')
  // 明确使用系统 node（不被 npm_config_electron_path 污染）
  const nodePath = process.env.NODE_PATH || '/usr/bin/node'
  backendProcess = spawn(nodePath, [BACKEND_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(BACKEND_PORT) },
    detached: true,
  })
  backendProcess.stdout.on('data', (d) => process.stdout.write('[backend] ' + d))
  backendProcess.stderr.on('data', (d) => process.stderr.write('[backend] ' + d))
  backendProcess.on('error', (e) => console.error('[electron] 后端启动失败:', e.message))
  backendProcess.on('exit', (code) => {
    console.log(`[electron] 后端退出，code=${code}`)
    app.quit()
  })
}

// ---- Electron HTTP 服务：静态文件 + API 代理 ----
function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${HTTP_PORT}`)
    const pathname = url.pathname

    // ---- API 请求代理到 Node.js 后端 ----
    if (pathname.startsWith('/api/')) {
      // 读取 body（用于 POST）
      const bodyChunks = []
      for await (const chunk of req) { bodyChunks.push(chunk) }
      const body = Buffer.concat(bodyChunks)

      // 复制 headers，删除 hop-by-hop headers（用 delete 不要用 undefined）
      const proxyHeaders = { ...req.headers }
      delete proxyHeaders['connection']
      delete proxyHeaders['transfer-encoding']
      delete proxyHeaders['content-length']
      if (body.length > 0) proxyHeaders['content-length'] = body.length

      const options = {
        hostname: 'localhost',
        port: BACKEND_PORT,
        path: pathname + (url.search || ''),
        method: req.method,
        headers: proxyHeaders,
      }

      return new Promise((resolve) => {
        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers)
          proxyRes.pipe(res)
          resolve()
        })
        proxyReq.on('error', (e) => {
          console.error('[electron] 代理失败:', e.message)
          res.writeHead(502)
          res.end('Backend unavailable')
          resolve()
        })
        if (body.length > 0) proxyReq.write(body)
        proxyReq.end()
      })
    }

    // ---- 静态文件服务 ----
    try {
      const fs = require('node:fs')
      let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname)

      // 安全：禁止访问 public 目录以外的文件
      if (!filePath.startsWith(DIST_DIR + path.sep)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html')  // SPA fallback
      }

      const ext = path.extname(filePath)
      const content = fs.readFileSync(filePath)
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      })
      res.end(content)
    } catch (err) {
      console.error('[electron-server]', err)
      res.writeHead(500)
      res.end('Internal Server Error')
    }
  })
}

// ---- IPC 处理器 ----

// dialog.showOpenDirectory — 打开 OS 原生目录选择器
ipcMain.handle('electron:dialog:showOpenDirectory', async (event, options = {}) => {
  if (!BrowserWindow.getAllWindows().length) return { canceled: true, filePaths: [] }
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: options.title || '选择工作目录',
    defaultPath: options.defaultPath || undefined,
  })
  return result
})

// dialog.showMessageBox
ipcMain.handle('electron:dialog:showMessageBox', async (event, options = {}) => {
  if (!BrowserWindow.getAllWindows().length) return { response: -1 }
  const win = BrowserWindow.getAllWindows()[0]
  const result = await dialog.showMessageBox(win, options)
  return result
})

// shell.openPath
ipcMain.handle('electron:shell:openPath', async (event, filePath) => {
  return shell.openPath(filePath)
})

// ---- App 生命周期 ----
app.whenReady().then(() => {
  startBackend()

  // 等待后端启动（轮询端口）
  const waitForBackend = () => {
    const sock = require('node:net').connect(BACKEND_PORT, 'localhost', () => {
      sock.destroy()
      const server = createServer()
      server.listen(HTTP_PORT, '127.0.0.1', () => {
        console.log(`[electron] HTTP server listening on http://127.0.0.1:${HTTP_PORT}`)
        console.log(`[electron] 后端 API 代理到 http://127.0.0.1:${BACKEND_PORT}`)
        createWindow()
      })
    })
    sock.on('error', () => {
      setTimeout(waitForBackend, 200)
    })
  }
  waitForBackend()
})

// macOS：点击 dock 图标时如果没有窗口就新建
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill()
})

process.on('SIGINT', () => app.quit())
process.on('SIGTERM', () => app.quit())

// ---- 创建窗口 ----
let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Mcode WebUI',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'electron-preload.cjs'),
    },
  })

  // 调试：验证 preload 注入（开发时取消注释）
  // mainWindow.webContents.on('did-finish-load', () => {
  //   mainWindow.webContents.executeJavaScript(`
  //     console.log('window.dialog:', typeof window.dialog !== 'undefined' ? Object.keys(window.dialog) : 'NOT FOUND')
  //   `).catch(e => console.error('[electron] executeJS failed:', e.message))
  // })

  mainWindow.loadURL(`http://127.0.0.1:${HTTP_PORT}/`)

  if (process.env.ELECTRON_DEV) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => { mainWindow = null })
}
