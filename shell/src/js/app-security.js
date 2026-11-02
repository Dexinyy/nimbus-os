/* ========== Nimbus Security ==========
   Like Windows Security: virus & threat protection (ClamAV: scans, real-time protection, quarantine, protection
   history), the firewall with Private and Public network profiles (ufw), app & browser control, device security,
   device health and account protection. The machine side is os/overlay/usr/lib/nimbus/nimbus_security.py. */
const SEC_AREAS = [
  ['virus', 'Virus & threat protection', 'shield'], ['account', 'Account protection', 'person'],
  ['firewall', 'Firewall & network protection', 'globeShield'], ['appbrowser', 'App & browser control', 'windowShield'],
  ['device', 'Device security', 'laptop'], ['health', 'Device performance & health', 'heartPulse'], ['history', 'Protection history', 'history'],
];
const SecState = { st: null, at: 0, scan: null };
async function secStatus(force) {
  if (!force && SecState.st && Date.now() - SecState.at < 4000) return SecState.st;
  SecState.st = await Native.call('securityStatus', {}, 60000);
  SecState.at = Date.now();
  if (SecState.st.scan && !SecState.scan) SecState.scan = SecState.st.scan;
  bus.emit('security-status', SecState.st);
  return SecState.st;
}
// How each protection area is doing: ok, warn (action recommended) or bad (action needed)
function secAreaState(id, st) {
  if (!st) return { level: 'ok', text: '' };
  const fw = st.firewall || {};
  const profile = (st.network && st.network.profile) || fw.profile || 'public';
  const ageDays = st.defs && st.defs.updated ? (Date.now() / 1000 - st.defs.updated) / 86400 : null;
  switch (id) {
    case 'virus':
      if (st.activeThreats && st.activeThreats.length) return { level: 'bad', text: 'Threats found. Start the recommended actions.', act: 'Start actions' };
      if (!st.defs || !st.defs.present) return { level: 'warn', text: 'Security intelligence isn’t downloaded yet.', act: 'Download' };
      if (!st.prefs.realtime) return { level: 'warn', text: 'Real-time protection is off, leaving your device vulnerable.', act: 'Turn on' };
      if (ageDays != null && ageDays > 3) return { level: 'warn', text: 'Security intelligence is out of date.', act: 'Update' };
      return { level: 'ok', text: 'No action needed.' };
    case 'firewall':
      if (!fw.available) return { level: 'warn', text: 'The firewall can’t be checked.' };
      if (!fw.active || (fw.enabled && fw.enabled[profile] === false)) return { level: 'bad', text: 'The firewall is off. Your device may be vulnerable.', act: 'Turn on' };
      return { level: 'ok', text: 'No action needed.' };
    case 'appbrowser':
      if (!st.prefs.downloads || !st.prefs.pua) return { level: 'warn', text: 'Check apps and files or app blocking is off.', act: 'Turn on' };
      return { level: 'ok', text: 'No action needed.' };
    case 'account':
      return S.data.lockPin ? { level: 'ok', text: 'No action needed.' } : { level: 'info', text: 'Set up a PIN for faster, safer sign-in.' };
    case 'device':
      return st.secureBoot && st.secureBoot.supported && !st.secureBoot.on ? { level: 'info', text: 'Secure boot is off.' } : { level: 'ok', text: 'View status and manage hardware security features.' };
    case 'health':
      return { level: 'ok', text: 'Reports on the health of your device.' };
    default:
      return { level: 'ok', text: '' };
  }
}
function secOverall(st) {
  const levels = SEC_AREAS.map(([id]) => secAreaState(id, st).level);
  return levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : 'ok';
}
const secBadge = (level) => level === 'bad' ? `<span class="sec-badge bad">${fi('dismiss')}</span>` : level === 'warn' ? `<span class="sec-badge warn">!</span>` : level === 'ok' ? `<span class="sec-badge ok">${fi('checkmark')}</span>` : '';
const secDate = (t) => t ? fmtDT(t * 1000, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
const secDuration = (s) => s >= 60 ? `${Math.floor(s / 60)} minute${Math.floor(s / 60) === 1 ? '' : 's'} ${s % 60} second${s % 60 === 1 ? '' : 's'}` : `${s} second${s === 1 ? '' : 's'}`;

if (IS_NATIVE) {
  // Threats found (by real-time protection or a scan): tell the user, like Windows Security's notifications
  bus.on('native:security-alert', (d) => {
    const n = (d && d.threats || []).length; if (!n) return;
    Notif.push({ app: 'security', urgent: true, title: d.auto ? 'Threats found and quarantined' : 'Threats found',
      body: d.auto ? `Nimbus Security found ${n === 1 ? 'a threat' : n + ' threats'} in a new file and moved ${n === 1 ? 'it' : 'them'} to quarantine. Select for details.` : 'Nimbus Security found threats. Start the recommended actions.',
      action: () => WM.open('security', { page: d.auto ? 'history' : 'virus' }) });
    secStatus(true).catch(() => {});
  });
  bus.on('native:security-scan', (s) => {
    if (!s || s.kind === 'update') return;
    if (s.kind !== 'realtime') SecState.scan = s;
    bus.emit('security-scan', s);
  });
}
/* Keeps the security intelligence current: a day after the last update, when the network isn't metered */
const SecAuto = {
  start() {
    if (!IS_NATIVE || !caps.programs) return;
    setTimeout(() => this.check(), 3 * 60 * 1000);
    setInterval(() => this.check(), 6 * 3600 * 1000);
  },
  async check() {
    try {
      const st = await secStatus(true);
      if (!st.defs.present && !(Native.info && Native.info.persistent)) return; // a live session downloads them when asked
      if (st.defs.present && Date.now() / 1000 - st.defs.updated < 86400) return;
      if (S.data.updMetered !== true && Net.status && Net.status.metered) return; // as Nimbus Update does
      await Native.call('securityUpdate', {}, 60 * 60 * 1000);
      secStatus(true).catch(() => {});
    } catch (e) { console.warn('security update:', e.message); }
  },
};

function mountSecurity(root, api, args) {
  root.classList.add('app-security', 'ws');
  const syncs = new Set();
  const ctx = { sync: (fn) => syncs.add(fn), go: (id, _focus, params) => go(id, params || {}), win: api.win, on: (e, f) => api.on(e, f) };
  const refreshAll = () => syncs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  const nav = h('nav', { class: 'sec-nav', 'aria-label': 'Nimbus Security' });
  const content = h('div', { class: 'sec-content', tabindex: '-1' });
  root.append(nav, content);
  const back = h('button', { class: 'wc ws-back', 'aria-label': 'Back', 'data-tip': 'Back', html: fi('arrowLeft'), hidden: true });
  api.titlebarLead(back);
  let page = null; const hist = [];
  back.addEventListener('click', () => { const p = hist.pop(); if (p) go(p.id, p.params, true); });
  const navItem = (id, label, icon) => { const b = h('button', { class: 'sec-nav-i', 'data-page': id, html: fi(icon) + `<span>${esc(label)}</span>` }); b.addEventListener('click', () => go(id)); return b; };
  nav.append(navItem('home', 'Home', 'home'), ...SEC_AREAS.map(([id, label, icon]) => navItem(id, label, icon)), h('div', { class: 'sec-nav-sp' }), navItem('settings', 'Settings', 'settings'));

  const PARENT = { scanoptions: 'virus', threatsettings: 'virus', exclusions: 'virus', allowed: 'virus', updates: 'virus', fwprofile: 'firewall', fwapps: 'firewall', exploit: 'appbrowser' };
  async function go(id, params = {}, isBack) {
    if (page && !isBack && (page.id !== id || JSON.stringify(page.params) !== JSON.stringify(params))) hist.push(page);
    page = { id, params };
    back.hidden = !hist.length;
    const top = PARENT[id] || id;
    nav.querySelectorAll('.sec-nav-i').forEach((b) => b.classList.toggle('on', b.dataset.page === top));
    syncs.clear();
    const box = h('div', { class: 'sec-page sec-' + id });
    content.replaceChildren(box); content.scrollTop = 0;
    if (!IS_NATIVE || !caps.programs) { box.append(h('div', { class: 'sec-empty' }, h('div', { html: appIcon('security') }), h('h2', { text: 'Nimbus Security works on Nimbus OS' }), h('p', { class: 'muted', text: 'Run Nimbus OS on a computer (or in a virtual machine) to scan for viruses and use the firewall.' }))); return; }
    let st;
    try { st = await secStatus(); } catch (e) { box.append(h('p', { class: 'muted', text: 'Nimbus Security couldn’t read the status: ' + e.message })); return; }
    if (page.id !== id) return;
    try { (PAGES[id] || PAGES.home)(box, st, params); } catch (e) { console.error(e); box.append(h('p', { text: e.message })); }
  }
  const rerender = () => { if (page) go(page.id, page.params, true); };
  const offStatus = bus.on('security-status', () => refreshAll());
  api.onClose(offStatus);

  /* ---- pieces ---- */
  const header = (icon, title, desc) => h('header', { class: 'sec-h' }, h('span', { class: 'sec-h-ic', html: fi(icon) }), h('div', {}, h('h1', { text: title }), desc ? h('p', { class: 'muted', text: desc }) : null));
  const section = (title, ...kids) => h('section', { class: 'sec-sec' }, title ? h('h2', { text: title }) : null, ...kids.flat().filter(Boolean));
  const link = (text, fn) => h('button', { class: 'sec-link', text, onclick: fn });
  const status = (level, text) => h('div', { class: 'sec-status ' + level, html: secBadge(level) + `<span>${esc(text)}</span>` });
  async function act(fn, ok) {
    try { const r = await fn(); if (ok) Notif.push({ app: 'security', title: ok, silent: true }); await secStatus(true); rerender(); return r; }
    catch (e) { Dialog.alert('Nimbus Security', e.message, api.win); await secStatus(true).catch(() => {}); rerender(); return null; }
  }
  async function updateDefs(btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Checking for updates…'; }
    const off = bus.on('native:security-scan', (s) => { if (s && s.kind === 'update' && btn) btn.textContent = s.text + '…'; });
    try { await act(() => Native.call('securityUpdate', {}, 60 * 60 * 1000), 'Security intelligence is up to date'); } finally { off(); }
  }
  async function startScan(kind, paths) {
    SecState.scan = { kind, state: 'starting', scanned: 0, total: 0, threats: [] };
    bus.emit('security-scan', SecState.scan);
    try { const r = await Native.call('securityScan', { kind, paths }, 24 * 3600 * 1000); SecState.scan = r; }
    catch (e) { SecState.scan = null; Dialog.alert('The scan didn’t run', e.message, api.win); }
    await secStatus(true).catch(() => {});
    if (page && (page.id === 'virus' || page.id === 'scanoptions')) go('virus', {}, true);
  }

  // The scan area: last scan's result, or the scan going on
  function scanPanel(st) {
    const wrap = h('div', { class: 'sec-scan' });
    const paint = () => {
      const s = SecState.scan;
      wrap.replaceChildren();
      const running = s && ['starting', 'counting', 'loading', 'scanning'].includes(s.state);
      if (running) {
        const name = { quick: 'Quick scan', full: 'Full scan', custom: 'Custom scan' }[s.kind] || 'Scan';
        const pct = s.total ? Math.min(99, Math.round(100 * s.scanned / s.total)) : null;
        const text = s.state === 'scanning' ? `${s.scanned.toLocaleString()} files scanned` : s.state === 'loading' ? 'Loading security intelligence…' : s.state === 'counting' ? 'Finding files to scan…' : 'Getting ready…';
        wrap.append(h('p', { class: 'sec-scan-t', text: name + ' running…' }), h('div', { class: 'ms-bar' + (pct == null ? ' busy' : '') }, h('i', { style: pct == null ? '' : `width:${pct}%` })),
          h('p', { class: 'muted', text: text + (pct != null ? ` (${pct}%)` : '') }), s.current ? h('p', { class: 'muted sec-cur', text: s.current }) : null,
          h('button', { class: 'btn', text: 'Cancel', onclick: () => Native.call('securityCancel') }));
        return;
      }
      const threats = (st.activeThreats || []);
      if (threats.length) {
        wrap.append(h('p', { class: 'sec-scan-t bad', html: secBadge('bad') + `<span>${threats.length === 1 ? 'Threat found.' : threats.length + ' threats found.'} Start the recommended actions.</span>` }),
          h('div', { class: 'sec-threats' }, threats.map((t) => threatRow(t))),
          h('div', { class: 'sec-row' }, h('button', { class: 'btn primary', text: 'Start actions', onclick: () => act(() => Native.call('securityActAll'), 'Threats moved to quarantine') })));
      } else wrap.append(h('p', { class: 'sec-scan-t' }, 'No current threats.'));
      const last = (s && s.state === 'done' && s.kind) ? s : null;
      const lastQuick = st.prefs.lastQuick, lastFull = st.prefs.lastFull;
      const when = Math.max(lastQuick || 0, lastFull || 0);
      wrap.append(h('p', { class: 'muted' }, when ? `Last scan: ${secDate(when)} (${lastFull > lastQuick ? 'full' : 'quick'} scan)` : 'Last scan: none yet'));
      if (last) wrap.append(h('p', { class: 'muted', text: `${last.threats.length} threat${last.threats.length === 1 ? '' : 's'} found.` }), h('p', { class: 'muted', text: `Scan lasted ${secDuration((last.finished || 0) - (last.started || 0))}` }), h('p', { class: 'muted', text: `${(last.scanned || 0).toLocaleString()} files scanned.` }));
      const q = h('button', { class: 'btn', text: 'Quick scan', disabled: !st.defs.present, onclick: () => startScan('quick') });
      wrap.append(h('div', { class: 'sec-row' }, q), link('Scan options', () => go('scanoptions')), link('Allowed threats', () => go('allowed')), link('Protection history', () => go('history')));
      if (!st.defs.present) wrap.append(h('p', { class: 'muted small', text: 'Scanning needs security intelligence: download it below.' }));
    };
    const off = bus.on('security-scan', paint);
    const obs = new MutationObserver(() => { if (!wrap.isConnected) { off(); obs.disconnect(); } });
    obs.observe(content, { childList: true });
    paint();
    return wrap;
  }
  function threatRow(t) {
    return h('div', { class: 'sec-threat' }, h('span', { class: 'sec-sev ' + (t.severity || 'high'), text: (t.severity || 'high').replace(/^\w/, (c) => c.toUpperCase()) }),
      h('div', { class: 'sec-tt' }, h('b', { text: t.threat }), h('span', { class: 'muted', text: (t.category || '') + ' · ' + (t.path || '') })),
      h('button', { class: 'btn', text: 'Actions', onclick: (e) => threatMenu(t, e.currentTarget) }));
  }
  function threatMenu(t, anchorEl) {
    const items = t.status === 'quarantined'
      ? [{ label: 'Remove', icon: 'trash', action: () => act(() => Native.call('securityAction', { id: t.id, action: 'remove' }), 'Removed') },
        { label: 'Restore', icon: 'undo', action: async () => { if (await Dialog.confirm('Restore this file?', 'It will be put back where it was found and allowed on this device. Only do this if you trust it.', { ok: 'Restore', danger: true, within: api.win })) act(() => Native.call('securityAction', { id: t.id, action: 'restore' }), 'Restored'); } }]
      : [{ label: 'Quarantine', icon: 'lock', action: () => act(() => Native.call('securityAction', { id: t.id, action: 'quarantine' }), 'Moved to quarantine') },
        { label: 'Remove', icon: 'trash', action: () => act(() => Native.call('securityAction', { id: t.id, action: 'remove' }), 'Removed') },
        { label: 'Allow on device', icon: 'check', action: async () => { if (await Dialog.confirm('Allow this threat?', 'Nimbus Security won’t warn you about it again. Only do this if you trust it.', { ok: 'Allow', danger: true, within: api.win })) act(() => Native.call('securityAction', { id: t.id, action: 'allow' }), 'Allowed'); } }];
    Menu.show(items, 0, 0, { anchorEl });
  }

  /* ---- pages ---- */
  const PAGES = {
    home(box, st) {
      const overall = secOverall(st);
      box.append(h('header', { class: 'sec-hero ' + overall }, h('span', { class: 'sec-hero-ic', html: appIcon('security') + secBadge(overall) }),
        h('div', {}, h('h1', { text: 'Security at a glance' }), h('p', { class: 'muted', text: overall === 'ok' ? 'Your device is being protected.' : overall === 'bad' ? 'Your device needs attention.' : 'Actions are recommended.' }),
          h('p', { class: 'muted small', text: 'See what’s happening with the security and health of your device and take any actions needed.' }))));
      const grid = h('div', { class: 'sec-tiles' });
      for (const [id, label, icon] of SEC_AREAS.filter(([i]) => i !== 'history')) {
        const s = secAreaState(id, st);
        const tile = h('div', { class: 'sec-tile ' + s.level, role: 'button', tabindex: '0' },
          h('span', { class: 'sec-tile-ic', html: fi(icon) + secBadge(s.level) }), h('b', { text: label }), h('span', { class: 'muted', text: s.text }));
        if (s.act) tile.append(h('button', { class: 'btn' + (s.level === 'bad' ? ' primary' : ''), text: s.act, onclick: (e) => { e.stopPropagation(); quickFix(id); } }));
        tile.addEventListener('click', () => go(id));
        tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(id); });
        grid.append(tile);
      }
      box.append(grid);
    },
    virus(box, st) {
      box.append(header('shield', 'Virus & threat protection', 'Protection for your device against threats.'));
      box.append(section('Current threats', scanPanel(st)));
      const rt = st.prefs.realtime && st.defs.present;
      box.append(section('Virus & threat protection settings',
        rt ? status('ok', 'No action needed.') : status('warn', st.prefs.realtime ? 'Real-time protection starts when security intelligence is downloaded.' : 'Real-time protection is off, leaving your device vulnerable.'),
        !st.prefs.realtime ? h('div', { class: 'sec-row' }, h('button', { class: 'btn', text: 'Turn on', onclick: () => act(() => Native.call('securityPrefs', { set: { realtime: true } })) })) : null,
        link('Manage settings', () => go('threatsettings'))));
      const d = st.defs;
      const age = d.present ? Math.floor((Date.now() / 1000 - d.updated) / 86400) : null;
      box.append(section('Virus & threat protection updates',
        !d.present ? status('warn', 'Security intelligence hasn’t been downloaded yet.') : age > 3 ? status('warn', 'Security intelligence is out of date.') : status('ok', 'Security intelligence is up to date.'),
        h('p', { class: 'muted', text: d.present ? 'Last update: ' + secDate(d.updated) : 'Nimbus Security uses ClamAV’s definitions (about 230 MB to download the first time, then small daily updates).' }),
        link('Protection updates', () => go('updates'))));
    },
    scanoptions(box, st) {
      box.append(header('shield', 'Scan options', 'Run a quick, full or custom scan.'));
      let kind = 'quick';
      const opts = [['quick', 'Quick scan', 'Checks folders in your system where threats are commonly found: downloads, the desktop, documents, what starts when you sign in, and temporary files.'],
        ['full', 'Full scan', 'Checks all your files and the drives you’ve connected. This scan could take longer than an hour.'],
        ['custom', 'Custom scan', 'Choose which folders and files you want to check.']];
      const custom = h('input', { class: 'field', placeholder: '~/Downloads or /media/USB-DRIVE', 'aria-label': 'Folder or file to scan', value: '~/Downloads', style: 'width:100%;max-width:420px', hidden: true });
      const list = h('div', { class: 'sec-radios', role: 'radiogroup' }, opts.map(([id, title, desc]) => {
        const r = h('input', { type: 'radio', name: 'sec-kind', value: id, checked: id === 'quick', id: 'sk-' + id });
        r.addEventListener('change', () => { kind = id; custom.hidden = id !== 'custom'; });
        return h('label', { class: 'sec-radio', for: 'sk-' + id }, r, h('div', {}, h('b', { text: title }), h('span', { class: 'muted', text: desc })));
      }));
      const places = h('div', { class: 'sec-chips' }, [['~/Downloads', 'Downloads'], ['~/Desktop', 'Desktop'], ['~/Documents', 'Documents'], ['~', 'Home folder'], ['/media', 'USB drives']].map(([p, l]) =>
        h('button', { class: 'ms-chip', text: l, onclick: () => { custom.value = p; list.querySelector('#sk-custom').checked = true; kind = 'custom'; custom.hidden = false; } })));
      box.append(section(null, scanPanel(st)), section(null, list, places, custom,
        h('div', { class: 'sec-row' }, h('button', { class: 'btn primary', text: 'Scan now', disabled: !st.defs.present, onclick: () => startScan(kind, kind === 'custom' ? [custom.value] : undefined) }))));
    },
    threatsettings(box, st) {
      box.append(header('shield', 'Virus & threat protection settings', 'View and update virus & threat protection settings for Nimbus Security.'));
      const pref = (key) => WS.toggle(ctx, () => !!(SecState.st || st).prefs[key], (v) => act(() => Native.call('securityPrefs', { set: { [key]: v } })), key);
      box.append(WS.group(null,
        WS.card(ctx, { icon: 'shield', title: 'Real-time protection', desc: 'Scans files as they arrive in your downloads, desktop and documents, and in the places programs start from. Threats are moved to quarantine right away.', ctl: pref('realtime') }),
        WS.card(ctx, { icon: 'bug', title: 'Potentially unwanted apps', desc: 'Also report adware, bundled installers and tools that can be misused.', ctl: pref('pua') }),
        WS.card(ctx, { icon: 'documentSearch', title: 'Exclusions', desc: 'Add or remove items that you want to exclude from scans.', go: 'exclusions' }),
        WS.card(ctx, { icon: 'lock', title: 'Quarantine', desc: st.quarantined ? `${st.quarantined} item${st.quarantined === 1 ? '' : 's'} in quarantine` : 'Nothing is in quarantine', go: 'history' })));
    },
    exclusions(box, st) {
      box.append(header('documentSearch', 'Exclusions', 'Add or remove items that you want to exclude from scans. Excluded items could contain threats that make your device vulnerable.'));
      const add = h('button', { class: 'btn', html: fi('add') + '<span>Add an exclusion</span>' });
      add.addEventListener('click', () => Menu.show([['file', 'File'], ['folder', 'Folder'], ['type', 'File type']].map(([type, label]) => ({ label, action: async () => {
        const v = await Dialog.prompt('Add a ' + label.toLowerCase() + ' exclusion', { label: type === 'type' ? 'File extension (like .iso)' : 'Full path (like ~/Games)', within: api.win });
        if (v) act(() => Native.call('securityExclusion', { type, path: v, add: true }));
      } })), 0, 0, { anchorEl: add }));
      const rows = (st.prefs.exclusions || []).map((e) => WS.card(ctx, { icon: e.type === 'folder' ? 'folder' : e.type === 'type' ? 'document' : 'document', title: e.path, desc: { folder: 'Folder', file: 'File', type: 'File type' }[e.type],
        ctl: WS.button('Remove', () => act(() => Native.call('securityExclusion', { type: e.type, path: e.path, add: false }))) }));
      box.append(h('div', { class: 'sec-row' }, add), WS.group(null, ...(rows.length ? rows : [h('p', { class: 'muted', text: 'No exclusions.' })])));
    },
    allowed(box, st) {
      box.append(header('shield', 'Allowed threats', 'Allowed threats are items that have been found as threats, but that you allowed to run on this device.'));
      const rows = (st.prefs.allowed || []).map((a) => WS.card(ctx, { icon: 'warning', title: a.threat, desc: a.path, ctl: WS.button('Don’t allow', () => act(() => Native.call('securityAllowed', { path: a.path, threat: a.threat }))) }));
      box.append(WS.group(null, ...(rows.length ? rows : [h('p', { class: 'muted', text: 'There are no allowed threats.' })])));
    },
    updates(box, st) {
      box.append(header('updateCheck', 'Protection updates', 'View information about your security intelligence version, and check for updates.'));
      const d = st.defs;
      const btn = h('button', { class: 'btn primary', text: d.present ? 'Check for updates' : 'Download security intelligence' });
      btn.addEventListener('click', () => updateDefs(btn));
      box.append(section('Security intelligence',
        h('p', { class: 'muted', text: 'Nimbus Security uses security intelligence (ClamAV’s virus definitions) to detect threats. It checks for updates once a day.' }),
        d.present ? h('dl', { class: 'sec-dl' }, h('dt', { text: 'Version' }), h('dd', { text: d.version || '—' }), h('dt', { text: 'Last update' }), h('dd', { text: secDate(d.updated) }),
          h('dt', { text: 'Signatures' }), h('dd', { text: (d.sigs || 0).toLocaleString() }), h('dt', { text: 'Engine' }), h('dd', { text: 'ClamAV ' + (st.engine || '') })) : h('p', { text: 'Not downloaded yet (about 230 MB).' }),
        Native.info && Native.info.live && !Native.info.persistent ? h('p', { class: 'muted small', text: 'Saving isn’t on, so this is downloaded again after you restart.' }) : null,
        h('div', { class: 'sec-row' }, btn)));
    },
    account(box) {
      box.append(header('person', 'Account protection', 'Security for your account and sign-in.'));
      box.append(section('Sign-in options', S.data.lockPin ? status('ok', 'Your device is protected with a PIN.') : status('info', 'Set up a PIN to sign in faster and keep others out when you step away.'),
        link('Sign-in options', () => WM.open('settings', { page: 'signin' }))));
      box.append(section('Lock your device', h('p', { class: 'muted', text: S.data.lockOnWake !== false ? 'Nimbus locks when it wakes from sleep.' : 'Nimbus doesn’t lock when it wakes from sleep.' }),
        h('p', { class: 'muted', text: 'Press Windows key + L to lock right away.' }), link('Power settings', () => WM.open('settings', { page: 'power' }))));
    },
    firewall(box, st) {
      box.append(header('globeShield', 'Firewall & network protection', 'Who and what can access your networks.'));
      const fw = st.firewall || {};
      if (!fw.available) { box.append(status('warn', 'The firewall can’t be checked: ' + (fw.error || 'it isn’t installed'))); return; }
      const active = (st.network && st.network.profile) || fw.profile;
      const list = h('div', { class: 'sec-nets' });
      for (const [id, name, icon] of [['private', 'Private network', 'home'], ['public', 'Public network', 'globe']]) {
        const on = fw.enabled[id] !== false;
        const row = h('button', { class: 'sec-net', onclick: () => go('fwprofile', { profile: id }) }, h('span', { class: 'sec-net-ic', html: fi(icon) }),
          h('div', {}, h('b', { text: name + (active === id && st.network ? ' (active)' : '') }), h('span', { class: 'muted', text: on ? 'Firewall is on.' : 'Firewall is off.' })), h('span', { html: secBadge(on ? 'ok' : 'bad') }));
        list.append(row);
      }
      box.append(list, section(null, link('Allow an app through firewall', () => go('fwapps')), link('Network and Internet troubleshooter', () => WM.open('settings', { page: 'troubleshoot' })),
        link('Firewall notification settings', () => go('settings')), link('Restore firewalls to default', async () => { if (await Dialog.confirm('Restore default settings?', 'This removes every app and port you allowed, and turns the firewall on for both kinds of network.', { ok: 'Restore defaults', within: api.win })) act(() => Native.call('firewallSet', { what: 'reset', label: 'Restored defaults' }), 'Firewall settings restored'); })));
      if (st.network) box.append(section('Your network', h('p', {}, `${st.network.name}: ${st.network.profile === 'private' ? 'Private network' : 'Public network'}`),
        h('p', { class: 'muted', text: 'Make a network Private only at home or at work, where you trust the people and devices on it.' }),
        h('div', { class: 'sec-row' }, h('button', { class: 'btn', text: st.network.profile === 'private' ? 'Make it Public' : 'Make it Private', onclick: () => act(() => Native.call('networkProfile', { profile: st.network.profile === 'private' ? 'public' : 'private' })) }))));
    },
    fwprofile(box, st, params) {
      const id = params.profile === 'private' ? 'private' : 'public';
      const name = id === 'private' ? 'Private network' : 'Public network';
      box.append(header(id === 'private' ? 'home' : 'globe', name, id === 'private' ? 'Networks at home or work, where you know and trust the people and devices on the network.' : 'Networks in public places such as airports or coffee shops.'));
      const fw = st.firewall;
      const activeHere = st.network && st.network.profile === id;
      box.append(section('Active ' + name.toLowerCase() + 's', h('p', { text: activeHere ? st.network.name : 'Not connected' })));
      box.append(WS.group('Firewall',
        WS.card(ctx, { icon: 'globeShield', title: 'Firewall', desc: 'Helps protect your device while on a ' + name.toLowerCase() + '.', ctl: WS.toggle(ctx, () => (SecState.st || st).firewall.enabled[id] !== false, (v) => act(() => Native.call('firewallSet', { what: 'enabled', profile: id, on: v, label: name + ' firewall ' + (v ? 'on' : 'off') }))) }),
        WS.card(ctx, { icon: 'shieldProhibited', title: 'Incoming connections', desc: 'Blocks all incoming connections, including those in the list of allowed apps.', ctl: WS.checkbox(ctx, 'Block all incoming connections', () => !!(SecState.st || st).firewall.block[id], (v) => act(() => Native.call('firewallSet', { what: 'block', profile: id, on: v, label: 'Block all incoming: ' + (v ? 'on' : 'off') }))) })));
      if (fw.enabled[id] === false) box.prepend(status('bad', 'The firewall is off for ' + name.toLowerCase() + 's.'));
    },
    fwapps(box, st) {
      box.append(header('globeShield', 'Allowed apps', 'Allow apps to be reached through the firewall. Most apps don’t need this: only those that others connect to, like hosting a game or streaming one to another PC.'));
      const table = h('div', { class: 'sec-table', role: 'table' }, h('div', { class: 'sec-tr head', role: 'row' }, h('span', { text: 'Name' }), h('span', { text: 'Ports' }), h('span', { text: 'Private' }), h('span', { text: 'Public' }), h('span')));
      for (const a of st.firewall.apps) {
        const cb = (profile) => { const c = h('input', { type: 'checkbox', checked: !!a[profile], 'aria-label': a.name + ' on ' + profile + ' networks' }); c.addEventListener('change', () => act(() => Native.call('firewallSet', { what: 'app', app: a.id, profile, on: c.checked, label: a.name }))); return c; };
        table.append(h('div', { class: 'sec-tr', role: 'row' }, h('span', { text: a.name }), h('span', { class: 'muted', text: a.ports }), cb('private'), cb('public'),
          a.custom ? h('button', { class: 'sec-link', text: 'Remove', onclick: () => act(() => Native.call('firewallSet', { what: 'port', remove: true, app: a.id, label: 'Removed ' + a.name })) }) : h('span')));
      }
      const addPort = h('button', { class: 'btn', text: 'Allow another port…', onclick: async () => {
        const name = h('input', { class: 'field', placeholder: 'Name (like My game server)', style: 'width:100%' });
        const ports = h('input', { class: 'field', placeholder: 'Port or range (like 7777 or 27000:27050)', style: 'width:100%' });
        const proto = h('select', { class: 'field' }, h('option', { value: 'both', text: 'TCP and UDP' }), h('option', { value: 'tcp', text: 'TCP' }), h('option', { value: 'udp', text: 'UDP' }));
        const ok = await Dialog.show({ title: 'Allow a port', within: api.win, cancelValue: false, content: h('div', { class: 'sec-form' }, name, ports, proto),
          buttons: [{ label: 'Add', primary: true, value: true }, { label: 'Cancel', value: false }] });
        if (ok) act(() => Native.call('firewallSet', { what: 'port', ports: ports.value.trim(), proto: proto.value, name: name.value.trim(), label: 'Allowed port ' + ports.value.trim() }), 'Port allowed on private networks');
      } });
      box.append(table, h('div', { class: 'sec-row' }, addPort));
    },
    appbrowser(box, st) {
      box.append(header('windowShield', 'App & browser control', 'App and browser protection, including settings and overrides.'));
      const pref = (key) => WS.toggle(ctx, () => !!(SecState.st || st).prefs[key], (v) => act(() => Native.call('securityPrefs', { set: { [key]: v } })), key);
      box.append(WS.group('Reputation-based protection',
        WS.card(ctx, { icon: 'download', title: 'Check apps and files', desc: 'Scans files you download as soon as they arrive, even with real-time protection off.', ctl: pref('downloads') }),
        WS.card(ctx, { icon: 'bug', title: 'Potentially unwanted app blocking', desc: 'Find apps that can cause unexpected behaviors: adware, bundled installers, miners.', ctl: pref('pua') }),
        WS.card(ctx, { icon: 'download', title: 'Block downloads', desc: 'Also check downloads for potentially unwanted apps.', ctl: pref('puaDownloads') })));
      box.append(WS.group('Safe browsing',
        WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon(APPS.chrome.icon)}</span>`, title: 'Google Chrome’s Safe Browsing', desc: 'Chrome warns you about dangerous sites and downloads. Choose its protection level in Chrome’s settings.', ctl: WS.button('Open Chrome settings', () => Apps.launch('chrome', { url: 'chrome://settings/security' })) })));
      box.append(WS.group('Exploit protection', WS.card(ctx, { icon: 'shieldTask', title: 'Exploit protection', desc: 'Protection against attacks, built into the processor and the system.', go: 'exploit' })));
    },
    async exploit(box) {
      box.append(header('shieldTask', 'Exploit protection', 'See which protections against attacks are on for your device. They’re set by the system and the processor.'));
      const d = await Native.call('securityDevice');
      box.append(WS.group(null, ...d.mitigations.map((m) => WS.card(ctx, { icon: m.on ? 'checkCircle' : 'warning', title: m.name, desc: m.desc, ctl: h('span', { class: 'ws-d', text: m.on ? 'On' : 'Off' }) }))));
    },
    async device(box) {
      box.append(header('laptop', 'Device security', 'Security that comes built into your device.'));
      const d = await Native.call('securityDevice');
      box.append(section('Core isolation', h('p', { class: 'muted', text: 'Protects the core of the system (the kernel) from changes, even by programs running as administrator.' }),
        d.lockdown !== 'none' ? status('ok', 'Kernel lockdown is on (' + d.lockdown + ').') : status('info', 'Kernel lockdown is off. It turns on with Secure Boot.')));
      box.append(section('Security processor', d.tpm.present ? status('ok', 'Your security processor, called the trusted platform module (TPM' + (d.tpm.version ? ' ' + d.tpm.version : '') + '), is providing additional encryption for your device.') : status('info', 'This device has no security processor (TPM), or it’s turned off in the firmware settings.'),
        d.tpm.present && d.tpm.name ? h('p', { class: 'muted', text: d.tpm.name }) : null));
      box.append(section('Secure boot', !d.uefi ? status('info', 'Secure boot isn’t available: this device started in legacy (BIOS) mode.') : d.secureBoot.on ? status('ok', 'Secure boot is on, preventing malicious software from loading when your device starts up.') : status('info', 'Secure boot is off. Turn it on in your device’s firmware (UEFI) settings to keep malicious software from loading at startup.'),
        d.uefi ? link('Restart to firmware settings', () => WM.open('settings', { page: 'recovery' })) : null));
      box.append(h('p', { class: 'muted sec-foot', text: d.tpm.present && d.secureBoot.on ? 'Your device meets the requirements for standard hardware security.' : 'Your device doesn’t meet all the requirements for standard hardware security.' }));
    },
    async health(box) {
      box.append(header('heartPulse', 'Device performance & health', 'Check the health of your device.'));
      const items = await Native.call('securityHealth');
      box.append(section('Health report', h('p', { class: 'muted', text: 'Last scan: ' + secDate(Math.floor(Date.now() / 1000)) }),
        h('div', { class: 'sec-health' }, items.map((i) => h('div', { class: 'sec-hrow' }, h('span', { html: secBadge(i.ok ? 'ok' : 'warn') }), h('b', { text: i.title }), h('span', { class: 'muted', text: i.ok ? 'No issues' : i.desc }), h('span', { class: 'muted small', text: i.ok ? i.desc : '' }))))));
      box.append(section('Fresh start', h('p', { class: 'muted', text: 'Start fresh with a clean installation of Nimbus. Your files and some settings are kept.' }), link('Additional info', () => WM.open('settings', { page: 'recovery' }))));
    },
    async history(box) {
      box.append(header('history', 'Protection history', 'View the latest protection actions and recommendations from Nimbus Security.'));
      let filter = 'all';
      const items = await Native.call('securityHistory');
      const list = h('div', { class: 'sec-hist' });
      const FILTERS = [['all', 'All recent items'], ['quarantined', 'Quarantined items'], ['removed', 'Removed or restored items'], ['threat', 'Threats'], ['scan', 'Scans'], ['other', 'Updates and firewall']];
      const sel = h('select', { class: 'field', 'aria-label': 'Filter' }, FILTERS.map(([v, l]) => h('option', { value: v, text: l })));
      sel.addEventListener('change', () => { filter = sel.value; paint(); });
      const paint = () => {
        const shown = items.filter((e) => filter === 'all' || (filter === 'quarantined' && e.status === 'quarantined') || (filter === 'removed' && ['removed', 'allowed'].includes(e.status)) || e.kind === filter || (filter === 'other' && ['update', 'firewall'].includes(e.kind)));
        list.replaceChildren(...(shown.length ? shown.map(histItem) : [h('p', { class: 'muted', text: 'No recent items.' })]));
      };
      box.append(h('div', { class: 'sec-row sec-between' }, sel, link('Clear history', async () => { await Native.call('securityClearHistory'); go('history', {}, true); })), list);
      paint();
    },
    settings(box, st) {
      box.append(header('settings', 'Settings', 'Notifications and information about Nimbus Security.'));
      box.append(WS.group('Notifications', WS.card(ctx, { icon: 'notifications', title: 'Informational notifications', desc: 'Get notified when scans finish and about other recent activity. Threats are always reported.', ctl: WS.toggle(ctx, () => !!(SecState.st || st).prefs.notify, (v) => act(() => Native.call('securityPrefs', { set: { notify: v } })), 'Informational notifications') })));
      box.append(WS.group('About', WS.card(ctx, { icon: 'info', title: 'Nimbus Security', desc: [`Antimalware engine: ClamAV ${st.engine || 'not installed'}`, `Security intelligence: ${st.defs.present ? st.defs.version + ' (' + secDate(st.defs.updated) + ')' : 'not downloaded'}`, 'Firewall: ufw'].join(' · ') })));
    },
  };
  function histItem(e) {
    const level = e.kind === 'threat' ? (e.status === 'active' ? 'bad' : e.status === 'quarantined' ? 'warn' : 'ok') : e.status === 'failed' ? 'warn' : 'ok';
    const title = e.kind === 'threat' ? ({ active: 'Threat found', quarantined: 'Threat quarantined', removed: 'Threat removed', allowed: 'Threat allowed' }[e.status] || 'Threat') : e.title;
    const body = h('div', { class: 'sec-hbody', hidden: true });
    if (e.kind === 'threat') {
      body.append(h('dl', { class: 'sec-dl' }, h('dt', { text: 'Detected' }), h('dd', { text: e.threat }), h('dt', { text: 'Category' }), h('dd', { text: e.category || '' }),
        h('dt', { text: 'Severity' }), h('dd', { text: (e.severity || '').replace(/^\w/, (c) => c.toUpperCase()) }), h('dt', { text: 'Status' }), h('dd', { text: { active: 'Active', quarantined: 'Quarantined', removed: 'Removed', allowed: 'Allowed' }[e.status] || e.status }),
        h('dt', { text: 'Found by' }), h('dd', { text: e.source === 'realtime' ? 'Real-time protection' : (e.source || 'Scan').replace(/^\w/, (c) => c.toUpperCase()) + ' scan' }),
        h('dt', { text: 'Affected item' }), h('dd', { text: e.path || '' })), e.detail ? h('p', { class: 'muted', text: e.detail }) : null);
      if (['active', 'quarantined'].includes(e.status)) body.append(h('div', { class: 'sec-row' }, h('button', { class: 'btn', text: 'Actions', onclick: (ev) => threatMenu(e, ev.currentTarget) })));
    } else body.append(h('p', { class: 'muted', text: e.detail || '' }));
    const head = h('button', { class: 'sec-hhead', 'aria-expanded': 'false' }, h('span', { html: secBadge(level) }), h('div', {}, h('b', { text: title }), h('span', { class: 'muted', text: secDate(e.time) + (e.kind === 'threat' ? ' · ' + (e.severity || '').replace(/^\w/, (c) => c.toUpperCase()) : '') })), h('span', { class: 'sec-chev', html: fi('chevronDown') }));
    head.addEventListener('click', () => { body.hidden = !body.hidden; head.setAttribute('aria-expanded', String(!body.hidden)); });
    return h('div', { class: 'sec-hitem ' + level }, head, body);
  }
  async function quickFix(id) {
    const st = SecState.st;
    if (id === 'virus') {
      if (st.activeThreats.length) return act(() => Native.call('securityActAll'), 'Threats moved to quarantine');
      if (!st.defs.present || (st.defs.updated && Date.now() / 1000 - st.defs.updated > 3 * 86400)) { go('updates'); return; }
      if (!st.prefs.realtime) return act(() => Native.call('securityPrefs', { set: { realtime: true } }));
    }
    if (id === 'firewall') { const p = (st.network && st.network.profile) || 'public'; return act(() => Native.call('firewallSet', { what: 'enabled', profile: p, on: true, label: 'Firewall on' }), 'The firewall is on'); }
    if (id === 'appbrowser') return act(() => Native.call('securityPrefs', { set: { downloads: true, pua: true } }));
  }
  api.onArgs = (a) => { if (a && a.page) go(a.page, a); };
  const every = setInterval(() => { if (root.isConnected && page && ['home', 'virus', 'firewall'].includes(page.id)) secStatus(true).then(() => { if (page && ['home'].includes(page.id)) rerender(); }).catch(() => {}); }, 15000);
  api.onClose(() => clearInterval(every));
  go(args && args.page ? args.page : 'home', args || {});
}

/* Boot test (nimbus.test=security): ClamAV with a harmless test signature (no 230 MB download): real-time
   protection on a new download, a quick scan, quarantine, restore and remove; the firewall and network profiles;
   device security; and a virtual DualSense for Settings > Game controllers. Results go to the system log,
   which os/qmp.py reads (it also takes the screenshots, at each "page" line). */
async function testSecurity() {
  const log = (text) => Native.call('log', { text: 'test security: ' + text }).catch(() => {});
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(500); } };
  const once = (evt, test, ms) => new Promise((resolve) => { const off = bus.on(evt, (d) => { if (test(d)) { off(); resolve(d); } }); setTimeout(() => { off(); resolve(null); }, ms); });
  try {
    await Native.call('securityTestSetup');
    let st = await secStatus(true);
    log(`engine ${st.engine || 'missing'} definitions ${st.defs.present ? st.defs.version + ' (' + st.defs.sigs + ' signatures)' : 'missing'} realtime ${st.realtime}`);
    log(`firewall ${st.firewall.available ? (st.firewall.active ? 'active' : 'inactive') : 'unavailable: ' + st.firewall.error} network ${st.network ? st.network.profile : 'none'}`);
    WM.open('security', { page: 'home' });
    await sleep(2500);
    log('page home');
    // Real-time protection: a "download" arrives
    const alert = once('native:security-alert', (d) => !!(d && d.threats && d.threats.length), 180000);
    await Native.call('securityTestFile', { folder: '~/Downloads', name: 'free-game-installer.com' });
    const a = await alert;
    log(a ? `realtime found ${a.threats.length} ${a.threats[0].threat} ${a.auto ? 'and quarantined it' : 'and reported it'}` : 'realtime found nothing');
    await sleep(2500);
    log('page alert');
    // A quick scan finds another copy in /tmp
    await Native.call('securityTestFile', { folder: '/tmp', name: 'invoice.pdf.com' });
    WM.open('security', { page: 'virus' });
    const scanning = once('native:security-scan', (s) => s && s.kind === 'quick' && s.state === 'scanning', 120000);
    const scanP = Native.call('securityScan', { kind: 'quick' }, 900000);
    if (await scanning) log('page scanning');
    const scan = await scanP;
    SecState.scan = scan; bus.emit('security-scan', scan);
    log(`quick scan ${scan.state}: ${scan.scanned} files, ${scan.threats.length} threats${scan.error ? ' (' + scan.error + ')' : ''}`);
    st = await secStatus(true);
    WM.open('security', { page: 'virus' });
    await sleep(2500);
    log(`page threats (${st.activeThreats.length} active)`);
    const n = await Native.call('securityActAll');
    st = await secStatus(true);
    log(`start actions: ${n} quarantined, ${st.activeThreats.length} still active, ${st.quarantined} in quarantine`);
    const hist = await Native.call('securityHistory');
    const q = hist.filter((e) => e.kind === 'threat' && e.status === 'quarantined');
    if (q[0]) log('remove: ' + (await Native.call('securityAction', { id: q[0].id, action: 'remove' })).status);
    if (q[1]) log('restore: ' + (await Native.call('securityAction', { id: q[1].id, action: 'restore' })).status);
    st = await secStatus(true);
    log(`history ${hist.length} items, allowed ${st.prefs.allowed.length}, quarantine ${st.quarantined}`);
    WM.open('security', { page: 'history' });
    await sleep(2500);
    log('page history');
    // The firewall: block everything on public networks, then back; this network made private
    let fw = (await Native.call('firewallSet', { what: 'block', profile: 'public', on: true, label: 'test' }));
    log(`firewall block public ${fw.block && fw.block.public} active ${fw.active}`);
    fw = await Native.call('firewallSet', { what: 'block', profile: 'public', on: false, label: 'test' });
    log(`firewall unblock public ${fw.block && !fw.block.public}`);
    const net = (await Native.call('firewallStatus')).network;
    if (net) {
      await Native.call('networkProfile', { profile: 'private' });
      fw = (await Native.call('firewallStatus')).firewall;
      log(`firewall network ${net.name} now ${fw.profile}, steam remote play allowed ${fw.apps.find((x) => x.id === 'steam-remote-play').private}`);
      await Native.call('networkProfile', { profile: 'public' });
    } else log('firewall network none');
    WM.open('security', { page: 'firewall' });
    await sleep(2500);
    log('page firewall');
    const dev = await Native.call('securityDevice');
    log(`device secure boot ${dev.uefi ? (dev.secureBoot.on ? 'on' : 'off') : 'n/a'}, tpm ${dev.tpm.present ? dev.tpm.version || 'yes' : 'none'}, lockdown ${dev.lockdown}, mitigations ${dev.mitigations.filter((m) => m.on).length}/${dev.mitigations.length}`);
    WM.open('security', { page: 'device' });
    await sleep(2500);
    log('page device');
    // A game controller: a virtual DualSense appears, its Cross button is pressed
    await Native.call('controllerTest', { action: 'plug' });
    const pad = await until(async () => (await Native.call('controllers')).find((p) => /Nimbus Test/.test(p.name)), 20000);
    log(pad ? `controller ${pad.name}: ${pad.model} (${pad.family}) over ${pad.connection}` : 'controller not found');
    if (pad) {
      WM.open('settings', { page: 'controllers' });
      await sleep(3500);
      const btn = [...document.querySelectorAll('.ws-card')].find((c) => c.textContent.includes('Nimbus Test'))?.querySelector('.ws-ctl button:last-child');
      if (btn) btn.click(); else await Native.call('controllerWatch', { id: pad.id, on: true });
      await sleep(1200);
      const pressed = once('native:controller-input', (s) => !!(s && s.buttons && s.buttons.south), 15000);
      await Native.call('controllerTest', { action: 'press' });
      const s = await pressed;
      log(s ? `controller input: Cross pressed, left stick x ${s.axes.lx}` : 'controller input not seen');
      await sleep(150);
      log('page controllers');
      await sleep(1500);
      await Native.call('controllerWatch', { on: false });
      await Native.call('controllerTest', { action: 'unplug' });
    }
    log('done');
  } catch (e) { log('failed: ' + e.message); }
}
