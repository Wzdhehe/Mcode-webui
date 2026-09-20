// electron-preload.cjs — Electron preload 脚本（CommonJS）
// 通过 contextBridge 安全暴露 electron API 给渲染进程（前端 JS）
//
// 暴露的 API：
//   window.dialog.showOpenDirectory(options)  → Promise<{ canceled, filePaths }>
//   window.dialog.showMessageBox(options)     → Promise<{ response }>
//   window.shell.openPath(filePath)          → Promise<string>

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dialog', {
  showOpenDirectory: (options) =>
    ipcRenderer.invoke('electron:dialog:showOpenDirectory', options),

  showMessageBox: (options) =>
    ipcRenderer.invoke('electron:dialog:showMessageBox', options),
})

contextBridge.exposeInMainWorld('shell', {
  openPath: (filePath) => ipcRenderer.invoke('electron:shell:openPath', filePath),
})
