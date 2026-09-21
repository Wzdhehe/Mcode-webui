// webui/public/app/native-fs.js — v7.0 (feat-workspace-lhl)
//
// 统一目录选择器：前端模态框 fs-picker（window.FsPicker，由 fs-picker.js 提供）。
// 目录数据完全来自后端 /api/fs/read，逐级浏览，返回的是服务器验证过的绝对路径，
// 因此 POST /api/workspace 不会再因路径不存在而 400。
//
// 主入口：pickDirectory()
// 返回 Promise<{ ok: true, dir: string } | { ok: false, reason: 'cancel' | 'error', error?: string }>

/**
 * 打开目录选择模态框
 * @param {object} [options]
 * @param {string} [options.defaultPath] 初始目录（支持 ~ 开头），缺省为用户主目录
 */
export async function pickDirectory(options = {}) {
  if (typeof window.FsPicker !== 'function') {
    const msg = 'fs-picker 组件未加载（检查 index.html 是否引入 app/fs-picker.js）'
    console.error('[native-fs]', msg)
    return { ok: false, reason: 'error', error: msg }
  }

  try {
    const picker = new window.FsPicker({ defaultPath: options.defaultPath })
    const result = await picker.pick()

    if (!result || result.canceled || !result.path) {
      return { ok: false, reason: 'cancel' }
    }

    // 多选时取第一个（工作区切换只需要单个目录）
    const dir = Array.isArray(result.path) ? result.path[0] : result.path
    if (!dir || typeof dir !== 'string') {
      return { ok: false, reason: 'cancel' }
    }

    return { ok: true, dir }
  } catch (e) {
    const msg = e?.message ? e.message : String(e)
    console.error('[native-fs] pickDirectory error:', msg)
    return { ok: false, reason: 'error', error: msg }
  }
}
