// webui/public/app/native-fs.js — v1.3 (feat-workspace-lhl)
// 系统目录选择封装 — 零权限弹窗方案。
//
// v1.2 曾用 File System Access API (showDirectoryPicker)：Chrome 首次调用会弹
// 站点级授权框「允许此网站查看和复制文件?」——用户反馈不要这个提示，且该弹窗
// 是浏览器行为，网页无法关闭。v1.3 改用隐藏 <input type="file" webkitdirectory>
// （ChatGPT/GitHub 等目录上传的同款机制）：属普通文件上传手势，完全不经过
// FS 授权体系 → 零弹窗；同时 Firefox/Safari 可用，也不再要求 secure context
// （LAN HTTP 访问同样能弹系统目录对话框）。
//
// 本模块只需要「文件夹名」：绝对路径由后端 /api/workspace/resolve 按文件夹名
// 搜索候选（server 与浏览器同机）。webkitdirectory 会让浏览器枚举目录内文件
// 列表（不读内容），大目录（node_modules 等）选完稍有延迟属正常。

// 打开系统目录选择对话框。
// 返回 { ok: true, name } 或 { ok: false, reason: 'cancel'|'error', error? }
// 用户按 Esc / 点取消 → reason 'cancel' (调用方静默处理即可)。
// 空目录选不出任何文件 → 返回 ok:true + name:''（调用方走无候选降级）。
// 注意: 必须在用户手势的同一同步调用栈里 input.click()，否则浏览器会忽略。
export function pickDirectory() {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r) } };
    let input;
    try {
      input = document.createElement('input');
      input.type = 'file';
      input.setAttribute('webkitdirectory', '');
      input.addEventListener('change', () => {
        const files = input.files;
        if (!files || !files.length) return done({ ok: true, name: '' });
        const rel = files[0].webkitRelativePath || '';
        // webkitRelativePath 形如 "dirname/sub/file.js" → 首段就是所选目录名
        const name = rel ? rel.split('/')[0] : (files[0].name || '');
        done({ ok: true, name });
      });
      // cancel 事件: Chrome 113+ / Firefox 91+；老浏览器不触发也无妨（promise 挂起，无 UI 阻塞）
      input.addEventListener('cancel', () => done({ ok: false, reason: 'cancel' }));
    } catch (e) {
      return done({ ok: false, reason: 'error', error: e && e.message ? e.message : String(e) });
    }
    input.click();
  });
}
