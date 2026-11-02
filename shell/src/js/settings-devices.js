/* ========== Settings: Bluetooth & devices, Network & internet ========== */
const BT_ICON = { 'audio-headset': 'headphones', 'audio-headphones': 'headphones', 'audio-card': 'sound', 'input-mouse': 'mouse', 'input-keyboard': 'keyboard', 'input-gaming': 'gamepad', 'input-tablet': 'pen', phone: 'phone', computer: 'laptop', 'camera-video': 'camera', printer: 'printer' };
const btIcon = (d) => BT_ICON[d.icon] || 'bluetooth';
const btState = (d) => (d.busy ? d.busy : d.connected ? 'Connected' : d.paired ? 'Paired' : 'Not paired') + (d.battery != null ? ` · ${d.battery}%` : '');
async function btAction(action, d, extra) {
  d.busy = { connect: 'Connecting…', disconnect: 'Disconnecting…', remove: 'Removing…', pair: 'Pairing…' }[action] || '';
  bus.emit('sys', 'bluetooth');
  try { await Sys.bt.do(Object.assign({ action, address: d.address }, extra)); }
  catch (e) { Notif.push({ app: 'settings', title: action === 'pair' ? 'Couldn’t pair ' + d.name : 'Bluetooth', body: e.message, silent: true }); }
  finally { d.busy = ''; await Sys.bt.refresh(); }
}
function btMenu(d, anchor) {
  Menu.show([
    d.connected ? { label: 'Disconnect', icon: 'x', action: () => btAction('disconnect', d) } : { label: 'Connect', icon: 'bluetooth', action: () => btAction('connect', d) },
    'sep', { label: 'Remove device', icon: 'trash', action: () => btAction('remove', d) },
  ], 0, 0, { anchorEl: anchor });
}

/* "Add a device": Bluetooth pairing, like Windows' dialog */
function addDeviceDialog(ctx) {
  const body = h('div', { class: 'ws-adddev' });
  let finish = null, poll = 0, scanning = false, foot = null;
  const setButton = (label) => { const b = foot && foot.querySelector('button'); if (b) b.textContent = label; };
  const stop = () => { clearInterval(poll); if (scanning) { scanning = false; Sys.bt.do({ action: 'scan', on: false }).catch(() => {}); } };
  const option = (icon, title, desc, run) => { const b = h('button', { class: 'ws-adddev-opt', html: `<span class="ws-adddev-ic">${fi(icon)}</span><span><b>${esc(title)}</b><span class="ws-d">${esc(desc)}</span></span>` }); b.addEventListener('click', run); return b; };
  function choose() {
    body.replaceChildren(h('p', { class: 'ws-d', text: 'Choose the kind of device you want to add.' }),
      option('bluetooth', 'Bluetooth', 'Mice, keyboards, pens, headphones, speakers, controllers and other Bluetooth devices', bluetooth),
      option('printer', 'Everything else', 'Printers and scanners on your network or plugged into this PC', () => { finish(null); ctx.go('printers'); }));
  }
  async function bluetooth() {
    if (!IS_NATIVE || !Sys.bt.st.available) { body.replaceChildren(WS.info('warning', 'Bluetooth isn’t available', IS_NATIVE ? 'This PC has no Bluetooth adapter, or it is switched off with a hardware switch.' : 'Bluetooth works when Nimbus runs on a computer.')); return; }
    const list = h('div', { class: 'ws-adddev-list' });
    const note = h('p', { class: 'ws-d', text: 'Make sure your device is turned on and discoverable. Select a device below to connect.' });
    body.replaceChildren(h('h3', { class: 'ws-adddev-h', text: 'Add a device' }), note, list);
    if (!Sys.bt.st.powered) await Sys.bt.do({ action: 'power', on: true }).catch(() => {});
    try { await Sys.bt.do({ action: 'scan', on: true }); scanning = true; } catch (e) { note.textContent = e.message; }
    const paint = () => {
      const found = Sys.bt.st.devices.filter((d) => !d.paired && d.name).sort((a, b) => (b.rssi || -999) - (a.rssi || -999));
      list.replaceChildren(...found.map((d) => { const b = option(btIcon(d), d.name, d.busy || 'Bluetooth', () => pair(d)); b.disabled = !!d.busy; return b; }));
      list.append(h('div', { class: 'ws-adddev-searching', html: `<span class="ws-spinner"></span><span>Searching for devices…</span>` }));
    };
    paint();
    poll = setInterval(() => Sys.bt.refresh().then(paint), 2000);
  }
  async function pair(d) {
    clearInterval(poll);
    body.replaceChildren(h('h3', { class: 'ws-adddev-h', text: 'Connecting to ' + d.name }), h('div', { class: 'ws-adddev-searching', html: `<span class="ws-spinner"></span><span>If your device asks for a PIN, accept it there.</span>` }));
    try {
      await Sys.bt.do({ action: 'pair', address: d.address });
      stop(); await Sys.bt.refresh();
      body.replaceChildren(h('div', { class: 'ws-adddev-done', html: `<span class="ws-adddev-ic big">${fi(btIcon(d))}</span>` }, h('h3', { text: 'Your device is ready to go!' }), h('p', { class: 'ws-d', text: d.name + ' is connected.' })));
      setButton('Done');
    } catch (e) {
      body.replaceChildren(WS.info('error', 'Couldn’t connect', e.message), h('div', { class: 'ws-actions' }, WS.button('Try again', () => bluetooth())));
    }
  }
  choose();
  Dialog.show({ title: 'Add a device', content: body, within: ctx.win, cancelValue: null, buttons: [{ label: 'Cancel', value: null }], onOpen: (box, f) => { finish = f; foot = box.querySelector('.modal-foot'); box.classList.add('ws-dialog'); } }).then(stop);
}

/* ---------- Bluetooth & devices ---------- */
function deviceTiles(ctx) {
  const box = h('div', { class: 'ws-devtiles' });
  const paint = () => {
    const devs = (Sys.bt.st.devices || []).filter((d) => d.paired);
    const tiles = devs.map((d) => {
      const more = h('button', { class: 'ws-iconbtn ws-devtile-more', 'aria-label': 'More options for ' + d.name, html: fi('more') });
      more.addEventListener('click', (e) => { e.stopPropagation(); btMenu(d, more); });
      return h('div', { class: 'ws-devtile' + (d.connected ? ' on' : '') }, frag(`<span class="ws-devtile-ic">${fi(btIcon(d))}</span>`), h('div', { class: 'ws-txt' }, h('div', { class: 'ws-t', text: d.name }), h('div', { class: 'ws-d', text: btState(d) })), more);
    });
    const add = h('button', { class: 'ws-devtile add', html: `<span class="ws-devtile-ic">${fi('add')}</span><span class="ws-t">Add device</span>` });
    add.addEventListener('click', () => addDeviceDialog(ctx));
    box.replaceChildren(...tiles, add);
  };
  ctx.on('sys', (n) => { if (n === 'bluetooth') paint(); }); paint();
  return box;
}
defPage('devices', { title: 'Bluetooth & devices', icon: 'devices', keywords: 'bluetooth pair headphones mouse keyboard printer camera', render: (ctx) => {
  const st = Sys.bt.st;
  const btDesc = () => (!IS_NATIVE ? 'Works when Nimbus runs on a computer' : !Sys.bt.st.available ? 'This PC has no Bluetooth adapter' : Sys.bt.st.powered ? `Discoverable as “${Sys.bt.st.name || pcName()}”` : 'Off');
  const desc = h('span'); ctx.sync(() => { desc.textContent = btDesc(); }); desc.textContent = btDesc();
  if (IS_NATIVE && !Sys.bt.ready) Sys.bt.refresh();
  return [
    IS_NATIVE && st.available ? deviceTiles(ctx) : null,
    WS.group(null,
      WS.card(ctx, { sid: 'bluetooth', icon: 'bluetooth', title: 'Bluetooth', desc, ctl: WS.toggle(ctx, () => Sys.bt.st.powered, async (v) => { await Sys.bt.do({ action: 'power', on: v }).catch((e) => Notif.push({ app: 'settings', title: 'Bluetooth', body: e.message, silent: true })); await Sys.bt.refresh(); }, 'Bluetooth', { disabled: () => !Sys.bt.st.available }) }),
      WS.card(ctx, { icon: 'devices', title: 'Devices', desc: 'Mouse, keyboard, audio, displays and other devices', go: 'devicesall' }),
      WS.card(ctx, { icon: 'printer', title: 'Printers & scanners', desc: 'Preferences, troubleshoot', go: 'printers' }),
      WS.card(ctx, { icon: 'camera', title: 'Cameras', desc: 'Connected cameras, default image settings', go: 'cameras' }),
      WS.card(ctx, { icon: 'controller', title: 'Game controllers', desc: 'Xbox, PlayStation, Switch Pro and others: battery, test, pairing', go: 'controllers' }),
      WS.card(ctx, { icon: 'mouse', title: 'Mouse', desc: 'Buttons, mouse pointer speed, scrolling', go: 'mouse' }),
      Sys.input.st.touchpad || !IS_NATIVE ? WS.card(ctx, { icon: 'touchpad', title: 'Touchpad', desc: 'Taps, gestures, scrolling, zooming', go: 'touchpad' }) : null,
      WS.card(ctx, { icon: 'keyboard', title: 'Keyboard', desc: 'Layout, repeat delay and speed', go: 'typing' })),
  ];
} });
defSettings('devices', [['bluetooth', 'Bluetooth', 'turn on off pair wireless']]);

/* ---------- Game controllers: what's connected, batteries, a live test, rumble, pairing ---------- */
const PAD_LABELS = {
  playstation: { south: '✕', east: '○', west: '□', north: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', select: 'Create', start: 'Options', home: 'PS', ls: 'L3', rs: 'R3' },
  xbox: { south: 'A', east: 'B', west: 'X', north: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', select: 'View', start: 'Menu', home: 'Guide', ls: 'LS', rs: 'RS' },
  nintendo: { south: 'B', east: 'A', west: 'Y', north: 'X', lb: 'L', rb: 'R', lt: 'ZL', rt: 'ZR', select: '−', start: '+', home: 'Home', ls: 'LS', rs: 'RS' },
};
// A gamepad drawn generically (not any maker's shape), its parts named like the kernel's buttons
function padSvg(fam) {
  const L = PAD_LABELS[fam] || PAD_LABELS.xbox;
  const sym = fam === 'playstation'; // sticks side by side below the buttons, as on PlayStation pads
  const ls = sym ? [128, 168] : [96, 108], rs = sym ? [232, 168] : [222, 160], dp = sym ? [92, 108] : [128, 160], fb = [262, 108];
  const btn = (id, x, y, label) => `<g class="gp-b" data-b="${id}"><circle cx="${x}" cy="${y}" r="11"/><text x="${x}" y="${y + 4}">${esc(label)}</text></g>`;
  return `<svg class="gp-svg" viewBox="0 0 360 230" role="img" aria-label="Controller test">
  <path class="gp-body" d="M70 52h220c30 0 46 22 54 58l14 70c6 28-12 46-34 46-16 0-26-10-34-26l-14-28H84l-14 28c-8 16-18 26-34 26-22 0-40-18-34-46l14-70c8-36 24-58 54-58z"/>
  <g class="gp-b gp-sh" data-b="lb"><rect x="58" y="30" width="62" height="16" rx="8"/><text x="89" y="42">${esc(L.lb)}</text></g>
  <g class="gp-b gp-sh" data-b="rb"><rect x="240" y="30" width="62" height="16" rx="8"/><text x="271" y="42">${esc(L.rb)}</text></g>
  <g class="gp-trig" data-a="lt"><rect x="58" y="6" width="62" height="18" rx="5"/><rect class="gp-fill" x="58" y="6" width="0" height="18" rx="5"/><text x="89" y="19">${esc(L.lt)}</text></g>
  <g class="gp-trig" data-a="rt"><rect x="240" y="6" width="62" height="18" rx="5"/><rect class="gp-fill" x="240" y="6" width="0" height="18" rx="5"/><text x="271" y="19">${esc(L.rt)}</text></g>
  <g class="gp-stick" data-s="l"><circle cx="${ls[0]}" cy="${ls[1]}" r="24"/><circle class="gp-dot" data-b="ls" cx="${ls[0]}" cy="${ls[1]}" r="12"/></g>
  <g class="gp-stick" data-s="r"><circle cx="${rs[0]}" cy="${rs[1]}" r="24"/><circle class="gp-dot" data-b="rs" cx="${rs[0]}" cy="${rs[1]}" r="12"/></g>
  <g class="gp-dpad"><path class="gp-b" data-b="up" d="M${dp[0] - 8} ${dp[1] - 30}h16v20h-16z"/><path class="gp-b" data-b="down" d="M${dp[0] - 8} ${dp[1] + 10}h16v20h-16z"/>
    <path class="gp-b" data-b="left" d="M${dp[0] - 30} ${dp[1] - 8}h20v16h-20z"/><path class="gp-b" data-b="right" d="M${dp[0] + 10} ${dp[1] - 8}h20v16h-20z"/></g>
  ${btn('north', fb[0], fb[1] - 24, L.north)}${btn('south', fb[0], fb[1] + 24, L.south)}${btn('west', fb[0] - 24, fb[1], L.west)}${btn('east', fb[0] + 24, fb[1], L.east)}
  <g class="gp-b gp-sm" data-b="select"><rect x="146" y="80" width="26" height="12" rx="6"/></g><g class="gp-b gp-sm" data-b="start"><rect x="188" y="80" width="26" height="12" rx="6"/></g>
  <g class="gp-b gp-home" data-b="home"><circle cx="180" cy="116" r="11"/></g>
  <text class="gp-cap" x="159" y="104">${esc(L.select)}</text><text class="gp-cap" x="201" y="104">${esc(L.start)}</text></svg>`;
}
defPage('controllers', { title: 'Game controllers', parent: 'devices', icon: 'controller', keywords: 'gamepad joystick xbox playstation ps5 ps4 ps3 dualsense dualshock switch pro joy-con steam controller 8bitdo test vibration rumble battery', render: (ctx) => {
  const list = h('div', { class: 'ws-cards' });
  const tester = h('div', { class: 'gp-test', hidden: true });
  let pads = [], testing = null, sig = '';
  const test = (p) => {
    if (testing === p.id) { testing = null; tester.hidden = true; Native.call('controllerWatch', { on: false }).catch(() => {}); paint(); return; }
    testing = p.id;
    tester.replaceChildren(h('div', { class: 'gp-head' }, h('b', { text: 'Testing ' + p.name }), h('span', { class: 'ws-d', text: 'Press buttons and move the sticks: they light up here.' })), frag(padSvg(p.family)));
    tester.hidden = false;
    Native.call('controllerWatch', { id: p.id, on: true }).catch((e) => Notif.push({ app: 'settings', title: 'Controller test', body: e.message, silent: true }));
    paint();
  };
  const show = (st) => {
    if (!st || st.id !== testing || tester.hidden) return;
    if (st.gone) { test({ id: testing }); return; }
    const svg = tester.querySelector('svg'); if (!svg) return;
    const b = Object.assign({}, st.buttons || {}), a = st.axes || {};
    if ('hatx' in a) { b.left = a.hatx < 0; b.right = a.hatx > 0; }
    if ('haty' in a) { b.up = a.haty < 0; b.down = a.haty > 0; }
    svg.querySelectorAll('[data-b]').forEach((el) => el.classList.toggle('on', !!b[el.dataset.b]));
    for (const [side, x, y] of [['l', 'lx', 'ly'], ['r', 'rx', 'ry']]) {
      const g = svg.querySelector(`[data-s="${side}"]`); if (!g) continue;
      g.querySelector('.gp-dot').setAttribute('transform', `translate(${(a[x] || 0) * 12} ${(a[y] || 0) * 12})`);
    }
    for (const t of ['lt', 'rt']) { const f = svg.querySelector(`[data-a="${t}"] .gp-fill`); if (f) f.setAttribute('width', String(Math.round(62 * Math.max(a[t] || 0, b[t] ? 1 : 0)))); }
  };
  const paint = async () => {
    if (IS_NATIVE) { try { pads = (await Native.call('controllers')) || []; } catch { pads = []; } }
    const key = JSON.stringify(pads) + testing;
    if (key === sig) return;
    sig = key;
    list.replaceChildren(...(pads.length ? pads.map((p) => WS.card(ctx, { iconHtml: WS.ic('controller'), title: p.name,
      desc: [p.model !== p.name ? p.model : '', p.connection, p.battery && p.battery.level != null ? `Battery ${p.battery.level}%${p.battery.charging ? ', charging' : ''}` : ''].filter(Boolean).join(' · '),
      ctl: h('div', { class: 'ws-row' }, p.rumble ? WS.button('Vibrate', () => Native.call('controllerRumble', { id: p.id }).catch((e) => Notif.push({ app: 'settings', title: 'Vibrate', body: e.message, silent: true }))) : null,
        WS.button(testing === p.id ? 'Stop test' : 'Test', () => test(p))) }))
      : [WS.card(ctx, { icon: 'controller', title: IS_NATIVE ? 'No controllers connected' : 'Works when Nimbus runs on a computer', desc: 'Plug one in with a USB cable, or pair it over Bluetooth (below). It works as soon as it shows up here.' })]));
    if (testing && !pads.some((p) => p.id === testing)) { testing = null; tester.hidden = true; }
  };
  const off = bus.on('native:controller-input', show);
  ctx.onLeave(() => { off(); if (testing) Native.call('controllerWatch', { on: false }).catch(() => {}); });
  ctx.every(2000, paint); paint();
  const how = (title, text) => WS.sub({ title, desc: text });
  return [
    h('p', { class: 'ws-d ws-intro', text: 'Xbox, PlayStation (DualSense, DualShock 4 and 3), Nintendo Switch Pro and Joy-Con, Steam, 8BitDo and most other controllers work over USB and Bluetooth. Steam and games see them as soon as they’re connected.' }),
    WS.group('Connected controllers', list, tester),
    WS.group('Pair a controller over Bluetooth',
      WS.expander(ctx, { icon: 'bluetooth', title: 'How to put a controller in pairing mode', open: true, items: [
        how('PlayStation 5 (DualSense)', 'Hold the Create button and the PS button until the light around the touchpad flashes.'),
        how('PlayStation 4 (DualShock 4)', 'Hold the Share button and the PS button until the light bar flashes.'),
        how('Xbox Wireless Controller', 'Turn it on, then hold the pair button on its top until the Xbox button flashes quickly.'),
        how('Nintendo Switch Pro Controller', 'Hold the small sync button on its top, next to the USB port, until the lights move.'),
        how('Then', 'Choose Add device below, and pick the controller from the list.')] }),
      WS.card(ctx, { icon: 'add', title: 'Add device', desc: 'Find and pair a Bluetooth controller', ctl: WS.button('Add device', () => addDeviceDialog(ctx)), disabled: !Sys.bt.st.available })),
    WS.group('Related',
      WS.card(ctx, { icon: 'gaming', title: 'Gaming', desc: 'Game Mode, captures', go: 'gaming' }),
      caps.programs ? WS.card(ctx, { icon: 'store', title: 'Get Steam', desc: 'Steam Input supports every controller above in Steam’s games', onClick: () => WM.open('store', { app: 'com.valvesoftware.Steam' }) }) : null),
  ];
} });
defSettings('controllers', [['pads', 'Game controllers', 'gamepad controller xbox playstation dualsense test']]);

defPage('devicesall', { title: 'Devices', parent: 'devices', icon: 'devices', keywords: 'connected hardware input audio', render: (ctx) => {
  const btRow = (d) => WS.expander(ctx, { icon: btIcon(d), title: d.name, desc: btState(d), items: [WS.sub({ title: 'Bluetooth device', desc: d.address, ctl: h('div', { class: 'ws-row' }, d.connected ? WS.button('Disconnect', () => btAction('disconnect', d)) : WS.button('Connect', () => btAction('connect', d)), WS.button('Remove device', () => btAction('remove', d))) })] });
  const bt = (Sys.bt.st.devices || []).filter((d) => d.paired);
  const isAudio = (d) => /audio/.test(d.icon || ''), isInput = (d) => /input/.test(d.icon || '');
  const inputs = [
    ...(Sys.input.st.keyboards || []).map((k) => WS.card(ctx, { icon: 'keyboard', title: k.name, desc: 'Keyboard' })),
    ...(Sys.input.st.pointers || []).map((p) => WS.card(ctx, { icon: p.touchpad ? 'touchpad' : 'mouse', title: p.name, desc: p.touchpad ? 'Touchpad' : 'Mouse' })),
    ...bt.filter(isInput).map(btRow)];
  const audio = [...(Sys.sound.st.outputs || []).map((o) => WS.card(ctx, { iconHtml: WS.ic(kindIcon(o)), title: o.name, desc: 'Speakers' + (o.default ? ' · Default' : ''), go: 'sound' })),
    ...(Sys.sound.st.inputs || []).map((o) => WS.card(ctx, { icon: 'mic', title: o.name, desc: 'Microphone' + (o.default ? ' · Default' : ''), go: 'sound' })), ...bt.filter(isAudio).map(btRow)];
  const others = bt.filter((d) => !isAudio(d) && !isInput(d)).map(btRow);
  const displays = (Sys.display.st.outputs || []).map((o) => WS.card(ctx, { icon: 'display', title: o.desc || o.name, desc: `${o.width} × ${o.height}`, go: 'display' }));
  ctx.on('sys', (n) => { if (n === 'bluetooth' || n === 'input') ctx.rerender(); });
  if (!IS_NATIVE) return [needsNimbus()];
  return [
    WS.group(null, WS.card(ctx, { icon: 'add', title: 'Add other devices', ctl: WS.button('Add device', () => addDeviceDialog(ctx)) })),
    inputs.length ? WS.group('Input', inputs) : null,
    audio.length ? WS.group('Audio', audio) : null,
    displays.length ? WS.group('Displays', displays) : null,
    others.length ? WS.group('Other devices', others) : null,
  ];
} });

defPage('printers', { title: 'Printers & scanners', parent: 'devices', icon: 'printer', keywords: 'print scanner cups add printer', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  const list = h('div', { class: 'ws-cards' }, WS.card(ctx, { icon: 'printer', title: 'Looking for printers…' }));
  const found = h('div', { class: 'ws-cards' });
  const act = async (name, action) => { try { await Sys.call('printerDo', { name, action }, 30000); if (action === 'test') Notif.push({ app: 'settings', title: 'Test page sent to ' + name, silent: true }); } catch (e) { Notif.push({ app: 'settings', title: 'Printer', body: e.message }); } load(); };
  async function load() {
    try {
      const r = await Sys.call('printers', {}, 20000);
      list.replaceChildren();
      if (!r.available) { list.append(WS.info('warning', 'The printing service isn’t running', r.error || '')); return; }
      if (!r.printers.length) list.append(WS.card(ctx, { icon: 'printer', title: 'No printers yet', desc: 'Select Add device to find printers on your network or plugged into this PC.' }));
      for (const p of r.printers) list.append(WS.expander(ctx, { icon: 'printer', title: p.name, desc: (p.default ? 'Default · ' : '') + (p.state || 'Ready') + (p.jobs ? ` · ${p.jobs} document${p.jobs === 1 ? '' : 's'} waiting` : ''), items: [
        WS.sub({ title: p.info || p.model || 'Printer', desc: p.uri }),
        WS.sub({ title: 'Printer settings', ctl: h('div', { class: 'ws-row' }, WS.button('Print a test page', () => act(p.name, 'test')), p.default ? null : WS.button('Set as default', () => act(p.name, 'default')), p.jobs ? WS.button('Cancel all documents', () => act(p.name, 'cancel')) : null) }),
        WS.sub({ title: 'Remove this printer', ctl: WS.button('Remove', () => act(p.name, 'remove')) }),
      ] }));
    } catch (e) { list.replaceChildren(WS.info('error', 'Couldn’t list printers', e.message)); }
  }
  async function search(btn) {
    btn.disabled = true; found.replaceChildren(WS.card(ctx, { iconHtml: '<span class="ws-spinner"></span>', title: 'Searching for printers…' }));
    try {
      const r = await Sys.call('printerFind', {}, 60000);
      found.replaceChildren(...r.map((p) => WS.card(ctx, { icon: 'printer', title: p.name, desc: p.info || p.uri, ctl: WS.button('Add device', async (e, b) => { b.disabled = true; b.textContent = 'Adding…'; try { await Sys.call('printerAdd', { uri: p.uri, name: p.name }, 60000); found.replaceChildren(); load(); } catch (err) { b.disabled = false; b.textContent = 'Add device'; Notif.push({ app: 'settings', title: 'Couldn’t add ' + p.name, body: err.message }); } }) })));
      found.append(WS.card(ctx, { icon: 'link', title: 'The printer that I want isn’t listed', ctl: WS.link('Add manually', () => addManually()) }));
    } catch (e) { found.replaceChildren(WS.info('error', 'Couldn’t search for printers', e.message)); }
    btn.disabled = false;
  }
  async function addManually() {
    const uri = h('input', { class: 'ws-input', placeholder: 'ipp://192.168.1.20/ipp/print', style: { width: '100%' }, 'aria-label': 'Printer address' });
    const name = h('input', { class: 'ws-input', placeholder: 'Office printer', style: { width: '100%' }, 'aria-label': 'Printer name' });
    const v = await Dialog.show({ title: 'Add a printer using an address', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { text: 'Printer address (IPP)' }), uri, h('label', { text: 'Name' }), name),
      buttons: [{ label: 'Add', primary: true, value: () => (/^(ipps?|https?|socket|lpd):\/\//.test(uri.value.trim()) ? { uri: uri.value.trim(), name: name.value.trim() || 'Printer' } : undefined) }, { label: 'Cancel', value: null }] });
    if (!v) return;
    try { await Sys.call('printerAdd', v, 60000); load(); } catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t add the printer', body: e.message }); }
  }
  load();
  return [
    WS.group(null, WS.card(ctx, { icon: 'add', title: 'Add a printer or scanner', ctl: WS.button('Add device', (e, b) => search(b), { accent: true }) }), found),
    WS.group('Printers', list),
    WS.group('Printer preferences', WS.card(ctx, { sid: 'printerDefault', icon: 'printer', title: 'Let Nimbus pick the default printer', desc: 'The first printer you add becomes the default', ctl: WS.settingToggle(ctx, 'printerAuto', 'Manage default printer') })),
  ];
} });
defPage('cameras', { title: 'Cameras', parent: 'devices', icon: 'camera', keywords: 'webcam video', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  const box = h('div', { class: 'ws-cards' });
  Sys.call('cameras').then((list) => { box.replaceChildren(...(list.length ? list.map((c) => WS.card(ctx, { icon: 'camera', title: c.name, desc: c.path })) : [WS.card(ctx, { icon: 'cameraOff', title: 'No cameras found', desc: 'Plug in a camera to use it with programs like Chrome.' })])); }).catch((e) => box.replaceChildren(WS.info('error', 'Couldn’t list cameras', e.message)));
  return [WS.group('Connected cameras', box), WS.group('Related settings', WS.card(ctx, { icon: 'privacy', title: 'Camera privacy settings', go: 'cameraperm' }))];
} });

/* ---------- Mouse, touchpad ---------- */
const pointerSpeedFmt = (v) => String(v);
defPage('mouse', { title: 'Mouse', parent: 'devices', icon: 'mouse', keywords: 'pointer speed primary button left right scroll wheel', render: (ctx) => [
  WS.group(null,
    WS.card(ctx, { sid: 'pointerLeft', icon: 'cursorClick', title: 'Primary mouse button', ctl: WS.combo(ctx, [[0, 'Left'], [1, 'Right']], () => (S.data.pointerLeft ? 1 : 0), (v) => S.set('pointerLeft', +v === 1), 'Primary mouse button', { width: 120 }) }),
    WS.card(ctx, { sid: 'pointerSpeed', icon: 'mouse', title: 'Mouse pointer speed', ctl: WS.settingSlider(ctx, 'pointerSpeed', { min: 1, max: 20, fmt: pointerSpeedFmt, label: 'Mouse pointer speed' }) }),
    WS.card(ctx, { sid: 'pointerAccel', icon: 'gauge', title: 'Enhance pointer precision', desc: 'The pointer moves farther when you move the mouse faster', ctl: WS.settingToggle(ctx, 'pointerAccel', 'Enhance pointer precision') })),
  WS.group('Scrolling',
    WS.card(ctx, { sid: 'scrollLines', icon: 'list', title: 'Lines to scroll at a time', ctl: WS.settingSlider(ctx, 'scrollLines', { min: 1, max: 20, label: 'Lines to scroll' }) }),
    WS.card(ctx, { sid: 'mouseNatural', icon: 'sort', title: 'Scrolling direction', ctl: WS.combo(ctx, [[0, 'Down motion scrolls down'], [1, 'Down motion scrolls up']], () => (S.data.mouseNatural ? 1 : 0), (v) => S.set('mouseNatural', +v === 1), 'Scrolling direction', { width: 230 }) })),
  WS.group('Related settings', WS.card(ctx, { icon: 'mouse', title: 'Mouse pointer', desc: 'Pointer size', go: 'pointer' })),
] });
defSettings('mouse', [['pointerLeft', 'Primary mouse button', 'left handed right swap'], ['pointerSpeed', 'Mouse pointer speed', 'sensitivity fast slow'], ['scrollLines', 'Lines to scroll at a time', 'wheel'], ['mouseNatural', 'Scrolling direction', 'natural reverse']]);
defPage('touchpad', { title: 'Touchpad', parent: 'devices', icon: 'touchpad', keywords: 'trackpad tap click scroll gestures', render: (ctx) => [
  WS.group(null,
    WS.expander(ctx, { sid: 'touchpadOn', icon: 'touchpad', title: 'Touchpad', ctl: WS.settingToggle(ctx, 'touchpadOn', 'Touchpad'), open: true, items: [
      WS.sub({ ctl: WS.checkbox(ctx, 'Turn off the touchpad while typing', () => S.data.touchpadDwt, (v) => S.set('touchpadDwt', v)) }),
      WS.sub({ title: 'Cursor speed', ctl: WS.settingSlider(ctx, 'touchpadSpeed', { min: 1, max: 20, label: 'Touchpad cursor speed' }) }),
    ] })),
  WS.group('Gestures & interactions',
    WS.expander(ctx, { sid: 'touchpadTap', icon: 'cursorClick', title: 'Taps', open: true, items: [WS.sub({ ctl: WS.checkbox(ctx, 'Tap with a single finger to single-click', () => S.data.touchpadTap, (v) => S.set('touchpadTap', v)) }), WS.sub({ ctl: WS.checkbox(ctx, 'Tap with two fingers to right-click', () => S.data.touchpadTap2, (v) => S.set('touchpadTap2', v)) })] }),
    WS.expander(ctx, { sid: 'touchpadScroll', icon: 'sort', title: 'Scroll & zoom', open: true, items: [WS.sub({ ctl: WS.checkbox(ctx, 'Drag two fingers to scroll', () => S.data.touchpadTwoFinger, (v) => S.set('touchpadTwoFinger', v)) }), WS.sub({ title: 'Scrolling direction', ctl: WS.combo(ctx, [[0, 'Down motion scrolls down'], [1, 'Down motion scrolls up']], () => (S.data.touchpadNatural ? 1 : 0), (v) => S.set('touchpadNatural', +v === 1), 'Scrolling direction', { width: 230 }) })] })),
] });
defSettings('touchpad', [['touchpadOn', 'Touchpad', 'trackpad on off'], ['touchpadTap', 'Tap to click', 'touchpad tap'], ['touchpadScroll', 'Touchpad scrolling direction', 'natural two finger']]);

/* ========== Network & internet ========== */
const netHas = () => Net.ready;
const isOn = () => Net.ready && Net.status.wifi.enabled && !Net.status.airplane;
function netHero(ctx) {
  const t = h('div', { class: 'ws-hero-name net-hero-t' }), d = h('div', { class: 'ws-d' }), ic = h('span', { class: 'ws-nethero-ic' });
  const paint = () => {
    const s = Net.status;
    t.textContent = Net.label().replace(/ \((no internet|sign-in needed)\)$/, '');
    ic.innerHTML = Net.icon();
    if (!Net.ready) { d.textContent = IS_NATIVE ? 'The network service isn’t running' : 'Your browser’s connection'; return; }
    const c = s.connectivity;
    d.textContent = s.airplane ? 'Airplane mode is on' : (s.wifi.ssid || s.wired.connected)
      ? (c === 'full' || c === 'unknown' ? `Connected${s.wifi.ssid ? ', secured' : ''}` : c === 'portal' ? 'This network needs you to sign in on a web page' : 'Connected, no internet')
      : s.wifi.present ? 'Not connected. Choose a Wi-Fi network.' : 'Not connected. Plug in a network cable.';
  };
  ctx.sync(paint); paint();
  const props = WS.button('Properties', () => ctx.go(Net.status && Net.status.wifi.ssid ? 'wifiprops' : 'ethernet'), { icon: 'info' });
  const usage = h('button', { class: 'ws-tile', html: `<span class="ws-tile-ic">${fi('dataUsage')}</span>` }, h('span', { class: 'ws-tile-t' }, h('b', { text: 'Data usage' }), h('span', { class: 'ws-d', text: 'Since this PC started' })));
  usage.addEventListener('click', () => ctx.go('datausage'));
  return h('div', { class: 'ws-hero net-hero' }, ic, h('div', { class: 'ws-hero-meta' }, t, d, Net.ready ? h('div', { class: 'ws-row' }, props) : null), Net.ready ? h('div', { class: 'ws-hero-tiles' }, usage) : null);
}
defPage('network', { title: 'Network & internet', icon: 'network', keywords: 'internet wifi ethernet vpn proxy hotspot airplane', render: (ctx) => {
  const shape = () => `${Net.ready}|${Net.hasWifi}`; const was = shape();
  ctx.on('net', () => { if (shape() !== was) ctx.rerender(); });
  if (!IS_NATIVE) return [netHero(ctx), WS.group(null, WS.info('info', 'Your browser handles the connection', 'Wi-Fi, Ethernet and VPN settings work when Nimbus runs on a computer.'))];
  if (!Net.ready) return [netHero(ctx)];
  const s = Net.status;
  return [
    netHero(ctx),
    WS.group(null,
      s.wifi.present ? WS.card(ctx, { sid: 'wifi', iconHtml: `<span class="ws-ic">${wifiIcon(4)}</span>`, title: 'Wi-Fi', desc: 'Connect, manage known networks, metered network', go: 'wifi', ctl: WS.toggle(ctx, isOn, (v) => Net.setWifi(v), 'Wi-Fi', { disabled: () => !!Net.busy || Net.status.airplane }) }) : null,
      WS.card(ctx, { sid: 'ethernet', icon: 'ethernet', title: 'Ethernet', desc: 'Authentication, IP and DNS settings, metered network', go: 'ethernet' }),
      WS.card(ctx, { sid: 'vpn', icon: 'vpn', title: 'VPN', desc: 'Add, connect, manage', go: 'vpn' }),
      s.wifi.present ? WS.card(ctx, { sid: 'hotspot', icon: 'hotspot', title: 'Mobile hotspot', desc: 'Share your internet connection', go: 'hotspot' }) : null,
      s.wifi.present ? WS.card(ctx, { sid: 'airplane', icon: 'airplane', title: 'Airplane mode', desc: 'Stop wireless communication', ctl: WS.toggle(ctx, () => !!(Net.status && Net.status.airplane), (v) => Net.setAirplane(v), 'Airplane mode', { disabled: () => !!Net.busy }) }) : null,
      WS.card(ctx, { sid: 'proxy', icon: 'proxy', title: 'Proxy', desc: 'Proxy server for Wi-Fi and Ethernet connections', go: 'proxy' }),
      WS.card(ctx, { sid: 'advnet', icon: 'adapter', title: 'Advanced network settings', desc: 'View all network adapters, network reset', go: 'advnet' })),
  ];
} });
defSettings('network', [['wifi', 'Wi-Fi', 'wifi wireless wlan internet'], ['ethernet', 'Ethernet', 'wired cable lan'], ['vpn', 'VPN', 'wireguard tunnel'], ['hotspot', 'Mobile hotspot', 'share tether'], ['airplane', 'Airplane mode', 'flight offline radio'], ['proxy', 'Proxy', 'server pac']]);

defPage('wifi', { title: 'Wi-Fi', parent: 'network', icon: 'wifi', keywords: 'wifi wireless networks connect password known', hidden: () => IS_NATIVE && Net.ready && !Net.hasWifi, render: (ctx) => {
  if (!Net.hasWifi) return [IS_NATIVE ? WS.info('info', 'No Wi-Fi adapter', 'This PC has no Wi-Fi adapter.') : needsNimbus()];
  const nets = netList();
  const exp = WS.expander(ctx, { sid: 'networks', icon: 'list', title: 'Show available networks', open: true, items: [h('div', { class: 'ws-netwrap' }, nets.el)] });
  ctxCleanup(ctx, () => nets.destroy());
  return [
    WS.group(null,
      WS.card(ctx, { sid: 'wifiOn', iconHtml: `<span class="ws-ic">${wifiIcon(4)}</span>`, title: 'Wi-Fi', ctl: WS.toggle(ctx, isOn, (v) => Net.setWifi(v), 'Wi-Fi', { disabled: () => !!Net.busy || Net.status.airplane }) }),
      exp,
      Net.status.wifi.ssid ? WS.card(ctx, { icon: 'info', title: `${Net.status.wifi.ssid} properties`, desc: 'Connected, secured', go: 'wifiprops' }) : null,
      WS.card(ctx, { sid: 'known', icon: 'wifiSettings', title: 'Manage known networks', desc: 'Add, remove, edit networks', go: 'known' }),
      WS.card(ctx, { icon: 'adapter', title: 'Hardware properties', desc: 'View and manage Wi-Fi adapter properties', go: 'hwprops' })),
  ];
} });
/* Pages that need to tidy up when you leave them */
function ctxCleanup(ctx, fn) { ctx.onLeave(fn); }

/* One connection's properties: automatic connect, metered, IP and DNS settings */
const fmtList = (a) => (a && a.length ? a.join('\n') : '—');
function connProps(ctx, pick, { wifi } = {}) {
  const box = h('div', { class: 'ws-stack' }, WS.card(ctx, { icon: 'info', title: 'Loading…' }));
  async function load() {
    let conns, det;
    try { [conns, det] = await Promise.all([Sys.call('netConns'), Sys.call('netDetails')]); } catch (e) { box.replaceChildren(WS.info('error', 'Couldn’t read the network settings', e.message)); return; }
    const c = pick(conns, det);
    if (!c) { box.replaceChildren(WS.info('info', wifi ? 'Not connected to Wi-Fi' : 'No cable plugged in', wifi ? 'Connect to a network to see its properties.' : 'Plug in a network cable to set up Ethernet.')); return; }
    const dev = (det.devices || []).find((d) => d.conn === c.uuid) || (det.devices || []).find((d) => d.type === (wifi ? 'wifi' : 'ethernet')) || {};
    const set = async (o) => { try { await Sys.call('netConnSet', Object.assign({ uuid: c.uuid }, o), 30000); } catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t change the network settings', body: e.message }); } load(); };
    const ipDesc = c.ip4method === 'manual' ? 'Manual' : 'Automatic (DHCP)';
    const dnsDesc = c.ignoreAutoDns && c.dns.length ? 'Manual' : 'Automatic (DHCP)';
    const props = [['SSID', c.ssid], ['Protocol', dev.protocol], ['Security type', dev.security], ['Network band', dev.band], ['Network channel', dev.channel], ['Link speed', dev.speed], ['IPv4 address', fmtList(dev.ip4)], ['IPv4 gateway', dev.gw4], ['IPv6 address', fmtList(dev.ip6)], ['IPv4 DNS servers', fmtList(dev.dns)], ['Manufacturer', dev.vendor], ['Description', dev.product], ['Driver', dev.driver], ['Physical address (MAC)', dev.mac]].filter(([, v]) => v);
    const table = h('dl', { class: 'ws-specs' }, ...props.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
    const ctl = { toggle: (get, setv, label) => WS.toggle({ sync() {} }, get, setv, label) };
    box.replaceChildren(
      WS.group(null,
        WS.card(ctx, { icon: 'plug', title: 'Connect automatically when in range', ctl: ctl.toggle(() => c.auto, (v) => set({ auto: v }), 'Connect automatically') }),
        WS.card(ctx, { icon: 'dataUsage', title: 'Metered connection', desc: 'Programs that respect it, like Nimbus Update, use less data on this network', ctl: ctl.toggle(() => c.metered === 'yes', (v) => set({ metered: v }), 'Metered connection') }),
        wifi ? WS.card(ctx, { icon: 'shield', title: 'Random hardware addresses', desc: 'Makes it harder for others to track this PC when it connects to this network', ctl: WS.combo({ sync() {} }, [['preserve', 'Off'], ['stable', 'On'], ['random', 'Change every time']], () => c.macRandom || 'preserve', (v) => set({ macRandom: v }), 'Random hardware addresses', { width: 170 }) }) : null),
      WS.group(null,
        WS.card(ctx, { icon: 'adapter', title: 'IP assignment', desc: ipDesc, ctl: WS.button('Edit', () => editIp(ctx, c, set)) }),
        WS.card(ctx, { icon: 'globe', title: 'DNS server assignment', desc: dnsDesc, ctl: WS.button('Edit', () => editDns(ctx, c, set)) }),
        h('div', { class: 'ws-card ws-propcard' }, table, h('div', { class: 'ws-ctl' }, WS.button('Copy', async () => { const ok = await copyText(props.map(([k, v]) => `${k}:\t${v}`).join('\n')); Notif.push({ app: 'settings', title: ok ? 'Copied' : 'Couldn’t copy', silent: true }); })))),
      wifi && c.ssid ? WS.group(null, WS.card(ctx, { icon: 'delete', title: 'Forget this network', ctl: WS.button('Forget', async () => { await Net.forget(c.ssid); ctx.go('wifi'); }) })) : null);
  }
  ctx.on('net', debounce(load, 800));
  load();
  return box;
}
const ipOk = (v) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(v);
async function editIp(ctx, c, set) {
  const mode = h('select', { class: 'ws-input', 'aria-label': 'IP assignment' }, h('option', { value: 'auto', text: 'Automatic (DHCP)' }), h('option', { value: 'manual', text: 'Manual' }));
  mode.value = c.ip4method === 'manual' ? 'manual' : 'auto';
  const [addr, pre] = (c.addresses && c.addresses[0] || '/24').split('/');
  const f = (label, value, ph) => { const i = h('input', { class: 'ws-input', value: value || '', placeholder: ph, 'aria-label': label }); return [h('label', { text: label }), i]; };
  const [la, ia] = f('IP address', addr, '192.168.1.50'), [lp, ip] = f('Subnet prefix length', pre || '24', '24'), [lg, ig] = f('Gateway', c.gateway, '192.168.1.1');
  const manual = h('div', { class: 'ws-form' }, la, ia, lp, ip, lg, ig);
  const err = h('p', { class: 'ws-err' });
  const sync = () => { manual.hidden = mode.value !== 'manual'; }; mode.addEventListener('change', sync); sync();
  const v = await Dialog.show({ title: 'Edit IP settings', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { text: 'IPv4' }), mode, manual, err),
    buttons: [{ label: 'Save', primary: true, value: () => {
      if (mode.value === 'auto') return { method: 'auto' };
      if (!ipOk(ia.value.trim()) || !(+ip.value >= 1 && +ip.value <= 32) || (ig.value.trim() && !ipOk(ig.value.trim()))) { err.textContent = 'Check the address, prefix length (1–32) and gateway.'; return undefined; }
      return { method: 'manual', address: ia.value.trim(), prefix: +ip.value, gateway: ig.value.trim() };
    } }, { label: 'Cancel', value: null }] });
  if (v) set({ ip4: v });
}
async function editDns(ctx, c, set) {
  const mode = h('select', { class: 'ws-input', 'aria-label': 'DNS server assignment' }, h('option', { value: 'auto', text: 'Automatic (DHCP)' }), h('option', { value: 'manual', text: 'Manual' }));
  mode.value = c.ignoreAutoDns && c.dns.length ? 'manual' : 'auto';
  const p = h('input', { class: 'ws-input', value: c.dns[0] || '', placeholder: '1.1.1.1', 'aria-label': 'Preferred DNS' }), a = h('input', { class: 'ws-input', value: c.dns[1] || '', placeholder: '1.0.0.1', 'aria-label': 'Alternate DNS' });
  const manual = h('div', { class: 'ws-form' }, h('label', { text: 'Preferred DNS' }), p, h('label', { text: 'Alternate DNS' }), a);
  const err = h('p', { class: 'ws-err' });
  const sync = () => { manual.hidden = mode.value !== 'manual'; }; mode.addEventListener('change', sync); sync();
  const v = await Dialog.show({ title: 'Edit DNS settings', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { text: 'DNS server assignment' }), mode, manual, err),
    buttons: [{ label: 'Save', primary: true, value: () => {
      if (mode.value === 'auto') return { auto: true, servers: [] };
      const list = [p.value.trim(), a.value.trim()].filter(Boolean);
      if (!list.length || !list.every((x) => ipOk(x) || /^[0-9a-f:]+$/i.test(x))) { err.textContent = 'Type at least one DNS server address, like 1.1.1.1.'; return undefined; }
      return { auto: false, servers: list };
    } }, { label: 'Cancel', value: null }] });
  if (v) set({ dns: v });
}
defPage('wifiprops', { title: 'Properties', parent: 'wifi', icon: 'info', noRecent: true, keywords: '', hidden: () => !Net.hasWifi, render: (ctx) => [connProps(ctx, (conns) => conns.find((c) => c.type === 'wifi' && c.active), { wifi: true })] });
defPage('ethernet', { title: 'Ethernet', parent: 'network', icon: 'ethernet', keywords: 'wired cable lan ip dns static', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  if (Net.ready && !Net.status.wired.present) return [WS.info('info', 'No Ethernet port', 'This PC has no Ethernet adapter.')];
  return [connProps(ctx, (conns) => conns.find((c) => c.type === 'ethernet' && c.active) || conns.find((c) => c.type === 'ethernet'))];
} });
defPage('known', { title: 'Manage known networks', parent: 'wifi', icon: 'wifiSettings', keywords: 'saved forget', render: (ctx) => {
  const box = h('div', { class: 'ws-cards' });
  const load = () => Sys.call('netConns').then((list) => {
    const wifi = list.filter((c) => c.type === 'wifi').sort((a, b) => (b.last || 0) - (a.last || 0));
    box.replaceChildren(...(wifi.length ? wifi.map((c) => WS.expander(ctx, { iconHtml: `<span class="ws-ic">${wifiIcon(4)}</span>`, title: c.name, desc: c.active ? 'Connected' : c.auto ? 'Connects automatically' : '', items: [
      WS.sub({ title: 'Connect automatically when in range', ctl: WS.toggle({ sync() {} }, () => c.auto, async (v) => { await Sys.call('netConnSet', { uuid: c.uuid, auto: v }).catch(() => {}); c.auto = v; }, 'Connect automatically') }),
      WS.sub({ title: 'Forget this network', ctl: WS.button('Forget', async () => { await Sys.call('netConnDel', { uuid: c.uuid }).catch((e) => Notif.push({ app: 'settings', title: 'Couldn’t forget the network', body: e.message })); load(); Net.refresh(); }) }),
    ] })) : [WS.card(ctx, { icon: 'wifi', title: 'No saved networks', desc: 'Networks you join are remembered here.' })]));
  }).catch((e) => box.replaceChildren(WS.info('error', 'Couldn’t list known networks', e.message)));
  load();
  return [WS.group(null, WS.card(ctx, { icon: 'add', title: 'Add a new network', ctl: WS.button('Add network', () => addHiddenNetwork(ctx, load)) })), WS.group('Known networks', box)];
} });
async function addHiddenNetwork(ctx, done) {
  const ssid = h('input', { class: 'ws-input', placeholder: 'Network name', 'aria-label': 'Network name', maxlength: 32 });
  const pw = h('input', { class: 'ws-input', type: 'password', placeholder: 'Security key (leave empty for an open network)', 'aria-label': 'Security key' });
  const err = h('p', { class: 'ws-err' });
  const v = await Dialog.show({ title: 'Add a new network', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { text: 'Network name' }), ssid, h('label', { text: 'Security key' }), pw, err),
    buttons: [{ label: 'Save', primary: true, value: () => { if (!ssid.value.trim()) { err.textContent = 'Type the network’s name.'; return undefined; } if (pw.value && pw.value.length < 8) { err.textContent = 'Wi-Fi passwords have at least 8 characters.'; return undefined; } return { ssid: ssid.value.trim(), password: pw.value || null }; } }, { label: 'Cancel', value: null }] });
  if (!v) return;
  const ok = await Net.act('wifiConnect', { ssid: v.ssid, password: v.password, hidden: true }, v.ssid);
  if (!ok) Notif.push({ app: 'settings', title: 'Couldn’t join ' + v.ssid, body: Net.error ? Net.error.message : '' });
  done();
}

defPage('vpn', { title: 'VPN', parent: 'network', icon: 'vpn', keywords: 'wireguard tunnel private network', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  const box = h('div', { class: 'ws-cards' });
  const load = () => Sys.call('netConns').then((list) => {
    const vpns = list.filter((c) => c.type === 'vpn' || c.type === 'wireguard');
    box.replaceChildren(...(vpns.length ? vpns.map((c) => WS.expander(ctx, { icon: 'vpn', title: c.name, desc: c.active ? 'Connected' : (c.type === 'wireguard' ? 'WireGuard' : 'VPN'), ctl: c.active ? WS.button('Disconnect', () => vpnDo('netConnDown', c)) : WS.button('Connect', () => vpnDo('netConnUp', c)), items: [
      WS.sub({ title: 'Connect automatically', ctl: WS.toggle({ sync() {} }, () => c.auto, async (v) => { await Sys.call('netConnSet', { uuid: c.uuid, auto: v }).catch(() => {}); c.auto = v; }, 'Connect automatically') }),
      WS.sub({ title: 'Remove this VPN connection', ctl: WS.button('Remove', () => vpnDo('netConnDel', c)) }),
    ] })) : [WS.card(ctx, { icon: 'vpn', title: 'No VPN connections yet', desc: 'Add one from your VPN provider’s WireGuard file.' })]));
  }).catch((e) => box.replaceChildren(WS.info('error', 'Couldn’t list VPN connections', e.message)));
  async function vpnDo(method, c) { try { await Sys.call(method, { uuid: c.uuid }, 40000); } catch (e) { Notif.push({ app: 'settings', title: c.name, body: e.message }); } load(); }
  async function add() {
    const name = h('input', { class: 'ws-input', placeholder: 'Connection name', 'aria-label': 'Connection name', maxlength: 40 });
    const file = h('input', { type: 'file', accept: '.conf,text/plain', class: 'ws-file', 'aria-label': 'WireGuard configuration file' });
    const err = h('p', { class: 'ws-err' });
    const v = await Dialog.show({ title: 'Add a VPN connection', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { text: 'VPN provider' }), h('div', { class: 'ws-d', text: 'WireGuard (a .conf file from your VPN provider)' }), h('label', { text: 'Connection name' }), name, h('label', { text: 'Configuration file' }), file, err),
      buttons: [{ label: 'Save', primary: true, value: () => { if (!file.files[0]) { err.textContent = 'Choose the .conf file your VPN provider gave you.'; return undefined; } return true; } }, { label: 'Cancel', value: null }] });
    if (!v) return;
    try {
      const conf = await file.files[0].text();
      if (!/\[Interface\]/i.test(conf)) throw new Error('That file isn’t a WireGuard configuration.');
      await Sys.call('vpnImport', { name: (name.value.trim() || file.files[0].name.replace(/\.conf$/i, '')).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 15), conf }, 30000);
    } catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t add the VPN', body: e.message }); }
    load();
  }
  load();
  return [WS.group(null, WS.card(ctx, { icon: 'vpn', title: 'VPN connections', ctl: WS.button('Add VPN', add, { accent: true }) }), box)];
} });

defPage('hotspot', { title: 'Mobile hotspot', parent: 'network', icon: 'hotspot', keywords: 'share internet tether', hidden: () => IS_NATIVE && Net.ready && !Net.hasWifi, render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  let st = { supported: true, on: false, ssid: S.data.hotspotName || pcName(), password: S.data.hotspotPassword || '', band: 'any' };
  const box = h('div', { class: 'ws-stack' });
  const paint = () => {
    box.replaceChildren(
      WS.group(null, WS.card(ctx, { icon: 'hotspot', title: 'Mobile hotspot', desc: st.on ? `Sharing as “${st.ssid}”` : st.supported ? 'Share this PC’s internet connection over Wi-Fi' : 'Your Wi-Fi adapter can’t share a connection', ctl: WS.toggle({ sync() {} }, () => st.on, async (v) => { try { st = await Sys.call('hotspot', { on: v, ssid: S.data.hotspotName || pcName(), password: S.data.hotspotPassword || genPass(), band: S.data.hotspotBand || 'any' }, 40000); } catch (e) { Notif.push({ app: 'settings', title: 'Mobile hotspot', body: e.message }); } paint(); }, 'Mobile hotspot', { disabled: !st.supported }) }),
        Net.status.wifi.ssid && !Net.status.wired.connected ? WS.info('info', 'Wi-Fi will disconnect', 'Most Wi-Fi adapters can either join a network or share one. To share Wi-Fi with this PC online, connect it with a cable.') : null),
      WS.group('Properties', h('div', { class: 'ws-card ws-propcard' }, h('dl', { class: 'ws-specs' }, h('dt', { text: 'Name' }), h('dd', { text: S.data.hotspotName || pcName() }), h('dt', { text: 'Password' }), h('dd', { text: S.data.hotspotPassword || 'Made when you turn it on' }), h('dt', { text: 'Band' }), h('dd', { text: { any: 'Any available', bg: '2.4 GHz', a: '5 GHz' }[S.data.hotspotBand || 'any'] })), h('div', { class: 'ws-ctl' }, WS.button('Edit', edit)))));
  };
  const genPass = () => { const p = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('') + '-' + Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b % 10).join(''); S.set('hotspotPassword', p); return p; };
  async function edit() {
    const n = h('input', { class: 'ws-input', value: S.data.hotspotName || pcName(), maxlength: 32, 'aria-label': 'Network name' });
    const p = h('input', { class: 'ws-input', value: S.data.hotspotPassword || '', placeholder: 'At least 8 characters', 'aria-label': 'Network password' });
    const b = h('select', { class: 'ws-input', 'aria-label': 'Network band' }, h('option', { value: 'any', text: 'Any available' }), h('option', { value: 'bg', text: '2.4 GHz' }), h('option', { value: 'a', text: '5 GHz' }));
    b.value = S.data.hotspotBand || 'any';
    const err = h('p', { class: 'ws-err' });
    const v = await Dialog.show({ title: 'Edit network info', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { text: 'Network name' }), n, h('label', { text: 'Network password' }), p, h('label', { text: 'Network band' }), b, err),
      buttons: [{ label: 'Save', primary: true, value: () => { if (!n.value.trim()) { err.textContent = 'Type a name.'; return undefined; } if (p.value.length < 8) { err.textContent = 'The password needs at least 8 characters.'; return undefined; } return true; } }, { label: 'Cancel', value: null }] });
    if (!v) return;
    S.set('hotspotName', n.value.trim()); S.set('hotspotPassword', p.value); S.set('hotspotBand', b.value);
    if (st.on) { try { st = await Sys.call('hotspot', { on: true, ssid: n.value.trim(), password: p.value, band: b.value }, 40000); } catch (e) { Notif.push({ app: 'settings', title: 'Mobile hotspot', body: e.message }); } }
    paint();
  }
  Sys.call('hotspotStatus').then((s) => { st = s; paint(); }).catch(() => paint());
  paint();
  return [box];
} });

defPage('proxy', { title: 'Proxy', parent: 'network', icon: 'proxy', keywords: 'proxy server pac script automatic', render: (ctx) => {
  const p = () => Object.assign({ auto: false, pacOn: false, pac: '', manual: false, host: '', port: '', bypass: '', local: true }, S.data.proxy);
  const save = async (o) => { const v = Object.assign(p(), o); S.set('proxy', v); if (IS_NATIVE) await Sys.call('proxySet', v).catch((e) => Notif.push({ app: 'settings', title: 'Proxy', body: e.message })); ctx.rerender(); };
  async function script() {
    const on = h('input', { type: 'checkbox', checked: p().pacOn, id: 'pac-on' }); const url = h('input', { class: 'ws-input', value: p().pac, placeholder: 'http://proxy.example.com/proxy.pac', 'aria-label': 'Script address' });
    const v = await Dialog.show({ title: 'Edit setup script', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { class: 'ws-checkrow' }, on, h('span', { text: 'Use setup script' })), h('label', { text: 'Script address' }), url), buttons: [{ label: 'Save', primary: true, value: true }, { label: 'Cancel', value: null }] });
    if (v) save({ pacOn: on.checked && !!url.value.trim(), pac: url.value.trim() });
  }
  async function manual() {
    const on = h('input', { type: 'checkbox', checked: p().manual }); const host = h('input', { class: 'ws-input', value: p().host, placeholder: 'proxy.example.com', 'aria-label': 'Proxy IP address' }); const port = h('input', { class: 'ws-input', value: p().port, placeholder: '8080', 'aria-label': 'Port', style: { width: '90px' } });
    const by = h('textarea', { class: 'ws-input', rows: 3, 'aria-label': 'Exceptions', placeholder: '*.example.com; 10.*' }); by.value = p().bypass;
    const loc = h('input', { type: 'checkbox', checked: p().local });
    const err = h('p', { class: 'ws-err' });
    const v = await Dialog.show({ title: 'Edit proxy server', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { class: 'ws-checkrow' }, on, h('span', { text: 'Use a proxy server' })), h('label', { text: 'Proxy IP address and port' }), h('div', { class: 'ws-row' }, host, port), h('label', { text: 'Use the proxy server except for addresses that start with the following entries. Use semicolons (;) to separate entries.' }), by, h('label', { class: 'ws-checkrow' }, loc, h('span', { text: 'Don’t use the proxy server for local (intranet) addresses' })), err),
      buttons: [{ label: 'Save', primary: true, value: () => { if (on.checked && (!host.value.trim() || !(+port.value > 0 && +port.value < 65536))) { err.textContent = 'Type the proxy’s address and a port number.'; return undefined; } return true; } }, { label: 'Cancel', value: null }] });
    if (v) save({ manual: on.checked, host: host.value.trim(), port: port.value.trim(), bypass: by.value.trim(), local: loc.checked });
  }
  return [
    WS.info('info', 'Applies to Google Chrome and other programs', 'Programs pick up proxy changes the next time they start.'),
    WS.group('Automatic proxy setup',
      WS.card(ctx, { sid: 'proxyAuto', icon: 'proxy', title: 'Automatically detect settings', ctl: WS.toggle(ctx, () => p().auto, (v) => save({ auto: v }), 'Automatically detect settings') }),
      WS.card(ctx, { icon: 'code', title: 'Use setup script', desc: p().pacOn ? p().pac : 'Off', ctl: WS.button('Set up', script) })),
    WS.group('Manual proxy setup', WS.card(ctx, { sid: 'proxyManual', icon: 'adapter', title: 'Use a proxy server', desc: p().manual ? `${p().host}:${p().port}` : 'Off', ctl: WS.button('Set up', manual) })),
  ];
} });

defPage('advnet', { title: 'Advanced network settings', parent: 'network', icon: 'adapter', keywords: 'adapters reset hardware properties', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  const box = h('div', { class: 'ws-cards' });
  const load = () => Sys.call('netDetails').then((det) => {
    const devs = (det.devices || []).filter((d) => d.type === 'wifi' || d.type === 'ethernet');
    box.replaceChildren(...devs.map((d) => WS.expander(ctx, { icon: d.type === 'wifi' ? 'wifi' : 'ethernet', title: d.type === 'wifi' ? 'Wi-Fi' : 'Ethernet', desc: [d.product || d.iface, d.state].filter(Boolean).join(' · '), items: [
      WS.sub({ title: 'Network adapter', desc: d.iface + (d.mac ? ' · ' + d.mac : ''), ctl: d.state === 'unavailable' && d.type !== 'wifi' ? null : WS.button(d.disabled ? 'Enable' : 'Disable', async () => { try { await Sys.call('netDevice', { iface: d.iface, on: !!d.disabled }, 30000); } catch (e) { Notif.push({ app: 'settings', title: 'Network adapter', body: e.message }); } load(); Net.refresh(); }) }),
      WS.sub({ title: 'View additional properties', ctl: WS.link('Properties', () => ctx.go(d.type === 'wifi' ? 'wifiprops' : 'ethernet')) }),
    ] })));
    if (!devs.length) box.append(WS.card(ctx, { icon: 'adapter', title: 'No network adapters found' }));
  }).catch((e) => box.replaceChildren(WS.info('error', 'Couldn’t list the network adapters', e.message)));
  load();
  return [
    WS.group('Network adapters', box),
    WS.group('More settings',
      WS.card(ctx, { icon: 'dataUsage', title: 'Data usage', go: 'datausage' }),
      WS.card(ctx, { icon: 'info', title: 'Hardware and connection properties', go: 'hwprops' }),
      WS.card(ctx, { sid: 'netReset', icon: 'reset', title: 'Network reset', desc: 'Forget all saved networks and VPN connections and restart networking', ctl: WS.button('Reset now', async () => {
        const ok = await Dialog.confirm('Network reset', 'Nimbus forgets every Wi-Fi network, VPN and network setting you made, then restarts networking. You may need to type Wi-Fi passwords again.', { ok: 'Reset now', danger: true, within: ctx.win });
        if (ok) { try { await Sys.call('netReset', {}, 60000); Notif.push({ app: 'settings', title: 'Network reset', body: 'Networking restarted with the default settings.' }); } catch (e) { Notif.push({ app: 'settings', title: 'Network reset didn’t finish', body: e.message }); } Net.refresh(); }
      }) })),
  ];
} });
defSettings('advnet', [['netReset', 'Network reset', 'forget networks restore defaults']]);
defPage('hwprops', { title: 'Hardware and connection properties', parent: 'advnet', icon: 'info', noRecent: true, keywords: 'mac address ip', render: (ctx) => {
  const box = h('div', { class: 'ws-cards' });
  if (!IS_NATIVE) return [needsNimbus()];
  let text = '';
  Sys.call('netDetails').then((det) => {
    const rows = (det.devices || []).filter((d) => d.type !== 'loopback').map((d) => [['Name', d.iface], ['Description', d.product], ['Physical address (MAC)', d.mac], ['Status', d.state], ['Maximum transmission unit', d.mtu], ['Link speed', d.speed], ['IPv4 address', fmtList(d.ip4)], ['IPv6 address', fmtList(d.ip6)], ['Default gateway', d.gw4], ['DNS servers', fmtList(d.dns)], ['Connection', d.connName]].filter(([, v]) => v && v !== '—'));
    text = rows.map((r) => r.map(([k, v]) => `${k}:\t${v}`).join('\n')).join('\n\n');
    box.replaceChildren(...rows.map((r) => h('div', { class: 'ws-card ws-propcard' }, h('dl', { class: 'ws-specs' }, ...r.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])))));
  }).catch((e) => box.replaceChildren(WS.info('error', 'Couldn’t read the network adapters', e.message)));
  return [h('div', { class: 'ws-actions start' }, WS.button('Copy', async () => { const ok = await copyText(text); Notif.push({ app: 'settings', title: ok ? 'Copied' : 'Couldn’t copy', silent: true }); })), box];
} });
defPage('datausage', { title: 'Data usage', parent: 'advnet', icon: 'dataUsage', noRecent: true, keywords: 'bandwidth traffic', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  const box = h('div', { class: 'ws-cards' });
  const load = () => Sys.call('netUsage').then((list) => {
    const max = Math.max(1, ...list.map((x) => x.rx + x.tx));
    box.replaceChildren(...list.map((x) => WS.card(ctx, { icon: x.type === 'wifi' ? 'wifi' : x.type === 'ethernet' ? 'ethernet' : 'adapter', title: x.name || x.iface, desc: `${fmtBytes(x.rx)} received · ${fmtBytes(x.tx)} sent`, ctl: h('div', { class: 'ws-usage' }, h('b', { text: fmtBytes(x.rx + x.tx) }), WS.meter((x.rx + x.tx) / max, 'small')) })));
  }).catch((e) => box.replaceChildren(WS.info('error', 'Couldn’t read data usage', e.message)));
  load(); ctx.every(5000, load);
  return [WS.group('Since this PC started', box)];
} });
