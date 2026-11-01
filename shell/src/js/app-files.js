/* ========== Files ========== */
function mountFiles(root, api, args) {
  const st = { cur: FS.get(args.folder) ? args.folder : 'home', back: [], fwd: [], sel: new Set(), last: null, q: '', view: S.data.filesView || 'grid', sort: 'name', dir: 1 };
  root.classList.add('app-files');
  root.innerHTML = `
    <div class="fx-bar">
      <button class="ibtn" data-act="back" aria-label="Back" data-tip="Back">${ui('arrowL')}</button>
      <button class="ibtn" data-act="fwd" aria-label="Forward" data-tip="Forward">${ui('arrowR')}</button>
      <button class="ibtn" data-act="up" aria-label="Up one level" data-tip="Up one level">${ui('arrowUp')}</button>
      <div class="fx-crumbs" role="navigation" aria-label="Location"></div>
      <label class="fx-search">${ui('search')}<input type="search" id="${api.id}-q" placeholder="Search" aria-label="Search in this folder"></label>
    </div>
    <div class="fx-cmd" role="toolbar" aria-label="Commands">
      <button class="cbtn" data-act="new">${ui('plus')}<span>New</span>${ui('chevD')}</button>
      <span class="vsep"></span>
      <button class="ibtn" data-act="cut" aria-label="Cut" data-tip="Cut">${ui('cut')}</button>
      <button class="ibtn" data-act="copy" aria-label="Copy" data-tip="Copy">${ui('copy')}</button>
      <button class="ibtn" data-act="paste" aria-label="Paste" data-tip="Paste">${ui('paste')}</button>
      <button class="ibtn" data-act="rename" aria-label="Rename" data-tip="Rename">${ui('pencil')}</button>
      <button class="ibtn" data-act="delete" aria-label="Delete" data-tip="Delete">${ui('trash')}</button>
      <span class="vsep"></span>
      <button class="cbtn" data-act="sort">${ui('sort')}<span>Sort</span>${ui('chevD')}</button>
      <button class="cbtn" data-act="view">${ui('grid')}<span>View</span>${ui('chevD')}</button>
      <span class="grow"></span>
      <button class="cbtn" data-act="restore" hidden>${ui('restart')}<span>Restore</span></button>
      <button class="cbtn" data-act="empty" hidden>${ui('trash')}<span>Empty Recycle Bin</span></button>
      <button class="cbtn" data-act="import">${ui('upload')}<span>Import</span></button>
    </div>
    <div class="fx-main">
      <nav class="fx-side" aria-label="Places"></nav>
      <div class="fx-content" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="Items"></div>
    </div>
    <div class="fx-status"><span class="fx-count"></span><span class="grow"></span><span class="fx-sync"></span></div>`;
  const side = root.querySelector('.fx-side'), content = root.querySelector('.fx-content'), crumbs = root.querySelector('.fx-crumbs');
  const qInp = root.querySelector('.fx-search input');
  const isFolderView = () => st.cur !== 'home' && FS.isFolder(st.cur);
  const canWrite = () => isFolderView() && st.cur !== 'trash' && st.cur !== 'root';

  function go(id, push = true) {
    if (id !== 'home' && !FS.isFolder(id)) id = 'home';
    if (push && id !== st.cur) { st.back.push(st.cur); st.fwd = []; }
    st.cur = id; st.sel.clear(); st.q = ''; qInp.value = ''; render();
  }
  function items() {
    if (!isFolderView()) return [];
    let list = st.q ? FS.descendants(st.cur).filter((n) => n.name.toLowerCase().includes(st.q.toLowerCase())) : FS.children(st.cur);
    if (st.cur === 'root') list = list.concat([FS.get('trash')]);
    const key = st.sort, d = st.dir;
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      let r = 0;
      if (key === 'modified') r = (a.modified || 0) - (b.modified || 0);
      else if (key === 'size') r = (a.size || 0) - (b.size || 0);
      else if (key === 'type') r = FS.typeLabel(a).localeCompare(FS.typeLabel(b));
      if (!r) r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return r * d;
    });
    return list;
  }
  function title() {
    if (st.cur === 'home') return 'Home';
    return FS.get(st.cur)?.name || 'Files';
  }
  function renderSide() {
    const places = [['home', 'home', 'Home', true], 'sep', ['desktop', 'folderDesktop'], ['documents', 'folderDocs'], ['pictures', 'folderPics'], ['downloads', 'folderDl'], 'sep', ['root', 'pc'], ['trash', null]];
    side.innerHTML = '';
    for (const p of places) {
      if (p === 'sep') { side.append(h('div', { class: 'fx-sep' })); continue; }
      const [id, icon, label, isUi] = p;
      const n = FS.get(id);
      const ic = isUi ? ui(icon) : appIcon(icon || nodeIconName(n));
      const b = h('button', { class: 'fx-place' + (st.cur === id ? ' on' : ''), 'data-drop': id === 'home' ? '' : id, 'aria-current': st.cur === id ? 'page' : null, html: `<span class="ic${isUi ? ' ui' : ''}">${ic}</span><span>${esc(label || n?.name || id)}</span>` });
      b.addEventListener('click', () => go(id));
      side.append(b);
    }
  }
  function renderCrumbs() {
    crumbs.innerHTML = '';
    const parts = st.cur === 'home' ? [{ id: 'home', name: 'Home' }] : FS.crumbs(st.cur).map((n) => ({ id: n.id, name: n.name }));
    parts.forEach((p, i) => {
      if (i) crumbs.append(h('span', { class: 'sep', html: ui('chevR') }));
      const b = h('button', { class: 'crumb', text: p.name });
      b.addEventListener('click', () => go(p.id));
      crumbs.append(b);
    });
    if (st.q) crumbs.append(h('span', { class: 'sep', html: ui('chevR') }), h('span', { class: 'crumb static', text: `Search results for “${st.q}”` }));
  }
  function iconFor(n) { return nodeIconHTML(n, true); }
  function renderHome() {
    const wrap = h('div', { class: 'fx-home' });
    wrap.append(h('h3', { text: 'Quick access' }));
    const qa = h('div', { class: 'fx-grid' });
    for (const id of ['desktop', 'documents', 'pictures', 'downloads']) qa.append(itemEl(FS.get(id)));
    wrap.append(qa, h('h3', { text: 'Recent files' }));
    const rec = (S.data.recent || []).map((id) => FS.get(id)).filter((n) => n && !FS.inTrash(n.id));
    if (!rec.length) wrap.append(h('div', { class: 'fx-empty-inline', text: 'Files you open will show up here.' }));
    else { const list = h('div', { class: 'fx-list' }); rec.forEach((n) => list.append(rowEl(n, true))); wrap.append(list); }
    content.append(wrap);
  }
  function itemEl(n) {
    const b = h('div', { class: 'fx-item' + (st.sel.has(n.id) ? ' sel' : '') + (Clip.mode === 'cut' && Clip.ids.includes(n.id) ? ' cut' : ''), 'data-id': n.id, role: 'option', 'aria-selected': String(st.sel.has(n.id)), tabindex: '-1', draggable: FS.isSpecial(n.id) ? 'false' : 'true' });
    if (n.type === 'folder') b.dataset.drop = n.id;
    b.innerHTML = `<span class="ic">${iconFor(n)}</span><span class="nm">${esc(n.name)}</span>`;
    return b;
  }
  function rowEl(n, home) {
    const b = h('div', { class: 'fx-row' + (st.sel.has(n.id) ? ' sel' : '') + (Clip.mode === 'cut' && Clip.ids.includes(n.id) ? ' cut' : ''), 'data-id': n.id, role: 'option', 'aria-selected': String(st.sel.has(n.id)), tabindex: '-1', draggable: FS.isSpecial(n.id) ? 'false' : 'true' });
    if (n.type === 'folder') b.dataset.drop = n.id;
    const trash = st.cur === 'trash';
    const third = home ? esc(FS.pathOf(n.parent)) : trash ? esc(FS.get(n.trashedFrom)?.name || 'Documents') : esc(FS.typeLabel(n));
    b.innerHTML = `<span class="c-name"><span class="ic">${iconFor(n)}</span><span class="nm">${esc(n.name)}</span></span><span class="c-date">${esc(fmtDate(trash ? n.trashedAt || n.modified : n.modified))}</span><span class="c-type">${third}</span><span class="c-size">${n.type === 'file' ? fmtBytes(n.size || 0) : ''}</span>`;
    return b;
  }
  function render() {
    root.dataset.folder = canWrite() ? st.cur : '';
    if (!canWrite()) delete root.dataset.folder;
    api.setTitle(title() + ' – Files');
    renderSide(); renderCrumbs();
    content.innerHTML = '';
    const trash = st.cur === 'trash';
    updateCmds();
    root.querySelector('[data-act="view"]').innerHTML = `${ui(st.view === 'grid' ? 'grid' : 'list')}<span>View</span>${ui('chevD')}`;
    if (st.cur === 'home') { renderHome(); status(); return; }
    const list = items();
    if (!list.length) {
      content.append(h('div', { class: 'fx-empty' }, h('div', { html: appIcon(trash ? 'trash' : 'folder') }), h('p', { text: st.q ? 'No items match your search.' : trash ? 'The Recycle Bin is empty.' : 'This folder is empty.' }), canWrite() && !st.q ? h('p', { class: 'muted', text: 'Drag files from your computer here, or use New.' }) : null));
    } else if (st.view === 'list' || trash) {
      const tbl = h('div', { class: 'fx-list' });
      const head = h('div', { class: 'fx-row head' });
      const cols = [['name', 'Name'], ['modified', trash ? 'Date deleted' : 'Date modified'], ['type', trash ? 'Original location' : 'Type'], ['size', 'Size']];
      for (const [k, label] of cols) { const b = h('button', { class: 'c-' + (k === 'modified' ? 'date' : k), html: esc(label) + (st.sort === k ? ui(st.dir > 0 ? 'chevU' : 'chevD') : '') }); b.addEventListener('click', () => { if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = 1; } render(); }); head.append(b); }
      tbl.append(head);
      list.forEach((n) => tbl.append(rowEl(n)));
      content.append(tbl);
    } else {
      const grid = h('div', { class: 'fx-grid' });
      list.forEach((n) => grid.append(itemEl(n)));
      content.append(grid);
    }
    status();
  }
  function status() {
    const list = items();
    const selN = [...st.sel].map((id) => FS.get(id)).filter(Boolean);
    const bytes = selN.reduce((s, n) => s + (n.type === 'file' ? n.size || 0 : 0), 0);
    root.querySelector('.fx-count').textContent = st.cur === 'home' ? '' : `${list.length} item${list.length === 1 ? '' : 's'}` + (selN.length ? `  ·  ${selN.length} selected${bytes ? '  ·  ' + fmtBytes(bytes) : ''}` : '');
    const c = Store.cloudLabel();
    root.querySelector('.fx-sync').innerHTML = `${ui(c.icon)}<span>${esc(c.title)}</span>`;
  }
  function updateCmds() {
    const trash = st.cur === 'trash';
    const q = (a) => root.querySelector(`[data-act="${a}"]`);
    q('back').disabled = !st.back.length;
    q('fwd').disabled = !st.fwd.length;
    q('up').disabled = st.cur === 'home' || !FS.get(st.cur)?.parent;
    q('restore').hidden = !trash; q('empty').hidden = !trash; q('import').hidden = trash;
    q('new').disabled = !canWrite();
    q('paste').disabled = !(canWrite() && Clip.has());
    const hasSel = [...st.sel].some((id) => !FS.isSpecial(id));
    for (const a of ['cut', 'copy', 'delete']) q(a).disabled = !hasSel || trash;
    q('rename').disabled = st.sel.size !== 1 || trash || FS.isSpecial([...st.sel][0]);
    q('restore').disabled = !st.sel.size;
  }
  function syncSel() {
    content.querySelectorAll('[data-id]').forEach((el) => { const on = st.sel.has(el.dataset.id); el.classList.toggle('sel', on); el.setAttribute('aria-selected', String(on)); });
    updateCmds(); status();
  }
  function orderIds() { return [...content.querySelectorAll('[data-id]')].map((el) => el.dataset.id); }
  function startRename(id) {
    const el = content.querySelector(`[data-id="${id}"]`); const n = FS.get(id);
    if (!el || !n || FS.isSpecial(id)) return;
    const nm = el.querySelector('.nm');
    const inp = h('input', { class: 'rename-input', value: n.name, 'aria-label': 'New name' });
    nm.replaceWith(inp); inp.focus();
    const dot = n.type === 'file' ? n.name.lastIndexOf('.') : -1; inp.setSelectionRange(0, dot > 0 ? dot : n.name.length);
    el.draggable = false;
    let done = false;
    const finish = (ok) => { if (done) return; done = true; if (ok && inp.value.trim() && inp.value.trim() !== n.name) FS.rename(id, inp.value); else render(); content.focus({ preventScroll: true }); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    ['pointerdown', 'dblclick', 'click'].forEach((t) => inp.addEventListener(t, (e) => e.stopPropagation()));
  }
  function newItem(type) {
    if (!canWrite()) return;
    const n = type === 'folder' ? FS.create(st.cur, 'New folder', 'folder') : FS.create(st.cur, 'New text document.txt', 'file', '', 'text');
    st.sel = new Set([n.id]); render(); startRename(n.id);
  }
  function open(id) {
    const n = FS.get(id); if (!n) return;
    if (n.type === 'folder') { go(id); return; }
    if (FS.inTrash(id)) { Dialog.alert('This file is in the Recycle Bin', 'Restore it first to open it.', api.win); return; }
    openNode(id);
  }
  async function doImport(files) {
    const made = await importFiles(files, canWrite() ? st.cur : 'downloads');
    if (made.length && canWrite()) { st.sel = new Set(made.map((m) => m.id)); render(); }
  }
  function cmd(act, btn) {
    const ids = [...st.sel];
    switch (act) {
      case 'back': if (st.back.length) { st.fwd.push(st.cur); go(st.back.pop(), false); } break;
      case 'fwd': if (st.fwd.length) { st.back.push(st.cur); go(st.fwd.pop(), false); } break;
      case 'up': { const p = FS.get(st.cur)?.parent; if (p) go(p); break; }
      case 'new': Menu.show([{ label: 'Folder', icon: 'folder', action: () => newItem('folder') }, { label: 'Text document', icon: 'doc', action: () => newItem('text') }], 0, 0, { anchorEl: btn }); break;
      case 'cut': Clip.set(ids, 'cut'); break;
      case 'copy': Clip.set(ids, 'copy'); break;
      case 'paste': if (canWrite()) { const out = Clip.paste(st.cur); st.sel = new Set(out); render(); } break;
      case 'rename': if (ids.length === 1) startRename(ids[0]); break;
      case 'delete': deleteNodes(ids, api.win); break;
      case 'restore': ids.forEach((id) => FS.restore(id)); break;
      case 'empty': emptyTrashConfirm(api.win); break;
      case 'import': pickFiles('image/*,.txt,.md,.csv,.json,.html,.css,.js,.svg').then((f) => f.length && doImport(f)); break;
      case 'sort': Menu.show([['name', 'Name'], ['modified', 'Date modified'], ['type', 'Type'], ['size', 'Size']].map(([k, l]) => ({ label: l, checked: st.sort === k, action: () => { st.sort = k; render(); } })).concat(['sep', { label: 'Ascending', checked: st.dir > 0, action: () => { st.dir = 1; render(); } }, { label: 'Descending', checked: st.dir < 0, action: () => { st.dir = -1; render(); } }]), 0, 0, { anchorEl: btn }); break;
      case 'view': Menu.show([{ label: 'Large icons', icon: 'grid', checked: st.view === 'grid', action: () => { st.view = 'grid'; S.set('filesView', 'grid'); render(); } }, { label: 'Details', icon: 'list', checked: st.view === 'list', action: () => { st.view = 'list'; S.set('filesView', 'list'); render(); } }], 0, 0, { anchorEl: btn }); break;
    }
  }
  root.querySelector('.fx-bar').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) cmd(b.dataset.act, b); });
  root.querySelector('.fx-cmd').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) cmd(b.dataset.act, b); });
  qInp.addEventListener('input', debounce(() => { st.q = qInp.value.trim(); if (st.cur === 'home' && st.q) { st.cur = 'root'; } render(); }, 150));
  content.addEventListener('click', (e) => {
    const el = e.target.closest('[data-id]');
    if (!el) { if (e.target === content || e.target.closest('.fx-grid, .fx-list, .fx-home, .fx-empty')) { if (!(e.ctrlKey || e.metaKey)) { st.sel.clear(); syncSel(); } } return; }
    const id = el.dataset.id;
    if (e.shiftKey && st.last) {
      const order = orderIds(); const a = order.indexOf(st.last), b = order.indexOf(id);
      if (a >= 0 && b >= 0) { st.sel = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)); }
    } else if (e.ctrlKey || e.metaKey) { st.sel.has(id) ? st.sel.delete(id) : st.sel.add(id); st.last = id; }
    else { st.sel = new Set([id]); st.last = id; }
    syncSel();
    content.focus({ preventScroll: true });
  });
  content.addEventListener('dblclick', (e) => { const el = e.target.closest('[data-id]'); if (el) open(el.dataset.id); });
  content.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') return; const el = e.target.closest('[data-id]'); if (el && st.sel.size <= 1) open(el.dataset.id); });
  content.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const el = e.target.closest('[data-id]');
    if (el) {
      const id = el.dataset.id;
      if (!st.sel.has(id)) { st.sel = new Set([id]); syncSel(); }
      if (id === 'trash') { Menu.show([{ label: 'Open', icon: 'folderOpen', action: () => go('trash') }, { label: 'Empty Recycle Bin', icon: 'trash', action: () => emptyTrashConfirm(api.win) }], e.clientX, e.clientY); return; }
      const sel = [...st.sel];
      if (st.cur === 'trash' && sel.length > 1) { Menu.show([{ label: `Restore ${sel.length} items`, icon: 'restart', action: () => sel.forEach((x) => FS.restore(x)) }, { label: 'Delete permanently', icon: 'trash', danger: true, action: () => deleteNodes(sel, api.win) }], e.clientX, e.clientY); return; }
      Menu.show(fileMenuItems(id, { within: api.win, selection: sel, onOpen: open, onRename: startRename }), e.clientX, e.clientY);
      return;
    }
    if (st.cur === 'trash') { Menu.show([{ label: 'Empty Recycle Bin', icon: 'trash', disabled: !FS.children('trash').length, action: () => emptyTrashConfirm(api.win) }, { label: 'Restore all items', icon: 'restart', disabled: !FS.children('trash').length, action: () => FS.children('trash').forEach((n) => FS.restore(n.id)) }], e.clientX, e.clientY); return; }
    if (!canWrite()) return;
    Menu.show([
      { label: 'View', icon: st.view === 'grid' ? 'grid' : 'list', submenu: [{ label: 'Large icons', checked: st.view === 'grid', action: () => { st.view = 'grid'; S.set('filesView', 'grid'); render(); } }, { label: 'Details', checked: st.view === 'list', action: () => { st.view = 'list'; S.set('filesView', 'list'); render(); } }] },
      { label: 'Sort by', icon: 'sort', submenu: [['name', 'Name'], ['modified', 'Date modified'], ['type', 'Type'], ['size', 'Size']].map(([k, l]) => ({ label: l, checked: st.sort === k, action: () => { st.sort = k; render(); } })) },
      { label: 'Refresh', icon: 'refresh', action: render },
      'sep',
      { label: 'New', icon: 'plus', submenu: [{ label: 'Folder', icon: 'folder', action: () => newItem('folder') }, { label: 'Text document', icon: 'doc', action: () => newItem('text') }] },
      { label: 'Paste', icon: 'paste', kb: 'Ctrl+V', disabled: !Clip.has(), action: () => cmd('paste') },
      { label: 'Import from this computer', icon: 'upload', action: () => cmd('import') },
      'sep',
      { label: 'Open in Terminal', icon: 'terminal', action: () => WM.open('terminal', { cwd: st.cur }) },
      { label: 'Properties', icon: 'info', action: () => Dialog.properties(st.cur, api.win) },
    ], e.clientX, e.clientY);
  });
  content.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const ids = [...st.sel]; const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (e.key === 'Enter' && ids.length) { e.preventDefault(); ids.forEach(open); }
    else if (e.key === 'Delete' && ids.length) { e.preventDefault(); deleteNodes(ids, api.win); }
    else if (e.key === 'F2' && ids.length === 1) { e.preventDefault(); startRename(ids[0]); }
    else if (e.key === 'Backspace') { e.preventDefault(); cmd('back'); }
    else if (mod && k === 'a') { e.preventDefault(); st.sel = new Set(orderIds()); syncSel(); }
    else if (mod && k === 'c' && ids.length) { e.preventDefault(); Clip.set(ids, 'copy'); }
    else if (mod && k === 'x' && ids.length) { e.preventDefault(); Clip.set(ids, 'cut'); }
    else if (mod && k === 'v') { e.preventDefault(); cmd('paste'); }
    else if (e.key.startsWith('Arrow')) {
      const order = orderIds(); if (!order.length) return; e.preventDefault();
      let i = order.indexOf(st.last ?? ''); const step = st.view === 'grid' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') ? Math.max(1, Math.floor(content.querySelector('.fx-grid')?.clientWidth / 112) || 1) : 1;
      i = i < 0 ? 0 : clamp(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? step : -step), 0, order.length - 1);
      st.last = order[i]; st.sel = new Set([order[i]]); syncSel();
      content.querySelector(`[data-id="${order[i]}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  });
  // drag and drop: inside the OS (move) and from the viewer's computer (import)
  root.addEventListener('dragstart', (e) => {
    const el = e.target.closest('[data-id]'); if (!el) return;
    if (!st.sel.has(el.dataset.id)) { st.sel = new Set([el.dataset.id]); syncSel(); }
    e.dataTransfer.setData('application/x-nimbus', JSON.stringify([...st.sel]));
    e.dataTransfer.effectAllowed = 'move';
  });
  root.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types || [];
    const tgt = e.target.closest('[data-drop]');
    const dest = tgt?.dataset.drop || (canWrite() ? st.cur : null);
    if (!dest) return;
    if (types.includes('application/x-nimbus') || types.includes('Files')) {
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
      root.querySelectorAll('.drop-hover').forEach((x) => x.classList.remove('drop-hover'));
      if (tgt) tgt.classList.add('drop-hover');
    }
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.querySelectorAll('.drop-hover').forEach((x) => x.classList.remove('drop-hover')); });
  root.addEventListener('drop', (e) => {
    root.querySelectorAll('.drop-hover').forEach((x) => x.classList.remove('drop-hover'));
    const tgt = e.target.closest('[data-drop]');
    const dest = tgt?.dataset.drop || (canWrite() ? st.cur : null);
    if (!dest) return;
    e.preventDefault(); e.stopPropagation();
    const internal = e.dataTransfer.getData('application/x-nimbus');
    if (internal) {
      let ids = []; try { ids = JSON.parse(internal); } catch {}
      let n = 0; for (const id of ids) if (id !== dest && (dest === 'trash' ? FS.trash(id) : FS.move(id, dest))) n++;
      if (n && dest === 'trash') Sound.play('trash');
      return;
    }
    if (e.dataTransfer.files?.length) importFiles(e.dataTransfer.files, dest === 'trash' || dest === 'root' ? 'downloads' : dest);
  });
  api.on('fs', () => { for (const id of [...st.sel]) if (!FS.get(id)) st.sel.delete(id); if (st.cur !== 'home' && !FS.get(st.cur)) st.cur = 'home'; render(); });
  api.on('clip', render);
  api.on('store', status);
  api.onArgs = (a) => { if (a.folder && (FS.get(a.folder) || a.folder === 'home')) go(a.folder); if (a.select) { st.sel = new Set([a.select]); render(); } };
  if (args.select && FS.get(args.select)) st.sel.add(args.select);
  render();
  requestAnimationFrame(() => content.focus({ preventScroll: true }));
}
