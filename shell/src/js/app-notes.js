/* ========== Notes ========== */
function mountNotes(root, api, args) {
  const st = { id: null, dirty: false, wrap: true, mono: false, zoom: 100, statusBar: true, lastFind: '' };
  root.classList.add('app-notes');
  root.innerHTML = `
    <div class="nt-menu" role="menubar">
      <button class="mbtn" data-m="file" role="menuitem">File</button>
      <button class="mbtn" data-m="edit" role="menuitem">Edit</button>
      <button class="mbtn" data-m="view" role="menuitem">View</button>
      <span class="grow"></span>
      <button class="ibtn" data-act="save" aria-label="Save" data-tip="Save (Ctrl+S)">${ui('save')}</button>
    </div>
    <div class="nt-find" hidden>
      <input type="search" id="${api.id}-find" class="field" placeholder="Find" aria-label="Find text">
      <button class="ibtn" data-act="prev" aria-label="Previous match">${ui('chevU')}</button>
      <button class="ibtn" data-act="next" aria-label="Next match">${ui('chevD')}</button>
      <span class="nt-findinfo muted"></span><span class="grow"></span>
      <button class="ibtn" data-act="closefind" aria-label="Close find">${ui('x')}</button>
    </div>
    <textarea class="nt-text selectable" id="${api.id}-text" spellcheck="true" aria-label="Document text" placeholder="Start typing"></textarea>
    <div class="nt-status"><span class="nt-pos"></span><span class="nt-count"></span><span class="grow"></span><span class="nt-zoom"></span><span>UTF-8</span></div>`;
  const ta = root.querySelector('.nt-text'), findBar = root.querySelector('.nt-find'), findInp = findBar.querySelector('input');
  const name = () => (st.id && FS.get(st.id) ? FS.get(st.id).name : 'Untitled');
  function updTitle() { api.setTitle((st.dirty ? '• ' : '') + name() + ' – Notes'); api.setDirty(st.dirty); }
  function updStatus() {
    const v = ta.value, pos = ta.selectionStart || 0, before = v.slice(0, pos);
    const line = before.split('\n').length, col = pos - before.lastIndexOf('\n');
    const words = (v.match(/\S+/g) || []).length;
    root.querySelector('.nt-pos').textContent = `Ln ${line}, Col ${col}`;
    root.querySelector('.nt-count').textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${v.length.toLocaleString()} characters`;
    root.querySelector('.nt-zoom').textContent = st.zoom + '%';
  }
  function applyView() {
    ta.style.whiteSpace = st.wrap ? 'pre-wrap' : 'pre';
    ta.style.overflowX = st.wrap ? 'hidden' : 'auto';
    ta.style.fontFamily = st.mono ? 'var(--font-mono)' : 'var(--font-ui)';
    ta.style.fontSize = (15 * st.zoom / 100).toFixed(1) + 'px';
    root.querySelector('.nt-status').hidden = !st.statusBar;
    updStatus();
  }
  function load(id) {
    const n = FS.get(id); if (!n || n.type !== 'file') return;
    st.id = id; ta.value = FS.read(id); st.dirty = false;
    ta.scrollTop = 0; ta.setSelectionRange(0, 0);
    updTitle(); updStatus();
  }
  async function confirmDiscard() {
    if (!st.dirty) return true;
    const v = await Dialog.show({ title: 'Notes', message: `Do you want to save changes to ${name()}?`, within: api.win, cancelValue: 'cancel',
      buttons: [{ label: 'Save', value: 'save', primary: true }, { label: "Don't save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }] });
    if (v === 'save') return save(false);
    return v === 'discard';
  }
  async function save(as) {
    const n = st.id && FS.get(st.id);
    if (!as && n && !FS.inTrash(st.id)) { FS.write(st.id, ta.value); st.dirty = false; updTitle(); return true; }
    const r = await Dialog.file({ mode: 'save', kind: 'text', folder: n && !FS.inTrash(st.id) ? n.parent : 'documents', name: n ? n.name : (firstLineName() || 'Untitled') + '.txt', within: api.win });
    if (!r) return false;
    if (r.id) { FS.write(r.id, ta.value); st.id = r.id; }
    else { const made = FS.create(r.folder, r.name, 'file', ta.value, 'text'); st.id = made.id; }
    st.dirty = false; updTitle(); FS.touchRecent(st.id);
    Notif.push({ app: 'notes', title: 'Saved ' + name(), body: 'In ' + FS.parentName(st.id) + '.', silent: true, action: () => WM.open('files', { folder: FS.get(st.id)?.parent, select: st.id }) });
    return true;
  }
  function firstLineName() { const l = ta.value.split('\n').find((x) => x.trim()); return l ? FS.clean(l).slice(0, 40) : ''; }
  async function openPick() {
    if (!(await confirmDiscard())) return;
    const r = await Dialog.file({ mode: 'open', kind: 'text', folder: st.id ? FS.get(st.id)?.parent : 'documents', within: api.win });
    if (r?.id) { load(r.id); FS.touchRecent(r.id); }
  }
  async function newDoc() { if (!(await confirmDiscard())) return; st.id = null; ta.value = ''; st.dirty = false; updTitle(); updStatus(); ta.focus(); }
  async function importDoc() {
    const files = await pickFiles('.txt,.md,.csv,.json,.html,.css,.js,.log,.xml,.yml,.yaml,text/*', false);
    if (!files.length) return;
    if (!(await confirmDiscard())) return;
    const made = await importFiles(files, 'documents');
    if (made[0]) load(made[0].id);
  }
  function find(dir = 1) {
    const q = findInp.value; const info = findBar.querySelector('.nt-findinfo');
    if (!q) { info.textContent = ''; return; }
    const hay = ta.value.toLowerCase(), needle = q.toLowerCase();
    const matches = []; let i = -1; while ((i = hay.indexOf(needle, i + 1)) !== -1) matches.push(i);
    if (!matches.length) { info.textContent = 'No matches'; return; }
    const from = dir > 0 ? (ta.selectionEnd || 0) : (ta.selectionStart || 0) - 1;
    let idx = dir > 0 ? matches.findIndex((m) => m >= from) : [...matches].reverse().findIndex((m) => m <= from);
    if (dir < 0 && idx >= 0) idx = matches.length - 1 - idx;
    if (idx < 0) idx = dir > 0 ? 0 : matches.length - 1;
    const at = matches[idx];
    ta.focus(); ta.setSelectionRange(at, at + q.length);
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    ta.scrollTop = Math.max(0, ta.value.slice(0, at).split('\n').length * lineH - ta.clientHeight / 2);
    info.textContent = `${idx + 1} of ${matches.length}`;
    updStatus();
  }
  function showFind() { findBar.hidden = false; const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd); if (sel && !sel.includes('\n')) findInp.value = sel; findInp.focus(); findInp.select(); }
  function insertText(t) { ta.focus(); const s = ta.selectionStart, e = ta.selectionEnd; ta.setRangeText(t, s, e, 'end'); onInput(); }
  function onInput() { if (!st.dirty) { st.dirty = true; updTitle(); } updStatus(); }
  const MENUS = {
    file: () => [
      { label: 'New', icon: 'doc', action: newDoc },
      { label: 'New window', icon: 'plus', action: () => WM.open('notes') },
      { label: 'Open…', icon: 'folderOpen', kb: 'Ctrl+O', action: openPick },
      { label: 'Save', icon: 'save', kb: 'Ctrl+S', action: () => save(false) },
      { label: 'Save as…', icon: 'save', kb: 'Ctrl+Shift+S', action: () => save(true) },
      'sep',
      { label: 'Import from this computer…', icon: 'upload', action: importDoc },
      caps.downloads ? { label: 'Download to this computer', icon: 'download', action: () => offerDownload(st.id ? name() : (firstLineName() || 'Untitled') + '.txt', ta.value) } : null,
      { label: 'Copy all text', icon: 'copy', action: async () => { const ok = await copyText(ta.value); Notif.push({ app: 'notes', title: ok ? 'Text copied' : 'Could not copy', body: ok ? 'Paste it anywhere.' : 'Select the text and press Ctrl+C instead.', silent: true }); } },
      'sep',
      { label: 'Close window', icon: 'x', action: () => api.close() },
    ],
    edit: () => [
      { label: 'Undo', icon: 'undo', kb: 'Ctrl+Z', action: () => { ta.focus(); document.execCommand('undo'); } },
      { label: 'Redo', icon: 'redo', kb: 'Ctrl+Y', action: () => { ta.focus(); document.execCommand('redo'); } },
      'sep',
      { label: 'Find…', icon: 'search', kb: 'Ctrl+F', action: showFind },
      { label: 'Select all', icon: 'check', kb: 'Ctrl+A', action: () => { ta.focus(); ta.select(); } },
      { label: 'Insert time and date', icon: 'clock', kb: 'F5', action: () => insertText(fmtDT(Date.now(), { dateStyle: 'medium', timeStyle: 'short' })) },
    ],
    view: () => [
      { label: 'Word wrap', checked: st.wrap, action: () => { st.wrap = !st.wrap; applyView(); } },
      { label: 'Monospace font', checked: st.mono, action: () => { st.mono = !st.mono; applyView(); } },
      { label: 'Status bar', checked: st.statusBar, action: () => { st.statusBar = !st.statusBar; applyView(); } },
      'sep',
      { label: 'Zoom in', icon: 'zoomIn', kb: 'Ctrl++', action: () => { st.zoom = clamp(st.zoom + 10, 50, 300); applyView(); } },
      { label: 'Zoom out', icon: 'zoomOut', kb: 'Ctrl+-', action: () => { st.zoom = clamp(st.zoom - 10, 50, 300); applyView(); } },
      { label: 'Reset zoom', icon: 'fit', kb: 'Ctrl+0', action: () => { st.zoom = 100; applyView(); } },
    ],
  };
  root.querySelector('.nt-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (b) { b.classList.add('on'); Menu.show(MENUS[b.dataset.m](), 0, 0, { anchorEl: b, onClose: () => b.classList.remove('on') }); return; }
    if (e.target.closest('[data-act="save"]')) save(false);
  });
  findBar.addEventListener('click', (e) => { const a = e.target.closest('[data-act]')?.dataset.act; if (a === 'next') find(1); else if (a === 'prev') find(-1); else if (a === 'closefind') { findBar.hidden = true; ta.focus(); } });
  findInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.stopPropagation(); findBar.hidden = true; ta.focus(); } });
  ta.addEventListener('input', onInput);
  ['keyup', 'click', 'select', 'focus'].forEach((t) => ta.addEventListener(t, updStatus));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { e.preventDefault(); insertText('\t'); }
  });
  root.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (mod && k === 'o') { e.preventDefault(); openPick(); }
    else if (mod && k === 'f') { e.preventDefault(); showFind(); }
    else if (mod && (k === '=' || k === '+')) { e.preventDefault(); st.zoom = clamp(st.zoom + 10, 50, 300); applyView(); }
    else if (mod && k === '-') { e.preventDefault(); st.zoom = clamp(st.zoom - 10, 50, 300); applyView(); }
    else if (mod && k === '0') { e.preventDefault(); st.zoom = 100; applyView(); }
    else if (e.key === 'F5') { e.preventDefault(); insertText(fmtDT(Date.now(), { dateStyle: 'medium', timeStyle: 'short' })); }
  });
  ta.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); st.zoom = clamp(st.zoom + (e.deltaY < 0 ? 10 : -10), 50, 300); applyView(); } }, { passive: false });
  api.beforeClose(confirmDiscard);
  api.on('fs', () => {
    if (!st.id) return;
    const n = FS.get(st.id);
    if (!n) { st.id = null; st.dirty = true; updTitle(); return; }
    if (!st.dirty && FS.read(st.id) !== ta.value) { const p = ta.selectionStart; ta.value = FS.read(st.id); ta.setSelectionRange(Math.min(p, ta.value.length), Math.min(p, ta.value.length)); updStatus(); }
    updTitle();
  });
  if (args.file && FS.get(args.file)) load(args.file);
  else if (args.text) { ta.value = args.text; st.dirty = true; }
  updTitle(); applyView();
  requestAnimationFrame(() => ta.focus({ preventScroll: true }));
}
