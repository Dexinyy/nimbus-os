/* ========== App registry ========== */
const APPS = {
  files: { name: 'Files', icon: 'files', mount: mountFiles, size: [940, 580], minSize: [480, 300], desc: 'Browse, organize and import your files.', keywords: 'explorer folders documents file manager browse' },
  notes: { name: 'Notes', icon: 'notes', mount: mountNotes, size: [760, 540], minSize: [360, 240], desc: 'Write and edit text files.', keywords: 'notepad text editor write document' },
  calculator: { name: 'Calculator', icon: 'calculator', mount: mountCalc, size: [340, 540], minSize: [300, 470], desc: 'Everyday math with a history of results.', keywords: 'calc math numbers add' },
  settings: { name: 'Settings', icon: 'settings', mount: mountSettings, size: [1000, 660], minSize: [420, 360], single: true, desc: 'Personalize and control your OS.', keywords: 'preferences control panel options personalize' },
  terminal: { name: 'Terminal', icon: 'terminal', mount: mountTerminal, size: [760, 460], minSize: [360, 220], desc: 'Run commands on your files.', keywords: 'command line shell console prompt cmd' },
  paint: { name: 'Paint', icon: 'paint', mount: mountPaint, size: [1040, 700], minSize: [560, 380], desc: 'Sketch, draw shapes and fill colors.', keywords: 'draw sketch art brush canvas' },
  photos: { name: 'Photos', icon: 'photos', mount: mountPhotos, size: [900, 600], minSize: [380, 300], single: true, desc: 'View your pictures and set wallpapers.', keywords: 'pictures images gallery viewer' },
  clock: { name: 'Clock', icon: 'clock', mount: mountClock, size: [660, 580], minSize: [380, 440], single: true, desc: 'Focus sessions, timers, a stopwatch and world clocks.', keywords: 'focus timer stopwatch alarm world clock pomodoro' },
  mines: { name: 'Mines', icon: 'mines', mount: mountMines, size: [330, 470], single: true, noResize: true, desc: 'Clear the field without hitting a mine.', keywords: 'game minesweeper puzzle play' },
  taskmgr: { name: 'Task Manager', icon: 'taskmgr', mount: mountTaskmgr, size: [820, 560], minSize: [480, 360], single: true, desc: 'See open apps and live performance.', keywords: 'processes performance memory fps end task' },
  assistant: { name: 'Assistant', icon: 'assistant', mount: mountAssistant, size: [460, 640], minSize: [340, 400], single: true, requires: 'sample', desc: 'Ask questions or have it operate the OS for you.', keywords: 'ai help chat ask claude copilot' },
  welcome: { name: 'Welcome', icon: 'welcome', mount: mountWelcome, size: [880, 660], minSize: [420, 400], single: true, desc: 'Set up your OS and learn what it can do.', keywords: 'tips getting started setup tour' },
};
function appAvailable(id) { const a = APPS[id]; return !!a && (!a.requires || !!caps[a.requires]); }

/* ========== Shell-wide helpers and appearance ========== */
const Shell = {
  tbReserve() { return 48 + (S.data.tbFloat ? 16 : 0); },
  closeFlyouts() { Flyouts.close(); },
  reloadAll() {
    applyAll();
    Desktop.render(); Taskbar.render(); Taskbar.tray();
    bus.emit('fs', { ids: [], all: true });
    bus.emit('settings', Object.keys(S.data));
  },
};
function effectiveTheme() {
  const t = S.data.theme;
  if (t === 'light' || t === 'dark') return t;
  const v = document.documentElement.getAttribute('data-theme');
  if (v === 'dark' || v === 'light') return v;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme() { document.documentElement.setAttribute('data-os-theme', effectiveTheme()); applyAccent(); }
function applyAccent() {
  let a = S.data.accent; if (!/^#[0-9a-f]{6}$/i.test(a)) a = DEFAULTS.accent;
  const dark = document.documentElement.getAttribute('data-os-theme') === 'dark';
  const st = document.documentElement.style; const [r, g, b] = hexToRgb(a);
  st.setProperty('--accent', a);
  st.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  st.setProperty('--accent-hi', mixHex(a, '#ffffff', 0.38));
  st.setProperty('--accent-lo', mixHex(a, '#000000', 0.28));
  st.setProperty('--on-accent', luminance(a) > 0.36 ? '#15161b' : '#ffffff');
  const L = luminance(a);
  st.setProperty('--accent-text', dark ? mixHex(a, '#ffffff', L < 0.15 ? 0.45 : 0.25) : mixHex(a, '#000000', L > 0.3 ? 0.4 : 0.12));
}
function applyEffects() {
  const root = document.documentElement;
  // Frosted glass needs graphics acceleration; when the processor draws the screen, see-through panels would just look busy.
  const noBlur = IS_NATIVE && !!(Native.info && Native.info.software);
  if (!S.data.transparency || S.data.energySaver || noBlur) root.setAttribute('data-solid', ''); else root.removeAttribute('data-solid');
  if (S.data.reduceMotion || S.data.energySaver) root.setAttribute('data-reduce-motion', ''); else root.removeAttribute('data-reduce-motion');
}
function applyTextSize() { document.documentElement.style.fontSize = clamp(S.data.textSize || 14, 12, 18) + 'px'; }
function applyBrightness() { document.getElementById('dim').style.opacity = String(((100 - clamp(S.data.brightness, 30, 100)) / 100) * 0.8); }
function applyNight() {
  const a = S.data.nightLight ? 0.1 + (clamp(S.data.nightStrength, 0, 100) / 100) * 0.45 : 0;
  document.getElementById('nightlight').style.background = `rgba(255, 138, 40, ${a.toFixed(3)})`;
}
function applyTaskbar() {
  const os = document.getElementById('os');
  os.dataset.tbPos = S.data.tbPos === 'top' ? 'top' : 'bottom';
  os.dataset.tbAlign = S.data.tbAlign === 'left' ? 'left' : 'center';
  if (S.data.tbFloat) os.setAttribute('data-tb-float', ''); else os.removeAttribute('data-tb-float');
  os.style.setProperty('--tb-reserve', Shell.tbReserve() + 'px');
  $('#tb-search').hidden = !S.data.tbSearch;
  $('#tb-tv').hidden = !S.data.tbTaskView;
  Flyouts.close();
  WM.relayout();
  Desktop.render();
}
function applyOsName() { document.title = osTitle(); }
function applyAll() { applyTheme(); applyEffects(); applyTextSize(); applyBrightness(); applyNight(); applyTaskbar(); applyWallpaper(); applyOsName(); }
Object.assign(APPLY, {
  theme: applyTheme, accent: applyAccent, wallpaper: applyWallpaper,
  transparency: applyEffects, energySaver: applyEffects, reduceMotion: applyEffects,
  textSize: () => { applyTextSize(); Desktop.render(); }, brightness: applyBrightness, nightLight: applyNight, nightStrength: applyNight,
  tbAlign: applyTaskbar, tbPos: applyTaskbar, tbFloat: applyTaskbar, tbSearch: applyTaskbar, tbTaskView: applyTaskbar,
  pinned: () => Taskbar.render(), clockSeconds: () => Taskbar.clock(), clock24: () => Taskbar.clock(),
  dnd: () => Taskbar.clock(), sounds: () => Taskbar.tray(), volume: () => Taskbar.tray(),
  osName: applyOsName, showDesktopIcons: () => Desktop.render(),
});
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.data.theme === 'auto') applyTheme(); });
new MutationObserver(() => { if (S.data.theme === 'auto') applyTheme(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
function nextWallpaper() {
  const i = WALLS.findIndex((w) => w.id === S.data.wallpaper);
  S.set('wallpaper', WALLS[(i + 1) % WALLS.length].id);
}
function fmtTime(withSeconds, noPeriod) {
  const o = { hour: 'numeric', minute: '2-digit' };
  if (withSeconds) o.second = '2-digit';
  if (S.data.clock24 === true || S.data.clock24 === false) o.hour12 = !S.data.clock24;
  const f = new Intl.DateTimeFormat(undefined, o);
  if (!noPeriod) return f.format(new Date());
  return f.formatToParts(new Date()).filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
}
async function emptyTrashConfirm(within) {
  const n = FS.children('trash').length;
  if (!n) { Notif.push({ app: 'files', title: 'The Recycle Bin is already empty', silent: true }); return; }
  const ok = await Dialog.confirm('Empty Recycle Bin?', `${n} item${n === 1 ? '' : 's'} will be deleted permanently. You can't undo this.`, { ok: 'Empty Recycle Bin', danger: true, within });
  if (ok) { FS.emptyTrash(); Sound.play('trash'); }
}
async function deleteNodes(ids, within) {
  ids = ids.filter((id) => FS.get(id) && !FS.isSpecial(id));
  if (!ids.length) return;
  const inTrash = ids.filter((id) => FS.inTrash(id));
  if (inTrash.length) {
    const ok = await Dialog.confirm('Delete permanently?', inTrash.length === 1 ? `${FS.get(inTrash[0]).name} will be deleted permanently.` : `${inTrash.length} items will be deleted permanently.`, { ok: 'Delete', danger: true, within });
    if (!ok) return;
    FS.destroy(inTrash);
  }
  for (const id of ids) if (!FS.inTrash(id)) FS.trash(id);
  Sound.play('trash');
}
function fileMenuItems(id, opts = {}) {
  const n = FS.get(id); if (!n) return [];
  const within = opts.within;
  if (FS.inTrash(id) && n.parent === 'trash') return [
    { label: 'Restore', icon: 'restart', action: () => FS.restore(id) },
    { label: 'Delete permanently', icon: 'trash', danger: true, action: () => deleteNodes([id], within) },
    'sep',
    { label: 'Properties', icon: 'info', action: () => Dialog.properties(id, within) },
  ];
  const sel = opts.selection && opts.selection.length > 1 ? opts.selection : [id];
  const items = [{ label: 'Open', icon: n.type === 'folder' ? 'folderOpen' : 'external', action: () => (opts.onOpen ? opts.onOpen(id) : openNode(id)) }];
  if (n.type === 'file') {
    items.push({ label: 'Open with', icon: 'apps', submenu: n.kind === 'image'
      ? [{ label: 'Photos', icon: 'photos', appIcon: true, action: () => WM.open('photos', { file: id }) }, { label: 'Paint', icon: 'paint', appIcon: true, action: () => WM.open('paint', { file: id }) }]
      : [{ label: 'Notes', icon: 'notes', appIcon: true, action: () => WM.open('notes', { file: id }) }, { label: 'Terminal', icon: 'terminal', appIcon: true, action: () => WM.open('terminal', { cwd: n.parent, run: 'cat "' + n.name + '"' }) }] });
    if (n.kind === 'image') items.push({ label: 'Set as wallpaper', icon: 'image', action: () => S.set('wallpaper', 'file:' + id) });
  } else items.push({ label: 'Open in Terminal', icon: 'terminal', action: () => WM.open('terminal', { cwd: id }) });
  items.push('sep',
    { label: 'Cut', icon: 'cut', kb: 'Ctrl+X', action: () => Clip.set(sel, 'cut') },
    { label: 'Copy', icon: 'copy', kb: 'Ctrl+C', action: () => Clip.set(sel, 'copy') });
  if (n.type === 'folder') items.push({ label: 'Paste into folder', icon: 'paste', disabled: !Clip.has(), action: () => Clip.paste(id) });
  items.push({ label: 'Rename', icon: 'pencil', kb: 'F2', disabled: sel.length > 1, action: () => opts.onRename?.(id) },
    { label: 'Delete', icon: 'trash', kb: 'Del', action: () => deleteNodes(sel, within) });
  if (n.type === 'file' && caps.downloads) items.push('sep', { label: 'Download to this computer', icon: 'download', action: () => downloadNode(id) });
  items.push('sep', { label: 'Properties', icon: 'info', action: () => Dialog.properties(id, within) });
  return items;
}
function appMenuItems(id, where) {
  const a = APPS[id]; const pinnedTb = S.data.pinned.includes(id); const pinnedStart = S.data.startPins.includes(id);
  const running = WM.list().filter((w) => w.appId === id);
  const items = [{ header: a.name }, { label: running.length && a.single ? 'Switch to window' : running.length ? 'New window' : 'Open', icon: 'external', action: () => { Flyouts.close(); WM.open(id); } }, 'sep',
    { label: pinnedTb ? 'Unpin from taskbar' : 'Pin to taskbar', icon: pinnedTb ? 'unpin' : 'pin', action: () => S.set('pinned', pinnedTb ? S.data.pinned.filter((x) => x !== id) : [...S.data.pinned, id]) },
    { label: pinnedStart ? 'Unpin from Start' : 'Pin to Start', icon: pinnedStart ? 'unpin' : 'pin', action: () => { S.set('startPins', pinnedStart ? S.data.startPins.filter((x) => x !== id) : [...S.data.startPins, id]); Start.render(); } }];
  if (where === 'start' && pinnedStart) items.push({ label: 'Move to front', icon: 'arrowUp', action: () => { S.set('startPins', [id, ...S.data.startPins.filter((x) => x !== id)]); Start.render(); } });
  if (running.length) items.push('sep', { label: running.length > 1 ? `Close all ${running.length} windows` : 'Close window', icon: 'x', action: () => running.forEach((w) => WM.close(w)) });
  return items;
}

/* ========== Desktop ========== */
const Desktop = {
  sel: new Set(), CW: 88, CH: 102, PAD: 10,
  el: () => document.getElementById('icons'),
  items() {
    const list = [
      { key: 'sys:pc', name: 'This PC', iconHTML: appIcon('pc'), open: () => WM.open('files', { folder: 'root' }), folderId: null },
      { key: 'sys:trash', name: 'Recycle Bin', iconHTML: appIcon(FS.children('trash').length ? 'trashFull' : 'trash'), open: () => WM.open('files', { folder: 'trash' }), folderId: 'trash' },
    ];
    for (const n of FS.children('desktop')) list.push({ key: 'f:' + n.id, node: n, name: n.name, iconHTML: nodeIconHTML(n, true), open: () => openNode(n.id), folderId: n.type === 'folder' ? n.id : null });
    return list;
  },
  grid() { const el = this.el(); return { rows: Math.max(1, Math.floor((el.clientHeight - this.PAD) / this.CH)), cols: Math.max(1, Math.floor((el.clientWidth - this.PAD) / this.CW)) }; },
  layout(items) {
    const { rows, cols } = this.grid(); const pos = S.data.iconPos || {}; const taken = new Set(); const out = new Map();
    for (const it of items) { const p = pos[it.key]; if (p && p.c < cols && p.r < rows && !taken.has(p.c + ',' + p.r)) { taken.add(p.c + ',' + p.r); out.set(it.key, { c: p.c, r: p.r }); } }
    let c = 0, r = 0;
    for (const it of items) {
      if (out.has(it.key)) continue;
      let guard = 0;
      while (taken.has(c + ',' + r) && guard++ < 5000) { r++; if (r >= rows) { r = 0; c++; } }
      taken.add(c + ',' + r); out.set(it.key, { c, r });
    }
    return out;
  },
  render() {
    const el = this.el(); el.innerHTML = '';
    if (!S.data.showDesktopIcons) return;
    const items = this.items(); this.lastItems = items;
    const lay = this.layout(items); this.lastLayout = lay;
    for (const k of [...this.sel]) if (!items.some((it) => it.key === k)) this.sel.delete(k);
    for (const it of items) {
      const p = lay.get(it.key);
      const b = h('button', { class: 'dicon' + (this.sel.has(it.key) ? ' sel' : ''), 'data-key': it.key, 'aria-label': it.name, style: { left: this.PAD + p.c * this.CW + 'px', top: this.PAD + p.r * this.CH + 'px' } });
      b.innerHTML = `<span class="ic">${it.iconHTML}</span><span class="lb">${esc(it.name)}</span>`;
      el.append(b);
    }
  },
  item(key) { return (this.lastItems || []).find((x) => x.key === key); },
  syncSel() { $$('.dicon', this.el()).forEach((b) => b.classList.toggle('sel', this.sel.has(b.dataset.key))); },
  selectedIds() { return [...this.sel].filter((k) => k.startsWith('f:')).map((k) => k.slice(2)); },
  rename(id) {
    const b = this.el().querySelector(`[data-key="f:${id}"]`); const n = FS.get(id); if (!b || !n) return;
    const lb = b.querySelector('.lb');
    const inp = h('input', { class: 'rename-input', value: n.name, 'aria-label': 'New name' });
    lb.replaceWith(inp); inp.focus();
    const dot = n.type === 'file' ? n.name.lastIndexOf('.') : -1; inp.setSelectionRange(0, dot > 0 ? dot : n.name.length);
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok && inp.value.trim() && inp.value.trim() !== n.name) FS.rename(id, inp.value); else this.render(); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    ['pointerdown', 'dblclick', 'click'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
  },
  newItem(type) {
    const n = type === 'folder' ? FS.create('desktop', 'New folder', 'folder') : FS.create('desktop', 'New text document.txt', 'file', '', 'text');
    this.sel = new Set(['f:' + n.id]); this.render(); this.rename(n.id);
  },
  menuFor(key, e) {
    const it = this.item(key); if (!it) return;
    let items;
    if (key === 'sys:pc') items = [{ label: 'Open', icon: 'folderOpen', action: it.open }, 'sep', { label: 'Properties', icon: 'info', action: () => WM.open('settings', { page: 'about' }) }];
    else if (key === 'sys:trash') items = [{ label: 'Open', icon: 'folderOpen', action: it.open }, { label: 'Empty Recycle Bin', icon: 'trash', disabled: !FS.children('trash').length, action: () => emptyTrashConfirm() }];
    else items = fileMenuItems(it.node.id, { selection: this.selectedIds(), onRename: (id) => this.rename(id) });
    Menu.show(items, e.clientX, e.clientY);
  },
  bgMenu(e) {
    Menu.show([
      { label: 'View', icon: 'grid', submenu: [
        { label: 'Show desktop icons', checked: !!S.data.showDesktopIcons, action: () => S.set('showDesktopIcons', !S.data.showDesktopIcons) },
        { label: 'Arrange icons automatically', action: () => S.set('iconPos', {}) || this.render() },
      ] },
      { label: 'Sort by name', icon: 'sort', action: () => { S.set('iconPos', {}); this.render(); } },
      { label: 'Refresh', icon: 'refresh', action: () => this.render() },
      'sep',
      { label: 'New', icon: 'plus', submenu: [{ label: 'Folder', icon: 'folder', action: () => this.newItem('folder') }, { label: 'Text document', icon: 'doc', action: () => this.newItem('text') }] },
      { label: 'Paste', icon: 'paste', kb: 'Ctrl+V', disabled: !Clip.has(), action: () => { const ids = Clip.paste('desktop'); this.sel = new Set(ids.map((i) => 'f:' + i)); this.render(); } },
      { label: 'Import from this computer', icon: 'upload', action: async () => { const files = await pickFiles('image/*,.txt,.md,.csv,.json,.html,.css,.js'); if (files.length) importFiles(files, 'desktop'); } },
      'sep',
      { label: 'Next wallpaper', icon: 'image', action: nextWallpaper },
      { label: 'Personalize', icon: 'palette', action: () => WM.open('settings', { page: 'personalization' }) },
      { label: 'Display settings', icon: 'desktop', action: () => WM.open('settings', { page: 'system' }) },
      { label: 'Open in Terminal', icon: 'terminal', action: () => WM.open('terminal', { cwd: 'desktop' }) },
    ], e.clientX, e.clientY);
  },
  init() {
    const root = document.getElementById('desktop'); const icons = this.el();
    let drag = null, marquee = null;
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const b = e.target.closest('.dicon');
      if (b) { if (!this.sel.has(b.dataset.key)) { this.sel = new Set([b.dataset.key]); this.syncSel(); } this.menuFor(b.dataset.key, e); }
      else { this.sel.clear(); this.syncSel(); this.bgMenu(e); }
    });
    root.addEventListener('dblclick', (e) => { const b = e.target.closest('.dicon'); if (b) this.item(b.dataset.key)?.open(); });
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const b = e.target.closest('.dicon');
      Flyouts.close();
      if (b) {
        const key = b.dataset.key;
        if (e.ctrlKey || e.metaKey) { this.sel.has(key) ? this.sel.delete(key) : this.sel.add(key); }
        else if (!this.sel.has(key)) this.sel = new Set([key]);
        this.syncSel();
        const els = $$('.dicon', icons).filter((x) => this.sel.has(x.dataset.key));
        drag = { sx: e.clientX, sy: e.clientY, key, els, started: false, target: null, pointerType: e.pointerType, id: e.pointerId };
        b.setPointerCapture?.(e.pointerId);
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) { this.sel.clear(); this.syncSel(); }
      document.activeElement?.blur?.();
      const r = icons.getBoundingClientRect();
      marquee = { x0: e.clientX - r.left, y0: e.clientY - r.top, base: new Set(this.sel), r };
      root.setPointerCapture?.(e.pointerId);
    });
    root.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.started) { if (Math.abs(dx) + Math.abs(dy) < 6) return; drag.started = true; drag.els.forEach((x) => x.classList.add('dragging')); }
        drag.els.forEach((x) => { x.style.transform = `translate(${dx}px, ${dy}px)`; });
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const tgt = under?.closest('.dicon');
        const tItem = tgt && !this.sel.has(tgt.dataset.key) ? this.item(tgt.dataset.key) : null;
        const win = !tgt && under?.closest('.app-files[data-folder]');
        $$('.dicon.drop', icons).forEach((x) => x.classList.remove('drop'));
        drag.target = null;
        if (tItem && tItem.folderId) { tgt.classList.add('drop'); drag.target = tItem.folderId; }
        else if (win) drag.target = win.dataset.folder;
        return;
      }
      if (marquee) {
        const { r } = marquee; const x1 = e.clientX - r.left, y1 = e.clientY - r.top;
        const L = Math.min(marquee.x0, x1), T = Math.min(marquee.y0, y1), W = Math.abs(x1 - marquee.x0), H = Math.abs(y1 - marquee.y0);
        if (W + H < 6) return;
        const m = document.getElementById('marquee');
        Object.assign(m.style, { display: 'block', left: L + icons.offsetLeft + 'px', top: T + icons.offsetTop + 'px', width: W + 'px', height: H + 'px' });
        const next = new Set(marquee.base);
        $$('.dicon', icons).forEach((x) => { const bx = x.offsetLeft, by = x.offsetTop, bw = x.offsetWidth, bh = x.offsetHeight; if (bx < L + W && bx + bw > L && by < T + H && by + bh > T) next.add(x.dataset.key); });
        this.sel = next; this.syncSel();
      }
    });
    const end = (e) => {
      if (marquee) { marquee = null; document.getElementById('marquee').style.display = 'none'; }
      if (!drag) return;
      const d = drag; drag = null;
      $$('.dicon.drop', icons).forEach((x) => x.classList.remove('drop'));
      if (!d.started) {
        if (d.pointerType === 'touch' && e.type === 'pointerup') this.item(d.key)?.open();
        return;
      }
      const ids = [...this.sel].filter((k) => k.startsWith('f:')).map((k) => k.slice(2));
      if (d.target) {
        let moved = 0;
        for (const id of ids) { if (id === d.target) continue; if (d.target === 'trash' ? FS.trash(id) : FS.move(id, d.target)) moved++; }
        if (moved && d.target === 'trash') Sound.play('trash');
        this.render(); return;
      }
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      const { rows, cols } = this.grid();
      const lay = this.lastLayout || this.layout(this.items());
      const pos = {}; for (const [k, p] of lay) pos[k] = { c: p.c, r: p.r };
      const moving = d.els.map((x) => x.dataset.key);
      const taken = new Set(Object.entries(pos).filter(([k]) => !moving.includes(k)).map(([, p]) => p.c + ',' + p.r));
      for (const k of moving) {
        const p = pos[k]; if (!p) continue;
        let c = clamp(Math.round((p.c * this.CW + dx) / this.CW), 0, cols - 1), r = clamp(Math.round((p.r * this.CH + dy) / this.CH), 0, rows - 1);
        if (taken.has(c + ',' + r)) {
          let found = null;
          for (let rad = 1; rad < Math.max(rows, cols) && !found; rad++) for (let ddc = -rad; ddc <= rad && !found; ddc++) for (let ddr = -rad; ddr <= rad && !found; ddr++) { const nc = c + ddc, nr = r + ddr; if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && !taken.has(nc + ',' + nr)) found = [nc, nr]; }
          if (found) [c, r] = found;
        }
        taken.add(c + ',' + r); pos[k] = { c, r };
      }
      S.set('iconPos', pos);
      this.render();
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    icons.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const ids = this.selectedIds();
      if (e.key === 'Enter') { [...this.sel].forEach((k) => this.item(k)?.open()); }
      else if (e.key === 'Delete' && ids.length) { e.preventDefault(); deleteNodes(ids); }
      else if (e.key === 'F2' && ids.length === 1) { e.preventDefault(); this.rename(ids[0]); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.sel = new Set((this.lastItems || []).map((x) => x.key)); this.syncSel(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && ids.length) Clip.set(ids, 'copy');
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x' && ids.length) Clip.set(ids, 'cut');
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && Clip.has()) { const n = Clip.paste('desktop'); this.sel = new Set(n.map((i) => 'f:' + i)); this.render(); }
    });
    // files dropped from the viewer's computer
    root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files') || e.dataTransfer?.types?.includes('application/x-nimbus')) { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('Files') ? 'copy' : 'move'; } });
    root.addEventListener('drop', (e) => {
      const internal = e.dataTransfer?.getData('application/x-nimbus');
      if (internal) { e.preventDefault(); try { JSON.parse(internal).forEach((id) => FS.move(id, 'desktop')); } catch {} return; }
      if (e.dataTransfer?.files?.length) { e.preventDefault(); importFiles(e.dataTransfer.files, 'desktop'); }
    });
    bus.on('fs', () => this.render());
    window.addEventListener('resize', debounce(() => this.render(), 120));
  },
};

/* ========== Flyouts ========== */
const Flyouts = {
  cur: null,
  position(name) {
    const el = document.getElementById(name); const os = document.getElementById('os');
    const W = os.clientWidth, H = os.clientHeight; const top = S.data.tbPos === 'top'; const r = Shell.tbReserve();
    const gap = S.data.tbFloat ? 4 : 10;
    el.style.top = ''; el.style.bottom = ''; el.style.left = ''; el.style.right = '';
    if (top) el.style.top = r + gap + 'px'; else el.style.bottom = r + gap + 'px';
    if (name === 'start') {
      const w = Math.min(640, W - 16), hh = Math.min(660, H - r - 24);
      el.style.width = w + 'px'; el.style.height = hh + 'px';
      el.style.left = (S.data.tbAlign === 'left' ? 8 : Math.round((W - w) / 2)) + 'px';
    } else {
      el.style.right = '8px';
      el.style.maxHeight = H - r - 24 + 'px';
      el.style.width = Math.min(364, W - 16) + 'px';
    }
  },
  open(name, opts) {
    if (this.cur === name) return;
    this.close();
    const el = document.getElementById(name);
    this.cur = name;
    this.position(name);
    el.hidden = false;
    ({ start: Start, qs: QS, nc: NC })[name].open(opts);
    $$(`[data-fly="${name}"]`).forEach((b) => b.classList.add('open-fly'));
    requestAnimationFrame(() => requestAnimationFrame(() => { if (this.cur === name) el.classList.add('open'); }));
  },
  close() {
    if (!this.cur) return;
    const name = this.cur; this.cur = null;
    const el = document.getElementById(name);
    el.classList.remove('open');
    $$(`[data-fly="${name}"]`).forEach((b) => b.classList.remove('open-fly'));
    setTimeout(() => { if (this.cur !== name) el.hidden = true; }, 230);
  },
  toggle(name, opts) { if (this.cur === name) this.close(); else this.open(name, opts); },
};
document.addEventListener('pointerdown', (e) => {
  const c = Flyouts.cur; if (!c) return;
  if (e.target.closest('#' + c) || e.target.closest(`[data-fly="${c}"]`) || e.target.closest('.menu') || e.target.closest('.modal-scrim')) return;
  Flyouts.close();
}, true);

/* ========== Start menu & search ========== */
const Start = {
  view: 'home', q: '', sel: 0, flat: [],
  build() {
    const el = document.getElementById('start');
    el.innerHTML = `<div class="start-top"><label class="searchbox">${ui('search')}<input id="start-q" type="search" autocomplete="off" spellcheck="false" placeholder="Search apps, files and settings" aria-label="Search apps, files and settings"></label></div>
      <div class="start-body" id="start-body"></div>
      <div class="start-foot"><button class="userbtn" id="start-user" aria-label="Account settings"><span class="avatar"></span><span class="uname"></span></button><button class="ibtn" id="start-power" aria-label="Power" data-tip="Power">${ui('power')}</button></div>`;
    const q = $('#start-q');
    q.addEventListener('input', () => { this.q = q.value; this.sel = 0; this.render(); });
    q.addEventListener('keydown', (e) => this.key(e));
    $('#start-user').addEventListener('click', () => { Flyouts.close(); WM.open('settings', { page: 'accounts' }); });
    $('#start-power').addEventListener('click', (e) => Power.menu(e.currentTarget));
    bus.on('settings', (keys) => { if (Flyouts.cur === 'start' && keys.some((k) => ['userName', 'startPins', 'recent'].includes(k))) this.render(); });
    bus.on('caps', () => { if (Flyouts.cur === 'start') this.render(); });
  },
  open() {
    this.q = ''; this.view = 'home'; this.sel = 0;
    const q = $('#start-q'); q.value = '';
    this.render();
    setTimeout(() => q.focus({ preventScroll: true }), 30);
  },
  render() {
    $('#start-user .avatar').innerHTML = avatarHTML();
    $('#start-user .uname').textContent = userName() || 'Set your name';
    if (this.q.trim()) this.renderResults();
    else if (this.view === 'all') this.renderAll();
    else this.renderHome();
  },
  appButton(id, cls) {
    const a = APPS[id];
    const b = h('button', { class: cls, 'data-app': id, html: `<span class="ic">${appIcon(a.icon)}</span><span>${esc(a.name)}</span>` });
    b.addEventListener('click', () => { Flyouts.close(); WM.open(id); });
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); Menu.show(appMenuItems(id, 'start'), e.clientX, e.clientY); });
    return b;
  },
  renderHome() {
    const body = $('#start-body'); body.innerHTML = '';
    const head = h('div', { class: 'sec-head' }, h('h3', { text: 'Pinned' }));
    const all = h('button', { class: 'sec-btn', html: `All apps ${ui('chevR')}` }); all.onclick = () => { this.view = 'all'; this.render(); };
    head.append(all);
    const pins = h('div', { class: 'pins' });
    for (const id of S.data.startPins.filter(appAvailable)) pins.append(this.appButton(id, 'pin'));
    body.append(head, pins);
    body.append(h('div', { class: 'sec-head' }, h('h3', { text: 'Recent' })));
    const rec = (S.data.recent || []).map((id) => FS.get(id)).filter((n) => n && !FS.inTrash(n.id)).slice(0, 6);
    if (!rec.length) body.append(h('div', { class: 'empty-hint', text: 'Files you open will show up here.' }));
    else {
      const grid = h('div', { class: 'recent' });
      for (const n of rec) {
        const b = h('button', { class: 'ritem', html: `<span class="ic">${nodeIconHTML(n, true)}</span><span class="tx"><div class="t">${esc(n.name)}</div><div class="s">${esc(relTime(n.modified))} · ${esc(FS.parentName(n.id))}</div></span>` });
        b.onclick = () => { Flyouts.close(); openNode(n.id); };
        b.oncontextmenu = (e) => { e.preventDefault(); Menu.show([{ label: 'Open', icon: 'external', action: () => { Flyouts.close(); openNode(n.id); } }, { label: 'Open file location', icon: 'folderOpen', action: () => { Flyouts.close(); WM.open('files', { folder: n.parent, select: n.id }); } }, 'sep', { label: 'Remove from list', icon: 'x', action: () => FS.forgetRecent([n.id]) }], e.clientX, e.clientY); };
        grid.append(b);
      }
      body.append(grid);
    }
  },
  renderAll() {
    const body = $('#start-body'); body.innerHTML = '';
    const head = h('div', { class: 'sec-head' }, h('h3', { text: 'All apps' }));
    const back = h('button', { class: 'sec-btn', html: `${ui('chevL')} Back` }); back.onclick = () => { this.view = 'home'; this.render(); };
    head.append(back);
    const list = h('div', { class: 'alist' });
    let letter = '';
    for (const id of Object.keys(APPS).filter(appAvailable).sort((a, b) => APPS[a].name.localeCompare(APPS[b].name))) {
      const L = APPS[id].name[0].toUpperCase();
      if (L !== letter) { letter = L; list.append(h('div', { class: 'letter', text: L })); }
      list.append(this.appButton(id, 'aitem'));
    }
    body.append(head, list);
  },
  renderResults() {
    const body = $('#start-body'); body.innerHTML = '';
    const res = Search.query(this.q);
    if (!res.length) { body.append(h('div', { class: 'no-results', text: `No results for “${this.q.trim()}”` })); this.flat = []; return; }
    const [best, ...rest] = res;
    const groups = new Map();
    for (const r of rest) { if (!groups.has(r.group)) groups.set(r.group, []); groups.get(r.group).push(r); }
    this.flat = [best, ...[...groups.values()].flat()];
    this.sel = clamp(this.sel, 0, this.flat.length - 1);
    const wrap = h('div', { class: 'results', role: 'listbox', 'aria-label': 'Search results' });
    wrap.append(h('div', { class: 'res-group', text: 'Best match' }), this.resButton(best, 0, true));
    let i = 1;
    for (const [g, items] of groups) { wrap.append(h('div', { class: 'res-group', text: g })); for (const r of items) wrap.append(this.resButton(r, i++, false)); }
    body.append(wrap);
  },
  resButton(r, i, best) {
    const icon = r.uiIcon ? `<span class="ic ui">${ui(r.uiIcon)}</span>` : r.node ? `<span class="ic">${nodeIconHTML(r.node, true)}</span>` : `<span class="ic">${appIcon(r.icon)}</span>`;
    const b = h('button', { class: 'res' + (best ? ' best' : '') + (i === this.sel ? ' sel' : ''), role: 'option', 'aria-selected': String(i === this.sel), html: `${icon}<span class="tx"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.sub || '')}</div></span>${best ? `<span class="go">Enter</span>` : ''}` });
    b.addEventListener('click', () => this.run(r));
    b.addEventListener('pointerenter', () => { this.sel = i; $$('#start-body .res').forEach((x, j) => { x.classList.toggle('sel', j === i); x.setAttribute('aria-selected', String(j === i)); }); });
    return b;
  },
  run(r) { Flyouts.close(); try { r.run(); } catch (e) { console.error(e); } },
  key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (this.q) { this.q = ''; $('#start-q').value = ''; this.render(); } else Flyouts.close(); return; }
    if (!this.q.trim()) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!this.flat.length) return;
      this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + this.flat.length) % this.flat.length;
      $$('#start-body .res').forEach((x, j) => { x.classList.toggle('sel', j === this.sel); x.setAttribute('aria-selected', String(j === this.sel)); if (j === this.sel) x.scrollIntoView({ block: 'nearest' }); });
    } else if (e.key === 'Enter') { e.preventDefault(); const r = this.flat[this.sel]; if (r) this.run(r); }
  },
};
const Search = {
  actions() {
    const dark = effectiveTheme() === 'dark';
    return [
      { name: dark ? 'Turn on light mode' : 'Turn on dark mode', keywords: 'theme dark light mode appearance color', icon: 'contrast', run: () => S.set('theme', dark ? 'light' : 'dark') },
      { name: S.data.nightLight ? 'Turn off night light' : 'Turn on night light', keywords: 'night light warm screen eyes', icon: 'sunset', run: () => S.set('nightLight', !S.data.nightLight) },
      { name: S.data.dnd ? 'Turn off Focus' : 'Turn on Focus', keywords: 'do not disturb dnd notifications quiet silence', icon: 'bellOff', run: () => S.set('dnd', !S.data.dnd) },
      { name: 'Start a 25 minute focus session', keywords: 'focus pomodoro timer session concentrate', icon: 'target', run: () => Clock.startFocus(25) },
      { name: 'New text document', keywords: 'new note file create text write', icon: 'doc', run: () => WM.open('notes') },
      { name: 'New folder on the desktop', keywords: 'new folder create directory', icon: 'folder', run: () => Desktop.newItem('folder') },
      { name: 'Empty Recycle Bin', keywords: 'trash recycle bin empty delete', icon: 'trash', run: () => emptyTrashConfirm() },
      { name: 'Next wallpaper', keywords: 'wallpaper background change shuffle', icon: 'image', run: nextWallpaper },
      { name: 'Show desktop', keywords: 'minimize all hide windows', icon: 'desktop', run: () => WM.showDesktop() },
      { name: 'Task view', keywords: 'all windows overview switch', icon: 'taskview', run: () => WM.taskView(true) },
      { name: 'Lock', keywords: 'lock screen away', icon: 'lock', run: () => Power.lock() },
      { name: 'Sleep', keywords: 'sleep screen off', icon: 'moon', run: () => Power.sleep() },
      { name: 'Restart', keywords: 'restart reboot reload', icon: 'restart', run: () => Power.restart() },
      { name: 'Shut down', keywords: 'shut down power off turn off', icon: 'power', run: () => Power.shutdown() },
    ];
  },
  score(text, extra, ql) {
    const t = text.toLowerCase();
    if (t === ql) return 100;
    if (t.startsWith(ql)) return 82;
    if (t.split(/[\s._()-]+/).some((w) => w.startsWith(ql))) return 64;
    if (t.includes(ql)) return 44;
    if (extra && extra.toLowerCase().split(/\s+/).some((w) => w.startsWith(ql))) return 34;
    return 0;
  },
  query(q) {
    q = q.trim(); if (!q) return [];
    const ql = q.toLowerCase(); const out = [];
    if (/\d/.test(q) && /[-+*/^%×÷()]/.test(q)) {
      try { const v = evalMath(q); out.push({ group: 'Calculator', score: 130, title: fmtNum(v), sub: q.replace(/^=/, '') + ' =  ·  Enter copies the result', icon: 'calculator', run: async () => { const ok = await copyText(String(parseFloat(v.toPrecision(14)))); Notif.push({ app: 'calculator', title: ok ? 'Result copied' : 'Result', body: fmtNum(v), silent: true }); } }); } catch {}
    }
    for (const id in APPS) {
      if (!appAvailable(id)) continue; const a = APPS[id];
      const s = this.score(a.name, a.keywords, ql);
      if (s) out.push({ group: 'Apps', score: s + 6, title: a.name, sub: 'App', icon: a.icon, run: () => WM.open(id) });
    }
    if (typeof SETTINGS_INDEX !== 'undefined') for (const st of SETTINGS_INDEX) {
      const s = this.score(st.name, st.keywords, ql);
      if (s) out.push({ group: 'Settings', score: s, title: st.name, sub: 'Settings › ' + st.pageName, uiIcon: st.icon || 'settings', run: () => WM.open('settings', { page: st.page, focus: st.id }) });
    }
    for (const id in FS.nodes) {
      const n = FS.nodes[id]; if (id === 'root' || FS.inTrash(id)) continue;
      const s = this.score(n.name, '', ql);
      if (s) out.push({ group: n.type === 'folder' ? 'Folders' : 'Files', score: s - 3 + (S.data.recent.includes(id) ? 4 : 0), title: n.name, sub: n.type === 'folder' ? FS.pathOf(id) : FS.pathOf(n.parent), node: n, run: () => openNode(id) });
    }
    for (const a of this.actions()) {
      const s = this.score(a.name, a.keywords, ql);
      if (s) out.push({ group: 'Actions', score: s - 1, title: a.name, sub: 'Action', uiIcon: a.icon, run: a.run });
    }
    out.sort((a, b) => b.score - a.score);
    const res = out.slice(0, 24);
    if (caps.sample && q.length > 2) res.push({ group: 'Assistant', score: 0, title: `Ask the assistant: “${q}”`, sub: 'Get an answer or have it do this for you', icon: 'assistant', run: () => WM.open('assistant', { ask: q }) });
    return res;
  },
};

/* ========== Quick settings ========== */
const QS = {
  open() { this.render(); },
  tiles() {
    const dark = effectiveTheme() === 'dark';
    return [
      { icon: 'contrast', label: 'Dark mode', on: dark, run: () => S.set('theme', dark ? 'light' : 'dark') },
      { icon: 'sunset', label: 'Night light', on: S.data.nightLight, run: () => S.set('nightLight', !S.data.nightLight) },
      { icon: 'bellOff', label: 'Focus', on: S.data.dnd, run: () => S.set('dnd', !S.data.dnd) },
      { icon: 'leaf', label: 'Energy saver', on: S.data.energySaver, run: () => S.set('energySaver', !S.data.energySaver) },
      { icon: S.data.sounds ? 'volume' : 'mute', label: 'Sounds', on: S.data.sounds, run: () => S.set('sounds', !S.data.sounds) },
      { icon: 'textSize', label: 'Bigger text', on: S.data.textSize >= 16, run: () => S.set('textSize', S.data.textSize >= 16 ? 14 : 16) },
    ];
  },
  render() {
    const el = document.getElementById('qs'); el.innerHTML = '';
    const grid = h('div', { class: 'qs-grid' });
    this.tiles().forEach((t, i) => {
      const b = h('button', { class: 'qb', 'aria-pressed': String(!!t.on), 'aria-label': t.label, html: ui(t.icon) });
      b.addEventListener('click', () => { this.tiles()[i].run(); this.sync(); });
      grid.append(h('div', { class: 'qtile' + (t.on ? ' on' : ''), 'data-i': i }, b, h('span', { text: t.label })));
    });
    const slider = (icon, key, min, label) => {
      const inp = h('input', { type: 'range', min, max: 100, value: S.data[key], 'aria-label': label, id: 'qs-' + key });
      const v = h('span', { class: 'v', text: S.data[key] + '%' });
      inp.addEventListener('input', () => { S.set(key, +inp.value); v.textContent = inp.value + '%'; });
      if (key === 'volume') inp.addEventListener('change', () => Sound.play('tick'));
      return h('div', { class: 'qs-slider' }, h('span', { html: ui(icon) }), inp, v);
    };
    const online = navigator.onLine !== false; const bat = Taskbar.bat;
    const st = Store.cloudLabel();
    const foot = h('div', { class: 'qs-foot' },
      h('span', { class: 'st', html: ui(online ? 'wifi' : 'wifiOff') + `<span>${online ? 'Online' : 'Offline'}</span>` }),
      bat ? h('span', { class: 'st', html: batteryIcon(bat.level, bat.charging) + `<span>${Math.round(bat.level * 100)}%${bat.charging ? ', charging' : ''}</span>` }) : null,
      h('span', { class: 'st', 'data-tip': st.title, html: ui(st.icon) + `<span>${Store.shortLabel()}</span>` }),
      h('span', { class: 'grow' }),
      h('button', { class: 'ibtn', 'aria-label': 'All settings', 'data-tip': 'All settings', html: ui('settings'), onclick: () => { Flyouts.close(); WM.open('settings'); } }));
    el.append(grid, slider('sun', 'brightness', 30, 'Brightness'), slider('volume', 'volume', 0, 'Volume'), foot);
  },
  sync() {
    if (Flyouts.cur !== 'qs') return;
    const tiles = this.tiles();
    $$('#qs .qtile').forEach((t, i) => { const d = tiles[i]; t.classList.toggle('on', !!d.on); const b = t.querySelector('.qb'); b.setAttribute('aria-pressed', String(!!d.on)); b.innerHTML = ui(d.icon); });
    for (const key of ['brightness', 'volume']) { const inp = document.getElementById('qs-' + key); if (inp && document.activeElement !== inp) { inp.value = S.data[key]; inp.nextElementSibling.textContent = S.data[key] + '%'; } }
  },
};
bus.on('settings', () => QS.sync());
function batteryIcon(level, charging) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M21.5 10.5v3"/><rect x="4.6" y="9.1" width="${Math.max(1, 12.8 * level).toFixed(1)}" height="5.8" rx="1.2" fill="currentColor" stroke="none"/>${charging ? '<path d="M11.6 8.2l-2.6 4h2.6l-.8 3.6 3-4.4h-2.6z" fill="var(--surface)" stroke="none"/>' : ''}</svg>`;
}

/* ========== Notification center & calendar ========== */
const NC = {
  month: null,
  open() { const d = new Date(); this.month = new Date(d.getFullYear(), d.getMonth(), 1); this.focusMin = this.focusMin || 30; this.render(); Notif.seen(); },
  render() {
    const el = document.getElementById('nc'); el.innerHTML = '';
    const head = h('div', { class: 'nc-head' }, h('h3', { text: 'Notifications' }));
    if (Notif.items.length) head.append(h('button', { class: 'btn sm', text: 'Clear all', onclick: () => { Notif.clear(); } }));
    else if (S.data.dnd) head.append(h('span', { class: 'muted', style: 'font-size:var(--fs-sm)', text: 'Focus is on' }));
    el.append(head);
    if (!Notif.items.length) el.append(h('div', { class: 'nc-empty', text: S.data.dnd ? 'Notifications stay quiet while Focus is on. They will collect here.' : 'No new notifications' }));
    else {
      const list = h('div', { class: 'nc-list' });
      for (const n of Notif.items) {
        const it = h('div', { class: 'notif' + (n.action ? ' clickable' : '') });
        it.innerHTML = `<span class="ic">${appIcon(APPS[n.app]?.icon || 'logo')}</span><div class="ttl">${esc(n.title)} <time>${esc(relTime(n.time))}</time></div>${n.body ? `<div class="bd">${esc(n.body)}</div>` : ''}`;
        const x = h('button', { class: 'ibtn x', 'aria-label': 'Dismiss', html: ui('x') });
        x.addEventListener('click', (e) => { e.stopPropagation(); Notif.remove(n.id); });
        it.append(x);
        if (n.action) it.addEventListener('click', () => { Flyouts.close(); n.action(); Notif.remove(n.id); });
        list.append(it);
      }
      el.append(list);
    }
    el.append(this.calendar(), this.focusRow());
  },
  calendar() {
    const now = new Date(); const m = this.month;
    const wrap = h('div', { class: 'cal' });
    const head = h('div', { class: 'cal-head' }, h('b', { text: fmtDT(m, { month: 'long', year: 'numeric' }) }));
    const nav = h('div', { class: 'nav' },
      h('button', { class: 'ibtn', 'aria-label': 'Previous month', html: ui('chevU'), onclick: () => { this.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); this.render(); } }),
      h('button', { class: 'ibtn', 'aria-label': 'Next month', html: ui('chevD'), onclick: () => { this.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); this.render(); } }));
    head.append(nav);
    const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': fmtDT(m, { month: 'long', year: 'numeric' }) });
    const fdw = (() => { try { const l = new Intl.Locale(navigator.language); const wi = l.getWeekInfo?.() || l.weekInfo; return wi ? wi.firstDay % 7 : 0; } catch { return 0; } })();
    for (let i = 0; i < 7; i++) grid.append(h('div', { class: 'dow', text: fmtDT(new Date(2023, 0, 1 + ((fdw + i) % 7)), { weekday: 'narrow' }) }));
    const start = new Date(m); start.setDate(1 - ((m.getDay() - fdw + 7) % 7));
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const isToday = d.toDateString() === now.toDateString();
      grid.append(h('div', { class: 'd' + (d.getMonth() !== m.getMonth() ? ' other' : '') + (isToday ? ' today' : ''), 'aria-label': fmtDT(d, { dateStyle: 'full' }) }, h('span', { text: d.getDate() })));
    }
    wrap.append(h('div', { style: 'font-weight:600;margin-bottom:8px', text: fmtDT(now, { weekday: 'long', month: 'long', day: 'numeric' }) }), head, grid);
    return wrap;
  },
  focusRow() {
    const row = h('div', { class: 'focus-row' });
    if (Clock.focus.running) {
      row.append(h('span', { html: ui('target') }), h('span', { class: 'grow', text: `Focus session: ${fmtDuration(Clock.focus.left)} left` }), h('button', { class: 'btn sm', text: 'End session', onclick: () => { Clock.reset('focus'); this.render(); } }));
      return row;
    }
    const mins = h('span', { class: 'mins', text: this.focusMin + ' mins' });
    const step = (d) => { this.focusMin = clamp(this.focusMin + d, 5, 240); mins.textContent = this.focusMin + ' mins'; };
    row.append(
      h('button', { class: 'ibtn', 'aria-label': 'Fewer minutes', html: ui('minus'), onclick: () => step(-5) }), mins,
      h('button', { class: 'ibtn', 'aria-label': 'More minutes', html: ui('plus'), onclick: () => step(5) }),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn sm primary', html: ui('target') + 'Focus', onclick: () => { Clock.startFocus(this.focusMin); this.render(); } }));
    return row;
  },
};
bus.on('notif', () => { if (Flyouts.cur === 'nc') { NC.render(); Notif.unread = 0; } Taskbar.badge(); });
bus.on('settings', (keys) => { if (Flyouts.cur === 'nc' && keys.includes('dnd')) NC.render(); });

/* ========== Taskbar ========== */
const Taskbar = {
  bat: null,
  init() {
    $('#tb-start').innerHTML = appIcon('logo');
    $('#tb-search').innerHTML = ui('search');
    $('#tb-tv').innerHTML = ui('taskview');
    $('#tb-assist').innerHTML = appIcon('assistant');
    $('#tb-start').addEventListener('click', () => Flyouts.toggle('start'));
    $('#tb-search').addEventListener('click', () => Flyouts.toggle('start'));
    $('#tb-tv').addEventListener('click', () => WM.taskView());
    $('#tb-tray').addEventListener('click', () => Flyouts.toggle('qs'));
    $('#tb-clock').addEventListener('click', () => Flyouts.toggle('nc'));
    $('#tb-desk').addEventListener('click', () => WM.showDesktop());
    $('#tb-assist').addEventListener('click', () => { Flyouts.close(); WM.open('assistant'); });
    $('#tb-focus').addEventListener('click', () => WM.open('clock', { tab: 'focus' }));
    const apps = $('#tb-apps');
    apps.addEventListener('click', (e) => { const b = e.target.closest('.tbtn'); if (b) this.clickApp(b.dataset.app, e, b); });
    apps.addEventListener('auxclick', (e) => { if (e.button !== 1) return; const b = e.target.closest('.tbtn'); if (b) { e.preventDefault(); WM.open(b.dataset.app); } });
    apps.addEventListener('contextmenu', (e) => { const b = e.target.closest('.tbtn'); if (!b) return; e.preventDefault(); e.stopPropagation(); Menu.show(appMenuItems(b.dataset.app, 'taskbar'), 0, 0, { anchorEl: b, above: S.data.tbPos !== 'top', center: true }); });
    $('#taskbar').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      Menu.show([{ label: 'Taskbar settings', icon: 'settings', action: () => WM.open('settings', { page: 'taskbar' }) }, { label: 'Task Manager', icon: 'activity', action: () => WM.open('taskmgr') }, 'sep', { label: 'Show desktop', icon: 'desktop', action: () => WM.showDesktop() }], e.clientX, e.clientY);
    });
    bus.on('wm', () => this.render()); bus.on('wm-title', () => this.render()); bus.on('caps', () => this.render());
    bus.on('clock', () => this.focusChip()); bus.on('store', () => QS.sync());
    setInterval(() => this.clock(), 1000); this.clock();
    addEventListener('online', () => this.tray()); addEventListener('offline', () => this.tray());
    if (IS_NATIVE) {
      const upd = (b) => { this.bat = b ? { level: clamp(b.percent / 100, 0, 1), charging: !!b.charging } : null; this.tray(); };
      bus.on('native-info', (i) => upd(i && i.battery));
      setInterval(() => Native.call('battery').then(upd).catch(() => {}), 60000);
    } else try {
      navigator.getBattery?.().then((b) => {
        const upd = () => { this.bat = (b.charging && b.level >= 0.999) ? null : { level: b.level, charging: b.charging }; this.tray(); };
        b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); upd();
      }).catch(() => {});
    } catch {}
    this.tray();
  },
  render() {
    const box = $('#tb-apps'); const running = WM.list(); const active = WM.activeId();
    const ids = S.data.pinned.filter(appAvailable);
    for (const w of running) if (!ids.includes(w.appId)) ids.push(w.appId);
    const existing = new Map([...box.children].map((b) => [b.dataset.app, b]));
    ids.forEach((id, i) => {
      let b = existing.get(id);
      if (!b) b = h('button', { class: 'tbtn app', 'data-app': id, html: `<span class="ic">${appIcon(APPS[id].icon)}</span><span class="ind"></span>` });
      existing.delete(id);
      const ws = running.filter((w) => w.appId === id);
      b.classList.toggle('running', ws.length > 0);
      b.classList.toggle('focused', ws.some((w) => w.id === active && !w.min));
      const tip = ws.length === 1 ? ws[0].title : ws.length > 1 ? `${APPS[id].name} (${ws.length} windows)` : APPS[id].name;
      b.setAttribute('data-tip', tip);
      b.setAttribute('aria-label', APPS[id].name + (ws.length ? `, ${ws.length} open` : ''));
      if (box.children[i] !== b) box.insertBefore(b, box.children[i] || null);
    });
    for (const b of existing.values()) b.remove();
  },
  clickApp(id, e, btn) {
    const ws = WM.list().filter((w) => w.appId === id);
    if (e.shiftKey || !ws.length) { WM.open(id); return; }
    if (ws.length === 1) { const w = ws[0]; if (w.id === WM.activeId() && !w.min) WM.minimize(w); else WM.focus(w); return; }
    Menu.show(ws.map((w) => ({ label: w.title, icon: APPS[id].icon, appIcon: true, action: () => WM.focus(w) })).concat(['sep', { label: 'New window', icon: 'plus', action: () => WM.open(id) }]), 0, 0, { anchorEl: btn, above: S.data.tbPos !== 'top', center: true });
  },
  clock() {
    $('#tb-time').textContent = fmtTime(S.data.clockSeconds);
    $('#tb-date').textContent = fmtDT(Date.now(), { year: 'numeric', month: 'numeric', day: 'numeric' });
    $('#tb-clock').classList.toggle('dnd', !!S.data.dnd);
    $('#tb-clock').setAttribute('aria-label', `${fmtDT(Date.now(), { dateStyle: 'full' })}, ${fmtTime(false)}. Notifications and calendar.`);
  },
  tray() {
    const online = navigator.onLine !== false; const vol = S.data.sounds && S.data.volume > 0;
    let htm = ui(online ? 'wifi' : 'wifiOff') + ui(vol ? 'volume' : 'mute');
    if (this.bat) htm += batteryIcon(this.bat.level, this.bat.charging);
    const t = $('#tb-tray'); t.innerHTML = htm;
    t.setAttribute('aria-label', `Quick settings. ${online ? 'Online' : 'Offline'}. Sounds ${vol ? S.data.volume + '%' : 'off'}.${this.bat ? ' Battery ' + Math.round(this.bat.level * 100) + '%.' : ''}`);
    t.setAttribute('data-tip', `${online ? 'Online' : 'Offline'} · ${vol ? 'Volume ' + S.data.volume + '%' : 'Sounds off'}${this.bat ? ' · Battery ' + Math.round(this.bat.level * 100) + '%' : ''}`);
  },
  badge() { const b = $('#tb-badge'); const n = Notif.unread; b.hidden = !n || Flyouts.cur === 'nc'; b.textContent = n > 9 ? '9+' : String(n); },
  focusChip() {
    const f = Clock.focus; const chip = $('#tb-focus');
    const show = f.running || (f.left < f.dur && f.left > 0);
    chip.hidden = !show;
    if (show) { chip.innerHTML = ui('target') + `<span>${fmtDuration(f.left)}</span>`; chip.setAttribute('aria-label', `Focus session, ${fmtDuration(f.left)} left${f.running ? '' : ', paused'}`); chip.setAttribute('data-tip', f.running ? 'Focus session' : 'Focus session (paused)'); }
  },
};

/* ========== Power, lock and boot screens ========== */
const Power = {
  screen(cls, inner) { const el = h('div', { class: 'screen ' + cls, html: inner }); document.getElementById('screens').append(el); return el; },
  menu(anchor) {
    Menu.show([
      { label: 'Lock', icon: 'lock', kb: 'Ctrl+Alt+L', action: () => { Flyouts.close(); this.lock(); } },
      { label: 'Sleep', icon: 'moon', action: () => { Flyouts.close(); this.sleep(); } },
      'sep',
      { label: 'Restart', icon: 'restart', action: () => { Flyouts.close(); this.restart(); } },
      { label: 'Shut down', icon: 'power', action: () => { Flyouts.close(); this.shutdown(); } },
    ], 0, 0, { anchorEl: anchor, above: S.data.tbPos !== 'top', alignRight: true });
  },
  async boot() {
    const el = this.screen('boot', `<div class="boot-inner"><div class="boot-logo">${appIcon('logo')}</div><div class="boot-name">${esc(osTitle())}</div><div class="spinner" role="progressbar" aria-label="Starting up"></div></div>`);
    await sleep(1700);
    if (S.data.lockOnStart) this.lock(true); else Sound.play('startup');
    el.classList.add('fade'); setTimeout(() => el.remove(), 480);
  },
  lock() {
    if (document.querySelector('.screen.lock')) return;
    Flyouts.close(); Menu.close(); WM.hideSnapFly();
    const el = this.screen('lock', `<div class="lock-clock"><div class="lock-time"></div><div class="lock-date"></div></div><div class="lock-user"><div class="avatar">${avatarHTML()}</div><div class="nm">${esc(userName() || osTitle())}</div><div class="lock-hint">${ui('lock')}<span>Click or press any key to unlock</span></div></div>`);
    el.style.backgroundImage = `url("${currentWallURL}")`;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Lock screen'); el.tabIndex = 0;
    const tick = () => { el.querySelector('.lock-time').textContent = fmtTime(false, true); el.querySelector('.lock-date').textContent = fmtDT(Date.now(), { weekday: 'long', month: 'long', day: 'numeric' }); };
    tick(); const t = setInterval(tick, 1000);
    const unlock = (e) => {
      if (el.classList.contains('unlocking')) return;
      if (e && e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      Sound.unlock(); Sound.play('unlock');
      el.classList.add('unlocking'); clearInterval(t);
      setTimeout(() => el.remove(), 520);
    };
    el.addEventListener('pointerdown', unlock); el.addEventListener('keydown', unlock);
    requestAnimationFrame(() => el.focus());
  },
  sleep() {
    Flyouts.close(); Menu.close();
    const el = this.screen('sleep', '');
    el.tabIndex = 0; el.setAttribute('aria-label', 'Sleeping. Click or press a key to wake.');
    const wake = () => { el.remove(); this.lock(); };
    setTimeout(() => { el.addEventListener('pointerdown', wake, { once: true }); el.addEventListener('keydown', wake, { once: true }); el.focus(); }, 400);
    if (IS_NATIVE) { Store.flushLocal(); setTimeout(() => Native.call('power', { action: 'suspend' }).catch(() => {}), 700); }
  },
  async native(action, el) {
    Store.flushLocal();
    try { await Native.call('power', { action }); return true; }
    catch (e) {
      el.remove();
      Notif.push({ app: 'settings', title: action === 'reboot' ? 'Could not restart' : 'Could not shut down', body: e.message });
      return false;
    }
  },
  async confirmClose(verb) {
    if (!WM.anyDirty()) return true;
    return Dialog.confirm(`${verb} anyway?`, 'Some apps have unsaved changes. If you continue, those changes will be lost.', { ok: verb + ' anyway', danger: true });
  },
  async restart() {
    if (!(await this.confirmClose('Restart'))) return;
    Flyouts.close(); Menu.close(); WM.taskView(false);
    const el = this.screen('boot', `<div class="boot-inner"><div class="spinner"></div><div class="boot-msg">Restarting</div></div>`);
    await WM.closeAll(true);
    await sleep(1100);
    if (IS_NATIVE) { await this.native('reboot', el); return; }
    el.remove();
    this.boot();
  },
  async shutdown() {
    if (!(await this.confirmClose('Shut down'))) return;
    Flyouts.close(); Menu.close(); WM.taskView(false);
    Sound.play('shutdown');
    const el = this.screen('boot', `<div class="boot-inner"><div class="spinner"></div><div class="boot-msg">Shutting down</div></div>`);
    await WM.closeAll(true);
    await sleep(1300);
    if (IS_NATIVE) { await this.native('poweroff', el); return; }
    el.remove();
    const off = this.screen('off', `<div class="off-inner"><button class="power" aria-label="Start ${esc(osTitle())}">${ui('power')}</button><span>Start ${esc(osTitle())}</span></div>`);
    off.querySelector('.power').addEventListener('click', () => { Sound.unlock(); off.remove(); this.boot(); });
  },
};

/* ========== Alt+Tab (only reaches the page when it is the real desktop) ========== */
const Switcher = {
  el: null, list: [], i: 0,
  key(e) {
    if (e.key === 'Tab' && e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation();
      if (!this.el) this.open(); else this.move(e.shiftKey ? -1 : 1);
      return true;
    }
    if (!this.el) return false;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.move(e.key === 'ArrowRight' ? 1 : -1); return true; }
    return e.key === 'Alt';
  },
  open() {
    this.list = WM.list().slice().sort((a, b) => (a.min - b.min) || (b.z - a.z));
    if (!this.list.length) return;
    this.i = this.list.length > 1 ? 1 : 0;
    this.el = h('div', { class: 'switcher acrylic', role: 'listbox', 'aria-label': 'Switch windows' });
    for (const w of this.list) this.el.append(h('div', { class: 'sw-item', role: 'option', html: `<span class="ic">${appIcon(w.app.icon)}</span><span class="t">${esc(w.title)}</span>` }));
    document.getElementById('os').append(this.el);
    this.paint();
  },
  move(d) { if (!this.el) return; this.i = (this.i + d + this.list.length) % this.list.length; this.paint(); },
  paint() { [...this.el.children].forEach((c, j) => { c.classList.toggle('on', j === this.i); c.setAttribute('aria-selected', String(j === this.i)); }); },
  commit() { if (!this.el) return; const w = this.list[this.i]; this.close(); if (w) WM.focus(w); },
  close() { if (this.el) this.el.remove(); this.el = null; },
};
let metaAlone = false, metaDown = false;
const isMetaKey = (e) => ['Meta', 'OS', 'Super', 'Hyper'].includes(e.key) || /^(Meta|OS|Super)(Left|Right)$/.test(e.code || '');
function metaShortcut(e) {
  if (e.key.startsWith('Arrow')) { WM.keySnap(e.key); return true; }
  const run = { e: () => WM.open('files'), d: () => WM.showDesktop(), l: () => Power.lock(), i: () => WM.open('settings'), a: () => Flyouts.toggle('qs'), n: () => Flyouts.toggle('nc'), s: () => Flyouts.toggle('start'), r: () => Flyouts.open('start'), tab: () => WM.taskView() }[e.key.toLowerCase()];
  if (!run) return false;
  run(); return true;
}
async function altF4() {
  if (document.querySelector('#os > .modal-scrim')) return;
  const w = WM.active();
  if (w) { WM.close(w); return; }
  const v = await Dialog.show({ title: 'Shut down ' + osTitle() + '?', message: 'Choose what the computer should do.', cancelValue: null,
    buttons: [{ label: 'Shut down', value: 'off', primary: true }, { label: 'Restart', value: 'reboot' }, { label: 'Sleep', value: 'sleep' }, { label: 'Cancel', value: null }] });
  if (v === 'off') Power.shutdown(); else if (v === 'reboot') Power.restart(); else if (v === 'sleep') Power.sleep();
}

/* ========== Global keyboard ========== */
window.addEventListener('keydown', (e) => {
  if (Menu.isOpen) { if (Menu.key(e)) { e.preventDefault(); e.stopPropagation(); } return; }
  if (document.getElementById('screens').childElementCount) return;
  if (IS_NATIVE) {
    if (Switcher.key(e)) return;
    if (isMetaKey(e)) { metaDown = true; if (!e.repeat) metaAlone = true; return; }
    if (e.metaKey || metaDown) { metaAlone = false; if (metaShortcut(e)) { e.preventDefault(); return; } }
    if (e.altKey && e.key === 'F4') { e.preventDefault(); altF4(); return; }
  }
  const k = (e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey && !e.shiftKey && k === 'k' && !e.target.closest?.('.rterm')) { e.preventDefault(); Flyouts.toggle('start'); return; }
  if (e.ctrlKey && e.altKey && k === 't') { e.preventDefault(); WM.open('terminal'); return; }
  if (e.ctrlKey && e.altKey && k === 'd') { e.preventDefault(); WM.showDesktop(); return; }
  if (e.ctrlKey && e.altKey && k === 'l') { e.preventDefault(); Power.lock(); return; }
  if (e.altKey && e.shiftKey && e.key.startsWith('Arrow')) { e.preventDefault(); WM.keySnap(e.key); return; }
  if (e.key === 'Escape') {
    if (Flyouts.cur) { e.preventDefault(); Flyouts.close(); }
    else if (WM.inTaskView()) { e.preventDefault(); WM.taskView(false); }
  }
}, true);
window.addEventListener('keyup', (e) => {
  if (!IS_NATIVE) return;
  if (e.key === 'Alt') Switcher.commit();
  if (isMetaKey(e)) {
    metaDown = false;
    if (metaAlone) { metaAlone = false; if (!document.getElementById('screens').childElementCount && !Menu.isOpen) Flyouts.toggle('start'); }
  }
}, true);
window.addEventListener('blur', () => { Switcher.close(); metaAlone = false; metaDown = false; });
document.addEventListener('pointerdown', () => { metaAlone = false; Sound.unlock(); }, { capture: true });
document.addEventListener('keydown', () => Sound.unlock(), { once: true, capture: true });
document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, .selectable')) e.preventDefault(); });
