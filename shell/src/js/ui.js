/* ========== Context menus ========== */
const Menu = (() => {
  let stack = []; // [{el, items, hl}]
  let onCloseCb = null;
  const osEl = () => document.getElementById('os');
  function build(items, level) {
    const el = h('div', { class: 'menu acrylic', role: 'menu' });
    const list = items.filter((x) => x);
    const hasChk = list.some((it) => it !== 'sep' && it.checked !== undefined);
    const hasIcon = list.some((it) => it !== 'sep' && it.icon);
    const entry = { el, items: list, btns: [], hl: -1, level, subTimer: 0 };
    list.forEach((it) => {
      if (it === 'sep') { el.append(h('div', { class: 'sep', role: 'separator' })); return; }
      if (it.header) { el.append(h('div', { class: 'mhead', text: it.header })); return; }
      const b = h('button', { class: 'mi' + (it.danger ? ' danger' : ''), role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem', disabled: !!it.disabled });
      if (it.checked !== undefined) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      b.innerHTML = (hasChk ? `<span class="chk">${it.checked ? ui('check') : ''}</span>` : '') +
        (hasIcon ? (it.icon ? (it.appIcon ? `<span style="width:16px;height:16px">${appIcon(it.icon)}</span>` : ui(it.icon)) : '<span class="noi"></span>') : '') +
        `<span class="lbl">${esc(it.label)}</span>` + (it.kb ? `<span class="kb">${esc(it.kb)}</span>` : '') + (it.submenu ? `<span class="sub">${ui('chevR')}</span>` : '');
      const idx = entry.btns.length;
      entry.btns.push({ b, it });
      b.addEventListener('pointerenter', () => { setHL(entry, idx); clearTimeout(entry.subTimer); closeFrom(level + 1); if (it.submenu && !it.disabled) entry.subTimer = setTimeout(() => openSub(entry, idx), 160); });
      b.addEventListener('click', (e) => { e.stopPropagation(); activate(entry, idx); });
      el.append(b);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return entry;
  }
  function setHL(entry, idx) { entry.btns.forEach((x, i) => x.b.classList.toggle('hl', i === idx)); entry.hl = idx; }
  function place(el, x, y, opts = {}) {
    const os = osEl(); const W = os.clientWidth, H = os.clientHeight;
    el.style.left = '0px'; el.style.top = '0px'; el.style.visibility = 'hidden';
    os.append(el);
    const w = el.offsetWidth, hh = el.offsetHeight;
    let left = x, top = y;
    if (opts.anchor) {
      const a = opts.anchor; left = a.left; top = opts.above ? a.top - hh - 6 : a.bottom + 6;
      if (opts.alignRight) left = a.right - w;
      if (opts.center) left = a.left + a.width / 2 - w / 2;
      if (top < 6) top = a.bottom + 6;
      if (top + hh > H - 6) top = Math.max(6, a.top - hh - 6);
    } else {
      if (left + w > W - 6) left = opts.flipFrom != null ? opts.flipFrom - w : left - w;
      if (top + hh > H - 6) top = Math.max(6, H - hh - 6);
    }
    el.style.left = clamp(left, 6, Math.max(6, W - w - 6)) + 'px';
    el.style.top = clamp(top, 6, Math.max(6, H - hh - 6)) + 'px';
    el.style.visibility = '';
  }
  function osPoint(clientX, clientY) { const r = osEl().getBoundingClientRect(); return [clientX - r.left, clientY - r.top]; }
  function osRect(r) { const o = osEl().getBoundingClientRect(); return { left: r.left - o.left, top: r.top - o.top, right: r.right - o.left, bottom: r.bottom - o.top, width: r.width, height: r.height }; }
  function openSub(entry, idx) {
    const { b, it } = entry.btns[idx];
    closeFrom(entry.level + 1);
    const sub = build(typeof it.submenu === 'function' ? it.submenu() : it.submenu, entry.level + 1);
    const r = osRect(b.getBoundingClientRect());
    stack.push(sub);
    place(sub.el, r.right - 2, r.top - 5, { flipFrom: r.left + 2 });
    return sub;
  }
  function activate(entry, idx) {
    const { it } = entry.btns[idx] || {};
    if (!it || it.disabled) return;
    if (it.submenu) { const s = openSub(entry, idx); setHL(s, 0); return; }
    close();
    try { it.action?.(); } catch (e) { console.error(e); }
  }
  function closeFrom(level) { while (stack.length > level) { const e = stack.pop(); clearTimeout(e.subTimer); e.el.remove(); } }
  function close() {
    if (!stack.length) return;
    closeFrom(0);
    document.removeEventListener('pointerdown', outside, true);
    const cb = onCloseCb; onCloseCb = null; cb?.();
  }
  function outside(e) { if (!e.target.closest('.menu')) close(); }
  bus.on('wm-opened', () => close());
  return {
    get isOpen() { return stack.length > 0; },
    show(items, clientX, clientY, opts = {}) {
      close();
      const entry = build(items, 0);
      stack.push(entry);
      if (opts.anchorEl) { place(entry.el, 0, 0, { ...opts, anchor: osRect(opts.anchorEl.getBoundingClientRect()) }); }
      else { const [x, y] = osPoint(clientX, clientY); place(entry.el, x, y, opts); }
      onCloseCb = opts.onClose || null;
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
      if (opts.keyboard) setHL(entry, entry.btns.findIndex((x) => !x.it.disabled));
    },
    close,
    key(e) {
      const entry = stack[stack.length - 1]; if (!entry) return false;
      const ae = document.activeElement;
      if (ae && !ae.closest('.menu') && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        // the person is typing somewhere else: the menu should not swallow keys
        close(); return false;
      }
      const enabled = entry.btns.map((x, i) => (x.it.disabled ? -1 : i)).filter((i) => i >= 0);
      if (e.key === 'Escape') { if (stack.length > 1) closeFrom(stack.length - 1); else close(); return true; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!enabled.length) return true;
        const pos = enabled.indexOf(entry.hl);
        const next = e.key === 'ArrowDown' ? enabled[(pos + 1) % enabled.length] : enabled[(pos - 1 + enabled.length) % enabled.length];
        setHL(entry, next); entry.btns[next].b.focus({ preventScroll: true }); return true;
      }
      if (e.key === 'ArrowRight') { const x = entry.btns[entry.hl]; if (x?.it.submenu) { const s = openSub(entry, entry.hl); setHL(s, 0); } return true; }
      if (e.key === 'ArrowLeft') { if (stack.length > 1) closeFrom(stack.length - 1); return true; }
      if (e.key === 'Enter' || e.key === ' ') { if (entry.hl >= 0) activate(entry, entry.hl); return true; }
      return false;
    },
  };
})();

/* ========== Tooltips ========== */
const Tip = (() => {
  let t = 0, cur = null;
  function hide() { clearTimeout(t); cur = null; const el = document.getElementById('tip'); el.classList.remove('show'); }
  function show(target) {
    const el = document.getElementById('tip'); const text = target.getAttribute('data-tip'); if (!text) return;
    el.textContent = text;
    const os = document.getElementById('os').getBoundingClientRect(); const r = target.getBoundingClientRect();
    el.style.left = '0px'; el.style.top = '0px';
    const w = el.offsetWidth, hh = el.offsetHeight;
    const inBar = !!target.closest('#taskbar');
    const above = inBar ? S.data.tbPos !== 'top' : false;
    let top = above ? r.top - os.top - hh - 10 : r.bottom - os.top + 8;
    if (top + hh > os.height - 4) top = r.top - os.top - hh - 8;
    el.style.left = clamp(r.left - os.left + r.width / 2 - w / 2, 6, os.width - w - 6) + 'px';
    el.style.top = Math.max(4, top) + 'px';
    el.classList.add('show');
  }
  document.addEventListener('pointerover', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target === cur) return;
    hide();
    if (!target || e.pointerType === 'touch') return;
    cur = target; t = setTimeout(() => { if (cur === target && document.contains(target)) show(target); }, 520);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('wheel', hide, { passive: true, capture: true });
  return { hide };
})();

/* ========== Dialogs (the frame refuses alert/confirm/prompt) ========== */
const Dialog = {
  show({ title, message, content, buttons = [{ label: 'OK', value: true, primary: true }], within, cancelValue = null, wide = false, onOpen }) {
    return new Promise((resolve) => {
      const host = within ? within.body : document.getElementById('os');
      const scrim = h('div', { class: 'modal-scrim' });
      const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
      const body = h('div', { class: 'modal-body' }, title ? h('h2', { text: title }) : null, message ? h('p', { text: message }) : null, content || null);
      const foot = h('div', { class: 'modal-foot' });
      let done = false;
      const finish = (v) => { if (done) return; done = true; scrim.remove(); resolve(v); };
      const val = (b) => (typeof b.value === 'function' ? b.value() : b.value);
      for (const b of buttons) {
        const btn = h('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), text: b.label });
        btn.addEventListener('click', () => { const v = val(b); if (v === undefined) return; finish(v); });
        foot.append(btn);
      }
      box.append(body, foot); scrim.append(box); host.append(scrim);
      scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) e.stopPropagation(); });
      box.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); finish(cancelValue); }
        else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
          const p = buttons.find((b) => b.primary); if (!p) return;
          e.preventDefault(); const v = val(p); if (v !== undefined) finish(v);
        }
      });
      onOpen?.(box, finish);
      requestAnimationFrame(() => {
        const inp = box.querySelector('input:not([type=checkbox]):not([type=file]), textarea');
        const target = inp || foot.querySelector('.primary') || foot.querySelector('button');
        target?.focus();
        if (inp && inp.select && inp.dataset.noselect == null) inp.select();
      });
    });
  },
  confirm(title, message, { ok = 'OK', cancel = 'Cancel', danger = false, within } = {}) {
    return this.show({ title, message, within, cancelValue: false, buttons: [{ label: ok, value: true, primary: true, danger }, { label: cancel, value: false }] });
  },
  prompt(title, { label, value = '', placeholder = '', ok = 'OK', within, message } = {}) {
    const id = 'dlg-' + uid();
    const inp = h('input', { class: 'field', id, value, placeholder, 'aria-label': label || title, style: 'width:100%' });
    const content = h('div', { class: 'dlg-field' }, label ? h('label', { for: id, text: label }) : null, inp);
    return this.show({ title, message, content, within, cancelValue: null, buttons: [{ label: ok, primary: true, value: () => inp.value }, { label: 'Cancel', value: null }] });
  },
  alert(title, message, within) { return this.show({ title, message, within }); },
  properties(id, within) {
    const n = FS.get(id); if (!n) return;
    const dl = h('dl', { class: 'props' });
    const add = (k, v) => dl.append(h('dt', { text: k }), h('dd', { text: v }));
    add('Name', n.name); add('Type', FS.typeLabel(n));
    add('Location', n.parent === 'trash' ? 'Recycle Bin (from ' + (FS.get(n.trashedFrom)?.name || 'Documents') + ')' : FS.pathOf(n.parent) === '/' ? 'This PC' : FS.pathOf(n.parent));
    if (n.type === 'folder') { const d = FS.descendants(id); add('Contains', `${d.filter((x) => x.type === 'file').length} files, ${d.filter((x) => x.type === 'folder').length} folders`); add('Size', fmtBytes(d.reduce((s, x) => s + (x.type === 'file' ? (FS.contents[x.id] || '').length : 0), 0))); }
    else add('Size', fmtBytes((FS.contents[id] || '').length));
    add('Created', fmtDate(n.created)); add('Modified', fmtDate(n.modified));
    if (n.trashedAt) add('Deleted', fmtDate(n.trashedAt));
    return this.show({ title: n.name + ' properties', content: dl, within });
  },
};

/* ========== File open/save dialog ========== */
Dialog.file = function ({ mode = 'save', kind = 'text', folder = 'documents', name = 'Untitled.txt', within, title } = {}) {
  let cur = FS.isFolder(folder) && !FS.inTrash(folder) ? folder : 'documents';
  let selId = null;
  const id = 'fd-' + uid();
  const wrap = h('div', { class: 'fd' });
  const path = h('div', { class: 'fd-path' });
  const up = h('button', { class: 'ibtn', 'aria-label': 'Up one level', html: ui('arrowUp') });
  const pathText = h('div', { class: 'p' });
  const newF = h('button', { class: 'ibtn', 'aria-label': 'New folder', 'data-tip': 'New folder', html: ui('plus') });
  path.append(up, pathText, newF);
  const places = h('nav', { class: 'fd-places', 'aria-label': 'Places' });
  const list = h('div', { class: 'fd-list', role: 'listbox', 'aria-label': 'Folder contents' });
  const nameRow = h('div', { class: 'fd-name' });
  const inp = h('input', { class: 'field', id, value: name, 'aria-label': 'File name' });
  inp.dataset.noselect = '';
  nameRow.append(h('label', { for: id, text: 'File name' }), inp);
  wrap.append(path, places, list);
  if (mode === 'save') wrap.append(nameRow);
  const PLACES = [['desktop', 'folderDesktop'], ['documents', 'folderDocs'], ['pictures', 'folderPics'], ['downloads', 'folderDl']];
  let finishRef = null;
  function render() {
    pathText.textContent = FS.crumbs(cur).map((n) => n.name).join('  ›  ');
    up.disabled = cur === 'root';
    places.innerHTML = '';
    for (const [pid, ic] of PLACES) {
      const b = h('button', { 'aria-current': String(cur === pid), html: appIcon(ic) + `<span>${esc(FS.get(pid).name)}</span>` });
      b.onclick = () => { cur = pid; selId = null; render(); };
      places.append(b);
    }
    list.innerHTML = '';
    const items = FS.children(cur).filter((n) => n.type === 'folder' || n.kind === kind || (kind === 'text' && n.kind !== 'image'));
    if (!items.length) list.append(h('div', { class: 'fd-empty', text: 'Nothing here yet.' }));
    for (const n of items) {
      const b = h('button', { class: 'fd-item' + (n.id === selId ? ' sel' : ''), role: 'option', 'aria-selected': String(n.id === selId) });
      b.innerHTML = nodeIconHTML(n, true) + `<span class="n">${esc(n.name)}</span><span class="m">${n.type === 'folder' ? 'Folder' : fmtBytes(n.size || 0)}</span>`;
      b.onclick = () => { if (n.type === 'folder') { cur = n.id; selId = null; render(); } else { selId = n.id; if (mode === 'save') inp.value = n.name; render(); } };
      b.ondblclick = () => { if (n.type === 'file') { selId = n.id; if (mode === 'save') inp.value = n.name; confirmPick(); } };
      list.append(b);
    }
  }
  up.onclick = () => { const p = FS.get(cur)?.parent; if (p) { cur = p; selId = null; render(); } };
  newF.onclick = async () => {
    const nm = await Dialog.prompt('New folder', { label: 'Folder name', value: 'New folder', ok: 'Create', within });
    if (nm && nm.trim()) { const f = FS.create(cur, nm, 'folder'); cur = f.id; render(); }
  };
  async function confirmPick() {
    if (mode === 'open') { if (!selId) return undefined; finishRef?.({ id: selId, folder: cur, name: FS.get(selId).name }); return; }
    let nm = FS.clean(inp.value); if (!nm) { inp.focus(); return; }
    if (kind === 'text' && !/\.[a-z0-9]{1,8}$/i.test(nm)) nm += '.txt';
    if (kind === 'image' && !/\.(png|jpe?g|webp|gif)$/i.test(nm)) nm += '.png';
    const existing = FS.children(cur).find((x) => x.type === 'file' && x.name.toLowerCase() === nm.toLowerCase());
    if (existing) {
      const ok = await Dialog.confirm('Replace file?', `${existing.name} already exists. Do you want to replace it?`, { ok: 'Replace', within });
      if (!ok) return;
      finishRef?.({ id: existing.id, folder: cur, name: existing.name }); return;
    }
    finishRef?.({ id: null, folder: cur, name: nm });
  }
  render();
  return Dialog.show({
    title: title || (mode === 'save' ? 'Save as' : 'Open'), content: wrap, within, wide: true, cancelValue: null,
    buttons: [{ label: mode === 'save' ? 'Save' : 'Open', primary: true, value: () => { confirmPick(); return undefined; } }, { label: 'Cancel', value: null }],
    onOpen: (box, finish) => { finishRef = finish; requestAnimationFrame(() => { if (mode === 'save') { inp.focus(); const dot = inp.value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length); } }); },
  });
};

/* ========== Notifications ========== */
const Notif = {
  items: [], unread: 0,
  push({ app = 'settings', title, body = '', action = null, actions = null, silent = false }) {
    const n = { id: uid(), app, title, body, action, time: Date.now() };
    this.items.unshift(n);
    if (this.items.length > 40) this.items.pop();
    this.unread++;
    if (!S.data.dnd) { this.toast(n, actions); if (!silent) Sound.play('notify'); }
    bus.emit('notif');
    return n;
  },
  remove(id) { this.items = this.items.filter((x) => x.id !== id); bus.emit('notif'); },
  clear() { this.items = []; this.unread = 0; bus.emit('notif'); },
  seen() { if (this.unread) { this.unread = 0; bus.emit('notif'); } },
  toast(n, actions) {
    const box = document.getElementById('toasts');
    const el = h('div', { class: 'toast acrylic', role: 'status' });
    el.innerHTML = `<span class="ic">${appIcon(APPS[n.app]?.icon || 'logo')}</span><div class="ttl">${esc(n.title)}</div>${n.body ? `<div class="bd">${esc(n.body)}</div>` : ''}`;
    const x = h('button', { class: 'ibtn x', 'aria-label': 'Dismiss', html: ui('x') });
    el.append(x);
    if (actions && actions.length) {
      const row = h('div', { class: 'acts' });
      for (const a of actions) row.append(h('button', { class: 'btn sm' + (a.primary ? ' primary' : ''), text: a.label, onclick: (e) => { e.stopPropagation(); a.run(); dismiss(); } }));
      el.append(row);
    }
    let t = 0; let gone = false;
    const dismiss = () => { if (gone) return; gone = true; clearTimeout(t); el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    const arm = () => { clearTimeout(t); t = setTimeout(dismiss, 6000); };
    el.addEventListener('pointerenter', () => clearTimeout(t));
    el.addEventListener('pointerleave', arm);
    x.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });
    el.addEventListener('click', () => { if (n.action) { try { n.action(); } catch (e) { console.error(e); } } dismiss(); });
    box.append(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    arm();
  },
};

/* ========== Shared helpers for files ========== */
const Clip = {
  ids: [], mode: 'copy',
  set(ids, mode) { this.ids = ids.filter((id) => FS.get(id) && !FS.isSpecial(id)); this.mode = mode; bus.emit('clip'); },
  has() { return this.ids.some((id) => FS.get(id)); },
  paste(dest) {
    if (!FS.isFolder(dest) || dest === 'trash' || dest === 'root') return [];
    const out = [];
    for (const id of this.ids) {
      if (!FS.get(id)) continue;
      if (this.mode === 'cut') { if (FS.move(id, dest)) out.push(id); }
      else { const c = FS.copy(id, dest); if (c) out.push(c.id); }
    }
    if (this.mode === 'cut') { this.ids = []; bus.emit('clip'); }
    return out;
  },
};
function nodeIconName(n) {
  if (!n) return 'fileText';
  if (n.type === 'folder') return ({ root: 'pc', desktop: 'folderDesktop', documents: 'folderDocs', pictures: 'folderPics', downloads: 'folderDl', trash: FS.children('trash').length ? 'trashFull' : 'trash' })[n.id] || 'folder';
  return n.kind === 'image' ? 'fileImage' : 'fileText';
}
function nodeIconHTML(n, thumb = true) {
  if (thumb && n && n.kind === 'image') { const d = FS.read(n.id); if (d.startsWith('data:image')) return `<img src="${d}" alt="" loading="lazy" decoding="async">`; }
  return appIcon(nodeIconName(n));
}
function openNode(id) {
  const n = FS.get(id); if (!n) return;
  if (n.type === 'folder') { WM.open('files', { folder: id }); return; }
  FS.touchRecent(id);
  if (n.kind === 'image') WM.open('photos', { file: id });
  else WM.open('notes', { file: id });
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
function dataURLToBlob(url) {
  const [head, b64] = url.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
const DL_EXT = /\.(gif|png|jpg|jpeg|webp|txt|json|md|csv|html|svg)$/i;
async function offerDownload(filename, data) {
  const d = caps.downloads;
  if (!d) { Notif.push({ app: 'files', title: 'Downloads are not available here', body: 'Open this OS in Claude to save files to your computer.' }); return false; }
  if (!DL_EXT.test(filename)) filename += '.txt';
  try { await d.save({ filename, data }); return true; }
  catch (e) {
    if (e?.code === 'declined') return false;
    Notif.push({ app: 'files', title: 'Could not download ' + filename, body: e?.code === 'rate_limited' ? 'Another download is waiting for your answer. Try again in a moment.' : 'This view cannot save files to your computer.' });
    return false;
  }
}
async function downloadNode(id) {
  const n = FS.get(id); if (!n || n.type !== 'file') return;
  const data = FS.read(id);
  if (n.kind === 'image' && data.startsWith('data:image')) {
    const blob = dataURLToBlob(data);
    let name = n.name; const ext = blob.type.includes('png') ? '.png' : blob.type.includes('jpeg') ? '.jpg' : blob.type.includes('webp') ? '.webp' : '.png';
    if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) name += ext;
    return offerDownload(name, blob);
  }
  return offerDownload(n.name, data);
}
/* Import files dropped or picked from the viewer's computer */
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|html?|css|js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|h|xml|yml|yaml|toml|ini|log|sh|sql|svg)$/i;
async function importFiles(files, dest) {
  if (!FS.isFolder(dest) || dest === 'trash' || dest === 'root') dest = 'downloads';
  const made = [];
  for (const f of Array.from(files || [])) {
    try {
      if (/^image\//.test(f.type) && !/svg/.test(f.type)) {
        const url = await fileToImageURL(f);
        made.push(FS.create(dest, f.name, 'file', url, 'image'));
      } else if (/^text\//.test(f.type) || TEXT_EXT.test(f.name) || f.type === 'application/json') {
        if (f.size > 2_000_000) throw new Error('Text files over 2 MB are too large to import.');
        const text = await f.text();
        made.push(FS.create(dest, f.name, 'file', text, 'text'));
      } else throw new Error('Only text and image files can be imported.');
    } catch (e) {
      Notif.push({ app: 'files', title: `Could not import ${f.name}`, body: e.message || 'Try a different file.' });
    }
  }
  if (made.length) Notif.push({ app: 'files', title: made.length === 1 ? `Imported ${made[0].name}` : `Imported ${made.length} files`, body: 'Saved to ' + FS.get(dest).name + '.', action: () => WM.open('files', { folder: dest }), silent: true });
  return made;
}
function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: 'position:fixed;left:-9999px' });
    if (multiple) inp.multiple = true;
    inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
