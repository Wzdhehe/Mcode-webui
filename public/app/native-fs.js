// webui/public/app/native-fs.js — v5.0 (feat-workspace-lhl)
//
// 统一使用 fs-picker 对话框作为目录选择器。
// 自绘原生风格：地址栏（可编辑）+ 分列列表 + 创建文件夹，通过后端 /api/fs/read 获取目录内容。

// 主入口：打开目录选择对话框。
// 返回 Promise<{ ok: true, dir: string } | { ok: false, reason: 'cancel' | 'error', error?: string }>
export async function pickDirectory() {
  try {
    if (typeof window.FsPicker !== 'function') {
      return { ok: false, reason: 'error', error: 'FsPicker 类未加载' }
    }
    const picker = new window.FsPicker({
      title: '选择工作目录',
      startPath: '',
    })
    const result = await picker.pick()
    if (result.canceled) return { ok: false, reason: 'cancel' }
    if (result.path) return { ok: true, dir: result.path }
    return { ok: false, reason: 'error', error: '未选择任何目录' }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    if (msg === 'cancel') return { ok: false, reason: 'cancel' }
    return { ok: false, reason: 'error', error: msg }
  }
}
