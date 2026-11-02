/* ========== Settings ==========
   Laid out like Windows 11's: a navigation pane (your account, "Find a setting", the categories)
   and pages of setting cards with a breadcrumb title. The pages live in settings-*.js and are
   built with WS (settings-ui.js); the hardware behind them is Sys (sys.js). */
const SETTINGS_NAV = [
  ['home', 'Home'], ['system', 'System'], ['devices', 'Bluetooth & devices'], ['network', 'Network & internet'],
  ['personalization', 'Personalization'], ['apps', 'Apps'], ['accounts', 'Accounts'], ['time', 'Time & language'],
  ['gaming', 'Gaming'], ['accessibility', 'Accessibility'], ['privacy', 'Privacy & security'], ['update', 'Nimbus Update'],
];
// The categories' own colorful icons (24 x 24)
const NAV_ICONS = {
  home: '<path d="M3.2 10.4 12 3.3l8.8 7.1V20a1 1 0 0 1-1 1H15v-5.6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1V21H4.2a1 1 0 0 1-1-1z" fill="#4f9ae6"/><path d="M12 3.3 3.2 10.4V9.1L12 2l8.8 7.1v1.3z" fill="#2a66b8"/>',
  system: '<rect x="2" y="3.2" width="20" height="13.8" rx="2.2" fill="#2f74d8"/><rect x="3.6" y="4.8" width="16.8" height="10.6" rx="1.1" fill="#79bdfc"/><path d="M9 21h6M12 17v4" stroke="#677085" stroke-width="2" stroke-linecap="round"/>',
  devices: '<rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="#2f74d8"/><path d="m8.4 8.6 7 6.4-3.4 3V6l3.4 3-7 6.4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  network: '<path d="M12 2.2 21.8 12 12 21.8 2.2 12z" fill="#1597b0"/><path d="M7.6 11.3a6.2 6.2 0 0 1 8.8 0M9.6 13.4a3.4 3.4 0 0 1 4.8 0" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.8" r="1.15" fill="#fff"/>',
  personalization: '<path d="M14.6 3.4 20.6 9.4 12.4 17.6 6.4 11.6z" fill="#f2a33a"/><path d="m6.4 11.6 6 6-1.9 1.9a3 3 0 0 1-4.2 0l-1.8-1.8a3 3 0 0 1 0-4.2z" fill="#3887e6"/><path d="m14.6 3.4 1.6-1.6a2.4 2.4 0 0 1 3.4 0l2.6 2.6a2.4 2.4 0 0 1 0 3.4l-1.6 1.6z" fill="#e0558c"/>',
  apps: '<rect x="2.8" y="2.8" width="8.2" height="8.2" rx="2.3" fill="#8a5cf6"/><rect x="13" y="2.8" width="8.2" height="8.2" rx="2.3" fill="#b199fb"/><rect x="2.8" y="13" width="8.2" height="8.2" rx="2.3" fill="#b199fb"/><rect x="13" y="13" width="8.2" height="8.2" rx="2.3" fill="#6d3be0"/>',
  accounts: '<circle cx="12" cy="7.8" r="4.6" fill="#1e955c"/><path d="M3.4 20.4c.8-4.3 4.3-7 8.6-7s7.8 2.7 8.6 7a.9.9 0 0 1-.9 1.1H4.3a.9.9 0 0 1-.9-1.1z" fill="#36c07c"/>',
  time: '<circle cx="12" cy="12" r="9.8" fill="#1b84d2"/><circle cx="12" cy="12" r="7.4" fill="#eaf4ff"/><path d="M12 7v5.1l3.4 2.1" fill="none" stroke="#1a5aa3" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  gaming: '<path d="M7.1 6.8h9.8a5 5 0 0 1 4.9 6l-.7 3.6a2.6 2.6 0 0 1-4.5 1.2L15 15.9H9l-1.6 1.7a2.6 2.6 0 0 1-4.5-1.2l-.7-3.6a5 5 0 0 1 4.9-6z" fill="#5b6578"/><path d="M7.5 9.9v4M5.5 11.9h4" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="16.1" cy="10.9" r="1.25" fill="#3dd27f"/><circle cx="17.9" cy="13.1" r="1.25" fill="#f2a33a"/>',
  accessibility: '<circle cx="12" cy="12" r="10" fill="#2f74d8"/><circle cx="12" cy="6.9" r="1.75" fill="#fff"/><path d="M7.1 9.6 12 10.5l4.9-.9M12 10.5v3.6l-2.7 4.6M12 14.1l2.7 4.6" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  privacy: '<path d="M12 2.3 20.2 5.5v6c0 5-3.4 8.8-8.2 10.2C7.2 20.3 3.8 16.5 3.8 11.5v-6z" fill="#5b6f8e"/><path d="M12 2.3v19.4c4.8-1.4 8.2-5.2 8.2-10.2v-6z" fill="#7b91b1"/><path d="m8.5 12 2.5 2.5 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  update: '<path d="M19.6 9.4A8 8 0 0 0 5.3 7.3" fill="none" stroke="#2f74d8" stroke-width="2.4" stroke-linecap="round"/><path d="M4.6 3.7v4.2h4.2" fill="none" stroke="#2f74d8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.4 14.6a8 8 0 0 0 14.3 2.1" fill="none" stroke="#1597b0" stroke-width="2.4" stroke-linecap="round"/><path d="M19.4 20.3v-4.2h-4.2" fill="none" stroke="#1597b0" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
};
const navIcon = (id) => `<svg class="ws-navic" viewBox="0 0 24 24" aria-hidden="true">${NAV_ICONS[id] || ''}</svg>`;

function mountSettings(root, api, args) {
  root.classList.add('app-settings', 'ws');
  let cur = null, params = {}, hist = [], live = { syncs: [], offs: [] };
  const side = h('nav', { class: 'ws-side', 'aria-label': 'Settings' });
  const user = h('button', { class: 'ws-user', 'aria-label': 'Your info' });
  const find = h('input', { type: 'search', placeholder: 'Find a setting', 'aria-label': 'Find a setting', spellcheck: 'false' });
  const search = h('div', { class: 'ws-search' }, find, frag(`<span class="ws-search-ic">${fi('search')}</span>`));
  const suggest = h('div', { class: 'ws-suggest', role: 'listbox', hidden: true });
  const navList = h('div', { class: 'ws-navlist' });
  side.append(user, h('div', { class: 'ws-search-wrap' }, search, suggest), navList);
  const main = h('main', { class: 'ws-main' });
  const menu = h('button', { class: 'ws-menu', 'aria-label': 'Open navigation', html: fi('list') });
  const head = h('header', { class: 'ws-head' });
  const scroller = h('div', { class: 'ws-scroll', tabindex: '-1' });
  const content = h('div', { class: 'ws-content' });
  scroller.append(content); main.append(h('div', { class: 'ws-headrow' }, menu, head), scroller);
  root.append(side, main);
  // Back, at the left of the title bar like Windows
  const back = h('button', { class: 'wc ws-back', 'aria-label': 'Back', 'data-tip': 'Back', html: fi('arrowLeft'), hidden: true });
  api.titlebarLead?.(back);
  back.addEventListener('click', (e) => { e.stopPropagation(); goBack(); });
  user.addEventListener('click', () => go('yourinfo'));
  menu.addEventListener('click', () => root.classList.toggle('nav-open'));
  new ResizeObserver(() => root.classList.toggle('narrow', root.clientWidth < 760)).observe(root);

  function renderSide() {
    const pic = avatarHTML(true);
    user.innerHTML = `<span class="ws-user-av">${pic}</span><span class="ws-user-meta"><b>${esc(userName() || 'You')}</b><span>Local Account</span></span>`;
    navList.innerHTML = '';
    const top = cur ? pageTrail(cur)[0]?.id : null;
    for (const [id, title] of SETTINGS_NAV) {
      if (SPAGES[id]?.hidden?.()) continue;
      const b = h('button', { class: 'ws-nav' + (id === top ? ' on' : ''), 'aria-current': id === top ? 'page' : null, html: `${navIcon(id)}<span>${esc(title)}</span>` });
      b.addEventListener('click', () => { root.classList.remove('nav-open'); go(id); });
      navList.append(b);
    }
  }
  function teardown() { for (const off of live.offs) { try { off(); } catch {} } live = { syncs: [], offs: [] }; WS.closeList(); }
  function ctxFor() {
    const mine = live;
    return {
      api, win: api.win, page: cur, params,
      go: (id, focus, p) => go(id, { focus, params: p }),
      sync: (fn) => { mine.syncs.push(fn); },
      on: (ev, fn) => { mine.offs.push(bus.on(ev, fn)); },
      onLeave: (fn) => { mine.offs.push(fn); },
      rerender: () => { if (mine === live) render({ scroll: scroller.scrollTop }); },
      every: (ms, fn) => { const t = setInterval(fn, ms); mine.offs.push(() => clearInterval(t)); },
    };
  }
  function render({ focus, scroll } = {}) {
    teardown();
    const p = SPAGES[cur];
    renderSide();
    head.innerHTML = '';
    const bc = h('h1', { class: 'ws-title' });
    const trail = pageTrail(cur);
    trail.forEach((t, i) => {
      if (i) bc.append(frag(`<span class="ws-bc-sep">${fi('chevronRight')}</span>`));
      if (i === trail.length - 1) bc.append(h('span', { class: 'ws-bc-cur', text: t.title }));
      else { const b = h('button', { class: 'ws-bc', text: t.title }); b.onclick = () => go(t.id); bc.append(b); }
    });
    head.append(bc);
    content.innerHTML = '';
    content.className = 'ws-content' + (p.wide ? ' wide' : '');
    const ctx = ctxFor();
    let nodes;
    try { nodes = p.render(ctx) || []; } catch (e) { console.error(e); nodes = [WS.info('error', 'This page couldn’t open', e.message)]; }
    content.append(...[nodes].flat(3).filter(Boolean));
    api.setTitle('Settings');
    back.hidden = !hist.length;
    scroller.scrollTop = scroll || 0;
    if (focus) requestAnimationFrame(() => {
      const el = content.querySelector(`[data-sid="${focus}"]`); if (!el) return;
      if (el.classList.contains('ws-exp') && !el.classList.contains('open')) el.querySelector('.ws-exp-head')?.click();
      el.scrollIntoView({ block: 'center' }); el.classList.add('ws-flash'); setTimeout(() => el.classList.remove('ws-flash'), 1600);
    });
    // Home lists the pages you visit
    if (p.parent && !SPAGES[cur].noRecent) { const r = [cur, ...(S.data.settingsRecent || []).filter((x) => x !== cur)].slice(0, 6); S.data.settingsRecent = r; Store.saveSettings(); }
  }
  function go(id, { focus, noHistory, params: p } = {}) {
    if (!SPAGES[id] || SPAGES[id].hidden?.()) id = 'home';
    if (cur && !noHistory && cur !== id) hist.push({ id: cur, params, scroll: scroller.scrollTop });
    if (hist.length > 40) hist.shift();
    cur = id; params = p || {}; find.value = ''; closeSuggest();
    render({ focus });
  }
  function goBack() { const prev = hist.pop(); if (!prev) return; cur = prev.id; params = prev.params || {}; render({ scroll: prev.scroll }); }
  api.onArgs = (a) => { if (a && a.page) go(a.page, { focus: a.focus }); };

  /* ---- Find a setting ---- */
  let hits = [], sel = -1;
  function results(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    const words = q.split(/\s+/);
    const scored = [];
    const add = (page, sid, title, keywords, weight) => {
      const p = SPAGES[page]; if (!p || p.hidden?.()) return;
      const hay = (title + ' ' + keywords + ' ' + (p.title || '')).toLowerCase();
      if (!words.every((w) => hay.includes(w))) return;
      scored.push({ page, sid, title, where: pageTrail(page).map((x) => x.title).join(' > '), score: weight + (title.toLowerCase().startsWith(q) ? 3 : 0) + (title.toLowerCase().includes(q) ? 2 : 0) });
    };
    for (const p of Object.values(SPAGES)) add(p.id, null, p.title, p.keywords || '', 1);
    for (const s of SINDEX) add(s.page, s.sid, s.title, s.keywords, 0);
    const seen = new Set();
    return scored.sort((a, b) => b.score - a.score).filter((r) => { const k = r.page + '|' + r.sid; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  }
  function closeSuggest() { suggest.hidden = true; hits = []; sel = -1; }
  function showSuggest() {
    hits = results(find.value); sel = hits.length ? 0 : -1;
    suggest.innerHTML = '';
    if (!find.value.trim()) { closeSuggest(); return; }
    if (!hits.length) suggest.append(h('div', { class: 'ws-sug-none', text: 'No results' }));
    hits.forEach((r, i) => {
      const it = h('button', { class: 'ws-sug' + (i === sel ? ' sel' : ''), role: 'option' }, frag(`<span class="ws-sug-ic">${fi('settings')}</span>`), h('span', { class: 'ws-sug-t' }, h('b', { text: r.title }), h('span', { text: r.where })));
      it.addEventListener('pointerdown', (e) => { e.preventDefault(); go(r.page, { focus: r.sid }); });
      suggest.append(it);
    });
    suggest.hidden = false;
  }
  find.addEventListener('input', showSuggest);
  find.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!hits.length) return; e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; [...suggest.querySelectorAll('.ws-sug')].forEach((x, i) => x.classList.toggle('sel', i === sel)); }
    else if (e.key === 'Enter') { const r = hits[Math.max(0, sel)]; if (r) go(r.page, { focus: r.sid }); }
    else if (e.key === 'Escape') { find.value = ''; closeSuggest(); }
  });
  find.addEventListener('blur', () => setTimeout(closeSuggest, 150));

  /* ---- live updates ---- */
  const resync = () => { for (const f of live.syncs) { try { f(); } catch (e) { console.error(e); } } };
  api.on('settings', (keys) => { if (keys.some((k) => ['userName', 'avatar'].includes(k))) renderSide(); resync(); });
  api.on('sys', () => resync());
  api.on('net', () => resync());
  api.on('apps', () => resync());
  api.onClose(teardown);
  go(args.page || 'home', { focus: args.focus, noHistory: true });
}

/* ---- shared by several pages ---- */
async function restoreBackup(win) {
  const f = await pickFiles('.json,application/json', false); if (!f.length) return;
  let data;
  try { data = JSON.parse(await f[0].text()); } catch { Dialog.alert('That file is not a backup', 'Choose a .json file made with "Back up".', win); return; }
  if (!data || data.app !== 'nimbus-os' || typeof data.nodes !== 'object') { Dialog.alert('That file is not a backup', 'Choose a .json file made with "Back up".', win); return; }
  const ok = await Dialog.confirm('Restore this backup?', 'Your current files and settings will be replaced by the ones in the backup.', { ok: 'Restore', danger: true, within: win });
  if (!ok) return;
  S.load(data.settings); FS.init(data.nodes, data.contents || {});
  for (const id in FS.nodes) { delete FS.nodes[id].chunks; if (FS.nodes[id].type === 'file') Store.saveContent(id); }
  S.data.updatedAt = Date.now(); FS.updatedAt = Date.now();
  Store.saveSettings(); Store.saveFs();
  Shell.reloadAll();
  Notif.push({ app: 'settings', title: 'Backup restored', body: `${FS.usage().files} files are back.` });
}
async function resetPC(win) {
  const ok = await Dialog.confirm('Reset this PC?', 'All your files, pictures and settings will be erased. This cannot be undone.', { ok: 'Erase everything', danger: true, within: win });
  if (!ok) return;
  await WM.closeAll(true);
  await Store.wipe();
  Store.quietly(() => { S.load({}); seedFS(); });
  S.data.updatedAt = Date.now();
  Store.saveSettings(); Store.saveFs();
  for (const id in FS.nodes) if (FS.nodes[id].type === 'file') Store.saveContent(id);
  Shell.reloadAll();
  Power.restart();
  setTimeout(() => WM.open('welcome'), 3200);
}
function backupJSON() { return JSON.stringify({ app: 'nimbus-os', v: 1, settings: S.data, nodes: FS.nodes, contents: FS.contents }); }
// The computer's name: the real one on Nimbus OS, the one you chose in a browser
const pcName = () => (IS_NATIVE && Native.info && Native.info.hostname) || S.data.deviceName || 'My PC';
const needsNimbus = () => WS.info('info', 'Available on Nimbus OS', 'This works when Nimbus runs on a computer, not in a browser tab.');
