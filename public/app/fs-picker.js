/**
 * fs-picker.js — 原生风格目录选择对话框
 * 
 * 功能：
 * - 地址栏：用户目录 / 根目录 / 新建文件夹 按钮 + 可编辑地址栏 + 确定/取消按钮
 * - 目录列表：双击打开目录、默认置顶 ".." 返回上级、子条目多选和过滤
 * - 与后端 /api/fs/read 配合，支持 Electron 模式降级到 window.dialog
 */

(function () {
  'use strict';

  // ============================================================
  // 工具函数
  // ============================================================

  /** 解析路径的父目录 */
  function parentPath(path) {
    if (!path || path === '/') return null;
    const segs = path.replace(/\\/g, '/').split('/').filter(Boolean);
    segs.pop();
    const parent = segs.length ? '/' + segs.join('/') : '/';
    return parent;
  }

  /** 从路径提取文件名 */
  function baseName(path) {
    if (!path || path === '/') return '/';
    const segs = path.replace(/\\/g, '/').split('/').filter(Boolean);
    return segs[segs.length - 1] || '/';
  }

  /** 路径末尾加斜杠（保证一致性） */
  function joinPath(parent, name) {
    const p = parent.replace(/\\/g, '/').replace(/\/+$/, '');
    if (name === '..') return parentPath(p) || '/';
    return p + '/' + name;
  }

  /** 权限位数字转 rwx 字符串 */
  function modeString(mode) {
    if (mode == null) return '---------';
    const bits = [
      (mode & 0x100) ? 'r' : '-',
      (mode & 0x80)  ? 'w' : '-',
      (mode & 0x40)  ? 'x' : '-',
      (mode & 0x20)  ? 'r' : '-',
      (mode & 0x10)  ? 'w' : '-',
      (mode & 0x8)   ? 'x' : '-',
      (mode & 0x4)   ? 'r' : '-',
      (mode & 0x2)   ? 'w' : '-',
      (mode & 0x1)   ? 'x' : '-',
    ];
    return bits.join('');
  }

  /** 格式化文件大小 */
  function formatSize(bytes) {
    if (bytes == null || bytes === '-') return '-';
    const n = Number(bytes);
    if (isNaN(n)) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  /** 格式化修改时间 */
  function formatMtime(mtime) {
    if (!mtime) return '-';
    const d = new Date(mtime);
    if (isNaN(d.getTime())) return '-';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ============================================================
  // 主类 FsPicker
  // ============================================================

  class FsPicker {
    constructor(options = {}) {
      this.options = options;
      this.currentPath = options.defaultPath || this._getHomeDir();
      this.selectedPaths = new Set();
      this.entries = [];
      this.filterText = '';
      this._home = null; // 用户目录，从后端 API 获取
      this._visible = false;
      this._resolve = null;   // Promise resolve
      this._reject = null;    // Promise reject

      this._render();
      this._bindEvents();
      this._load(this.currentPath);
    }

    // ----------------------------------------------------------
    // 公开 API
    // ----------------------------------------------------------

    /** 显示对话框并返回 Promise<string | string[] | null> */
    async open() {
      this._reset();
      this._show();
      return new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
      });
    }

    /** 销毁对话框（内部调用） */
    destroy() {
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
    }

    // ----------------------------------------------------------
    // 初始化 & 渲染
    // ----------------------------------------------------------

    _render() {
      // Overlay
      this._overlay = document.createElement('div');
      this._overlay.className = 'fs-picker-overlay';
      this._overlay.innerHTML = `
        <div class="fs-picker-dialog" role="dialog" aria-label="选择目录">
          <!-- Toolbar -->
          <div class="fs-picker-toolbar">
            <div class="fs-picker-breadcrumb">
              <button class="fs-btn-icon" title="用户目录" data-action="home">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </button>
              <button class="fs-btn-icon" title="根目录" data-action="root">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
              </button>
              <button class="fs-btn-icon" title="新建文件夹" data-action="mkdir">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
              </button>
              <div class="fs-picker-sep"></div>
              <div class="fs-picker-path-wrap">
                <input class="fs-picker-path" type="text" spellcheck="false" autocomplete="off" />
              </div>
            </div>
            <div class="fs-picker-toolbar-right">
              <button class="fs-btn" data-action="cancel">取消</button>
              <button class="fs-btn fs-btn-primary" data-action="confirm" disabled>确定</button>
            </div>
          </div>

          <!-- Filter -->
          <div class="fs-picker-filter-wrap">
            <input class="fs-picker-filter" type="text" placeholder="过滤…（支持 glob，如 *.txt）" spellcheck="false" autocomplete="off" />
            <button class="fs-btn-icon fs-picker-filter-clear" title="清除过滤" data-action="clear-filter" style="display:none">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <!-- Column headers -->
          <div class="fs-picker-headers">
            <div class="fs-col fs-col-check"></div>
            <div class="fs-col fs-col-name">名称</div>
            <div class="fs-col fs-col-size">大小</div>
            <div class="fs-col fs-col-mtime">修改时间</div>
            <div class="fs-col fs-col-mode">权限</div>
          </div>

          <!-- File list -->
          <div class="fs-picker-list" role="listbox" aria-multiselectable="true">
            <div class="fs-picker-loading" style="display:none">
              <span class="fs-spinner"></span> 加载中…
            </div>
            <div class="fs-picker-empty" style="display:none">该目录为空</div>
            <div class="fs-picker-error" style="display:none"></div>
            <!-- entries injected by _renderEntries -->
          </div>

          <!-- Status bar -->
          <div class="fs-picker-status"></div>
        </div>
      `;
      document.body.appendChild(this._overlay);

      // Cache DOM refs
      this._pathInput    = this._overlay.querySelector('.fs-picker-path');
      this._filterInput  = this._overlay.querySelector('.fs-picker-filter');
      this._filterClear  = this._overlay.querySelector('.fs-picker-filter-clear');
      this._listEl       = this._overlay.querySelector('.fs-picker-list');
      this._loadingEl    = this._overlay.querySelector('.fs-picker-loading');
      this._emptyEl      = this._overlay.querySelector('.fs-picker-empty');
      this._errorEl      = this._overlay.querySelector('.fs-picker-error');
      this._statusEl     = this._overlay.querySelector('.fs-picker-status');
      this._confirmBtn   = this._overlay.querySelector('[data-action="confirm"]');

      // 初始路径
      this._pathInput.value = this.currentPath;
    }

    _bindEvents() {
      const dlg = this._overlay.querySelector('.fs-picker-dialog');

      // Toolbar buttons
      dlg.querySelector('[data-action="home"]').addEventListener('click', () => {
        this._load(this._getHomeDir());
      });
      dlg.querySelector('[data-action="root"]').addEventListener('click', () => {
        this._load('/');
      });
      dlg.querySelector('[data-action="mkdir"]').addEventListener('click', () => {
        this._mkdir();
      });
      dlg.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        this._close(null);
      });
      dlg.querySelector('[data-action="confirm"]').addEventListener('click', () => {
        this._confirm();
      });
      dlg.querySelector('[data-action="clear-filter"]').addEventListener('click', () => {
        this._filterInput.value = '';
        this.filterText = '';
        this._filterClear.style.display = 'none';
        this._renderEntries();
      });

      // Path input: Enter 导航
      this._pathInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const val = e.target.value.trim();
          if (val) this._load(val);
        }
        if (e.key === 'Escape') {
          e.target.value = this.currentPath;
          e.target.blur();
        }
      });

      // Filter input
      this._filterInput.addEventListener('input', e => {
        this.filterText = e.target.value.trim();
        this._filterClear.style.display = this.filterText ? 'flex' : 'none';
        this._renderEntries();
      });

      // Overlay 点击关闭
      this._overlay.addEventListener('click', e => {
        if (e.target === this._overlay) this._close(null);
      });

      // Keyboard 快捷键
      document.addEventListener('keydown', this._keyHandler = e => {
        if (!this._visible) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          this._close(null);
        }
        if (e.key === 'Enter' && document.activeElement === this._pathInput) {
          const val = this._pathInput.value.trim();
          if (val) this._load(val);
        }
      });
    }

    // ----------------------------------------------------------
    // 状态管理
    // ----------------------------------------------------------

    _reset() {
      this.currentPath = this.options.defaultPath || this._getHomeDir();
      this.selectedPaths.clear();
      this.entries = [];
      this.filterText = '';
      this._pathInput.value = this.currentPath;
      this._filterInput.value = '';
      this._filterClear.style.display = 'none';
      this._confirmBtn.disabled = true;
      this._updateStatus();
    }

    _show() {
      this._overlay.classList.add('fs-picker-open');
      this._visible = true;
      this._pathInput.focus();
      this._pathInput.select();
    }

    _close(result) {
      this._visible = false;
      this._overlay.classList.remove('fs-picker-open');
      document.removeEventListener('keydown', this._keyHandler);
      if (this._resolve) {
        const res = this._resolve;
        this._resolve = null;
        this._reject = null;
        res(result);
      }
      // 动画结束后销毁 DOM
      setTimeout(() => this.destroy(), 300);
    }

    _confirm() {
      const paths = [...this.selectedPaths];
      if (!paths.length) return;
      // 如果是单选目录且选中了目录本身，直接返回路径
      const result = paths.length === 1 && paths[0].endsWith('/') ? paths[0] : paths;
      this._close(result);
    }

    _getHomeDir() {
      return this._home || '/';
    }

    // ----------------------------------------------------------
    // 目录加载 & API
    // ----------------------------------------------------------

    async _load(path) {
      // 标准化路径
      path = this._normPath(path);
      this._showLoading(true);
      this._showError('');
      this.selectedPaths.clear();
      this._confirmBtn.disabled = true;

      try {
        const data = await this._readDir(path);
        this.currentPath = path;
        this.entries = data;
        this._pathInput.value = path;
        this._updateStatus();
        this._renderEntries();
      } catch (err) {
        this._showError('加载目录失败: ' + (err.message || err));
        this.entries = [];
        this._renderEntries();
      } finally {
        this._showLoading(false);
      }
    }

    async _readDir(path) {
      const url = `/api/fs/read?path=${encodeURIComponent(path)}&t=${Date.now()}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`${resp.status} ${resp.statusText}${txt ? ': ' + txt : ''}`);
      }
      const json = await resp.json();
      if (json.error) throw new Error(json.error);
      // 首次加载时从响应中获取用户目录
      if (json.home) this._home = json.home;
      return json.data || [];
    }

    async _mkdir() {
      const name = prompt('输入文件夹名称：');
      if (!name || !name.trim()) return;
      const parent = this.currentPath;
      const url = '/api/fs/mkdir';
      let resp;
      try {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: parent, name: name.trim() }),
        });
      } catch (err) {
        alert('创建文件夹失败: ' + err.message);
        return;
      }
      const json = await resp.json().catch(() => ({}));
      if (json.error) {
        alert('创建失败: ' + json.error);
        return;
      }
      // 刷新当前目录
      this._load(parent);
    }

    // ----------------------------------------------------------
    // 列表渲染
    // ----------------------------------------------------------

    _renderEntries() {
      // 移除旧条目（保留 loading/empty/error）
      const oldItems = this._listEl.querySelectorAll('.fs-entry');
      oldItems.forEach(el => el.remove());

      const all = this.entries;
      if (!all.length) {
        this._emptyEl.style.display = 'block';
        return;
      }
      this._emptyEl.style.display = 'none';

      // glob 过滤
      let items = all;
      if (this.filterText) {
        items = this._filterGlob(all, this.filterText);
      }

      if (!items.length) {
        this._emptyEl.textContent = this.filterText ? '没有匹配的结果' : '该目录为空';
        this._emptyEl.style.display = 'block';
        return;
      }

      // 排序：目录优先，然后按名称
      const dirs = items.filter(e => e.type === 'dir');
      const files = items.filter(e => e.type !== 'dir');
      dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      const sorted = [...dirs, ...files];

      sorted.forEach(entry => {
        const row = this._makeEntryRow(entry);
        this._listEl.appendChild(row);
      });
    }

    _makeEntryRow(entry) {
      const row = document.createElement('div');
      row.className = 'fs-entry fs-type-' + (entry.type || 'file');
      row.setAttribute('role', 'option');
      row.setAttribute('data-path', entry.path);
      row.setAttribute('data-type', entry.type || 'file');
      row.setAttribute('data-name', entry.name);
      row.setAttribute('tabindex', '0');

      const isDir = entry.type === 'dir';
      const isSelected = this.selectedPaths.has(entry.path);
      if (isSelected) row.classList.add('fs-selected');

      // Checkbox
      const check = document.createElement('div');
      check.className = 'fs-col fs-col-check';
      check.innerHTML = `<input type="checkbox" class="fs-entry-check" ${isSelected ? 'checked' : ''} aria-label="选择 ${entry.name}" />`;
      row.appendChild(check);

      // Icon + Name
      const nameCol = document.createElement('div');
      nameCol.className = 'fs-col fs-col-name';
      const icon = isDir
        ? `<svg class="fs-icon" viewBox="0 0 24 24" fill="#f0c040" stroke="#c8a020" stroke-width="1"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>`
        : `<svg class="fs-icon" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
      nameCol.innerHTML = `${icon}<span class="fs-entry-name">${this._escHtml(entry.name)}</span>`;
      row.appendChild(nameCol);

      // Size
      const sizeCol = document.createElement('div');
      sizeCol.className = 'fs-col fs-col-size';
      sizeCol.textContent = isDir ? '-' : formatSize(entry.size);
      row.appendChild(sizeCol);

      // Mtime
      const mtimeCol = document.createElement('div');
      mtimeCol.className = 'fs-col fs-col-mtime';
      mtimeCol.textContent = formatMtime(entry.mtime);
      row.appendChild(mtimeCol);

      // Mode
      const modeCol = document.createElement('div');
      modeCol.className = 'fs-col fs-col-mode';
      modeCol.textContent = modeString(entry.mode);
      row.appendChild(modeCol);

      // 双击打开目录
      if (isDir) {
        row.addEventListener('dblclick', () => {
          this._load(entry.path);
        });
      }

      // Checkbox 切换选择
      const checkbox = check.querySelector('input');
      checkbox.addEventListener('click', e => {
        e.stopPropagation();
        this._toggleSelect(entry, checkbox.checked);
      });
      // 点击行选中/反选（非目录）或打开（目录）
      row.addEventListener('click', e => {
        if (e.target === checkbox) return;
        if (isDir) {
          // 目录：点一行=选中该目录
          this._toggleSelect(entry, !isSelected);
        } else {
          // 文件：点一行=选中
          this._toggleSelect(entry, !isSelected);
        }
      });

      // 空格/回车 选中
      row.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (isDir) {
            this._load(entry.path);
          } else {
            this._toggleSelect(entry, !this.selectedPaths.has(entry.path));
          }
        }
      });

      return row;
    }

    _toggleSelect(entry, on) {
      if (on) {
        this.selectedPaths.add(entry.path);
      } else {
        this.selectedPaths.delete(entry.path);
      }
      // 更新行样式和 checkbox
      const row = this._listEl.querySelector(`[data-path="${CSS.escape(entry.path)}"]`);
      if (row) {
        row.classList.toggle('fs-selected', on);
        const cb = row.querySelector('.fs-entry-check');
        if (cb) cb.checked = on;
      }
      this._confirmBtn.disabled = this.selectedPaths.size === 0;
      this._updateStatus();
    }

    // ----------------------------------------------------------
    // glob 过滤（轻量，不依赖外部库）
    // ----------------------------------------------------------

    _filterGlob(entries, pattern) {
      // 简单实现：* 匹配任意字符，? 匹配单个字符
      const re = this._globToRegex(pattern);
      return entries.filter(e => re.test(e.name));
    }

    _globToRegex(pattern) {
      let regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      return new RegExp('^' + regex + '$', 'i');
    }

    // ----------------------------------------------------------
    // 辅助 UI
    // ----------------------------------------------------------

    _showLoading(show) {
      this._loadingEl.style.display = show ? 'flex' : 'none';
      this._emptyEl.style.display = 'none';
      this._errorEl.style.display = 'none';
    }

    _showError(msg) {
      if (msg) {
        this._errorEl.textContent = msg;
        this._errorEl.style.display = 'block';
        this._emptyEl.style.display = 'none';
      } else {
        this._errorEl.style.display = 'none';
      }
    }

    _updateStatus() {
      const n = this.selectedPaths.size;
      if (n === 0) {
        this._statusEl.textContent = '';
      } else {
        this._statusEl.textContent = `已选择 ${n} 项`;
      }
    }

    _normPath(path) {
      if (!path) return '/';
      path = path.trim().replace(/\\/g, '/');
      if (!path.startsWith('/')) {
        // 相对路径：拼到当前路径
        path = this.currentPath.replace(/\/$/, '') + '/' + path;
      }
      // 解析 .. 和 .
      const segs = path.split('/').filter(Boolean);
      const resolved = [];
      for (const seg of segs) {
        if (seg === '.') continue;
        if (seg === '..') { resolved.pop(); continue; }
        resolved.push(seg);
      }
      return '/' + resolved.join('/');
    }

    _escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  // ============================================================
  // 暴露全局函数
  // ============================================================

  /** 对外入口：pickDirectory() 使用 fs-picker 兜底 */
  window.FsPicker = FsPicker;

})();
