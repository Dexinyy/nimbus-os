/* ========== Settings: Home and System ========== */
const THEMES = [
  { id: 'ridgeline', name: 'Ridgeline', wallpaper: 'ridgeline', theme: 'light', accent: '#0078d4' },
  { id: 'nebula', name: 'Nebula', wallpaper: 'nebula', theme: 'dark', accent: '#8764b8' },
  { id: 'tide', name: 'Tide', wallpaper: 'tide', theme: 'light', accent: '#038387' },
  { id: 'dunes', name: 'Dunes', wallpaper: 'dunes', theme: 'light', accent: '#ca5010' },
  { id: 'grove', name: 'Grove', wallpaper: 'grove', theme: 'dark', accent: '#498205' },
  { id: 'slate', name: 'Slate', wallpaper: 'slate', theme: 'dark', accent: '#68768a' },
  { id: 'dawn', name: 'Dawn', wallpaper: 'dawn', theme: 'light', accent: '#c239b3' },
  { id: 'paper', name: 'Paper', wallpaper: 'paper', theme: 'light', accent: '#7e735f' },
];
function applyTheme_(t) { S.set('wallpaper', t.wallpaper); S.set('theme', t.theme); S.set('accent', t.accent); S.set('accentAuto', false); }
function themeThumb(ctx, t, size = 'md') {
  const b = h('button', { class: 'ws-theme ' + size, 'aria-label': 'Theme ' + t.name, 'data-tip': t.name },
    h('img', { src: wallThumb(t.wallpaper), alt: '', loading: 'lazy' }),
    h('span', { class: 'ws-theme-win ' + t.theme }, h('i', { style: { background: t.accent } })));
  b.addEventListener('click', (e) => { e.stopPropagation(); applyTheme_(t); });
  ctx.sync(() => b.classList.toggle('on', S.data.wallpaper === t.wallpaper && S.data.accent === t.accent));
  b.classList.toggle('on', S.data.wallpaper === t.wallpaper && S.data.accent === t.accent);
  return b;
}
const fmtHM = (sec) => { const m = Math.round(sec / 60), hh = Math.floor(m / 60); return (hh ? hh + ' hr ' : '') + (m % 60) + ' min'; };
const fmtMins = (s) => (!s ? 'Never' : s < 3600 ? `${Math.round(s / 60)} minute${s === 60 ? '' : 's'}` : `${s / 3600} hour${s === 3600 ? '' : 's'}`);
const TIMEOUTS = [60, 120, 180, 300, 600, 900, 1200, 1500, 1800, 2700, 3600, 7200, 10800, 14400, 18000, 0].map((s) => [s, fmtMins(s)]);
function deviceArt(ctx) {
  const scr = h('div', { class: 'ws-device-screen' });
  const paint = () => { scr.style.backgroundImage = `url("${currentWallURL}")`; };
  ctx.sync(paint); paint();
  return h('div', { class: 'ws-device', 'aria-hidden': 'true' }, scr, h('div', { class: 'ws-device-stand' }));
}
function heroTile(ctx, icon, title, sub, go) {
  const s = h('span', { class: 'ws-d' });
  const paint = () => { s.textContent = typeof sub === 'function' ? sub() : sub; };
  ctx.sync(paint); paint();
  const b = h('button', { class: 'ws-tile', html: `<span class="ws-tile-ic">${fi(icon)}</span>` }, h('span', { class: 'ws-tile-t' }, h('b', { text: title }), s));
  b.addEventListener('click', () => ctx.go(go));
  return b;
}
async function renamePC(ctx) {
  const inp = h('input', { class: 'ws-input', value: pcName(), maxlength: 63, style: { width: '100%' }, 'aria-label': 'PC name' });
  const err = h('p', { class: 'ws-d ws-err' });
  const content = h('div', {}, h('p', { class: 'ws-d', text: 'Letters, numbers and hyphens. Other computers on your network see this name.' }), inp, err);
  const name = await Dialog.show({ title: 'Rename your PC', content, within: ctx.win, cancelValue: null,
    buttons: [{ label: 'Next', primary: true, value: () => { const v = inp.value.trim(); if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/.test(v)) { err.textContent = 'Use letters, numbers and hyphens, without spaces.'; return undefined; } return v; } }, { label: 'Cancel', value: null }] });
  if (!name) return;
  if (IS_NATIVE) {
    try { await Sys.call('hostnameSet', { name }); await Native.refresh(); }
    catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t rename this PC', body: e.message }); return; }
  }
  S.set('deviceName', name);
  ctx.rerender();
}
const savingText = () => (!IS_NATIVE || !Native.live ? 'Your work is kept on this PC' : Storage.saving ? 'Saving is on' : 'Not saved yet: set it up');

/* ---------- Home ---------- */
defPage('home', { title: 'Home', keywords: 'start overview recommended', render: (ctx) => {
  const recent = (S.data.settingsRecent || []).filter((id) => SPAGES[id] && !SPAGES[id].hidden?.()).slice(0, 4);
  const rec = h('div', { class: 'ws-home-card' }, h('h3', { text: 'Recommended settings' }), h('p', { class: 'ws-d', text: 'Recent and commonly used settings' }));
  const list = (recent.length ? recent : ['display', 'sound', 'background', 'wifi']).filter((id) => SPAGES[id]);
  for (const id of list) rec.append(WS.card(ctx, { icon: SPAGES[id].icon || 'settings', title: SPAGES[id].title, go: id, cls: 'flat' }));
  const themes = h('div', { class: 'ws-home-card' }, h('h3', { text: 'Personalize your device' }), h('div', { class: 'ws-theme-row' }, ...THEMES.slice(0, 4).map((t) => themeThumb(ctx, t, 'sm'))),
    WS.card(ctx, { icon: 'colors', title: 'Color mode', ctl: WS.settingCombo(ctx, 'theme', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']], 'Color mode'), cls: 'flat' }),
    WS.card(ctx, { icon: 'background', title: 'Browse more backgrounds, colors, and themes', go: 'personalization', cls: 'flat' }));
  const btCard = h('div', { class: 'ws-home-card' }, h('h3', { text: 'Bluetooth devices' }));
  const btBody = h('div');
  const paintBt = () => {
    const st = Sys.bt.st; btBody.innerHTML = '';
    if (!st.available) { btBody.append(h('p', { class: 'ws-d', text: IS_NATIVE ? 'This PC has no Bluetooth adapter.' : 'Bluetooth works when Nimbus runs on a computer.' })); return; }
    btBody.append(WS.card(ctx, { icon: 'bluetooth', title: 'Bluetooth', desc: st.powered ? `Discoverable as “${st.name || pcName()}”` : 'Off', cls: 'flat', ctl: WS.toggle(ctx, () => Sys.bt.st.powered, (v) => Sys.bt.do({ action: 'power', on: v }), 'Bluetooth') }));
    for (const d of st.devices.filter((x) => x.paired).slice(0, 3)) btBody.append(WS.card(ctx, { iconHtml: WS.ic(btIcon(d)), title: d.name, desc: d.connected ? 'Connected' : 'Paired', cls: 'flat' }));
  };
  ctx.on('sys', (n) => { if (n === 'bluetooth') paintBt(); }); paintBt();
  btCard.append(btBody, WS.card(ctx, { icon: 'devices', title: 'View all devices', go: 'devices', cls: 'flat' }));
  const net = h('div', { class: 'ws-home-card' }, h('h3', { text: 'Network & internet' }), WS.card(ctx, { iconHtml: `<span class="ws-ic">${IS_NATIVE ? Net.icon() : fi('globe')}</span>`, title: IS_NATIVE ? Net.label() : 'Your browser’s connection', go: 'network', cls: 'flat' }));
  const save = h('div', { class: 'ws-home-card' }, h('h3', { text: 'Your work' }), WS.card(ctx, { icon: 'save', title: savingText(), go: IS_NATIVE && Native.live ? 'saving' : 'backup', cls: 'flat' }), WS.card(ctx, { icon: 'backup', title: 'Back up your files and settings', go: 'backup', cls: 'flat' }));
  return [h('div', { class: 'ws-home' }, rec, themes, btCard, net, save)];
} });

/* ---------- System ---------- */
defPage('system', { title: 'System', icon: 'system', keywords: 'pc computer', render: (ctx) => [
  h('div', { class: 'ws-hero' }, deviceArt(ctx),
    h('div', { class: 'ws-hero-meta' }, h('div', { class: 'ws-hero-name', text: pcName() }), h('div', { class: 'ws-d', text: (IS_NATIVE && Native.info && Native.info.device) || osTitle() }), WS.link('Rename', () => renamePC(ctx))),
    h('div', { class: 'ws-hero-tiles' }, heroTile(ctx, 'save', 'Your work', savingText, IS_NATIVE && Native.live ? 'saving' : 'backup'), heroTile(ctx, 'update', 'Nimbus Update', () => updateLine(), 'update'))),
  WS.group(null,
    WS.card(ctx, { icon: 'display', title: 'Display', desc: 'Monitors, brightness, night light, scale', go: 'display' }),
    WS.card(ctx, { icon: 'sound', title: 'Sound', desc: 'Volume levels, output, input, sound devices', go: 'sound' }),
    WS.card(ctx, { icon: 'notifications', title: 'Notifications', desc: 'Alerts from apps and system, do not disturb', go: 'notifications' }),
    WS.card(ctx, { icon: 'focus', title: 'Focus', desc: 'Reduce distractions', go: 'focus' }),
    WS.card(ctx, { icon: 'power', title: Sys.power.st.battery ? 'Power & battery' : 'Power', desc: 'Screen and sleep, power mode, energy saver', go: 'power' }),
    WS.card(ctx, { icon: 'storage', title: 'Storage', desc: 'Storage space, drives, cleanup', go: 'storage' }),
    IS_NATIVE && Native.live ? WS.card(ctx, { icon: 'save', title: 'Saving your work', desc: 'Keep files, settings and programs between restarts', go: 'saving' }) : null,
    WS.card(ctx, { icon: 'multitasking', title: 'Multitasking', desc: 'Snap windows, task switching', go: 'multitasking' }),
    WS.card(ctx, { icon: 'troubleshoot', title: 'Troubleshoot', desc: 'Find and fix problems with the internet, sound and more', go: 'troubleshoot' }),
    WS.card(ctx, { icon: 'recovery', title: 'Recovery', desc: 'Reset, advanced startup', go: 'recovery' }),
    WS.card(ctx, { icon: 'clipboard', title: 'Clipboard', desc: 'Cut and copy history, clear', go: 'clipboard' }),
    WS.card(ctx, { icon: 'about', title: 'About', desc: 'Device specifications, rename PC, Nimbus specifications', go: 'about' })),
] });

/* ---------- Display ---------- */
const fmtRes = (m) => `${m[0]} × ${m[1]}`;
const fmtHz = (mhz) => `${(mhz / 1000).toFixed(mhz % 1000 ? 2 : 0).replace(/\.?0+$/, '')} Hz`;
const SCALES = [[1, '100%'], [1.25, '125%'], [1.5, '150%'], [1.75, '175%'], [2, '200%']];
const ORIENT = [[0, 'Landscape'], [1, 'Portrait'], [2, 'Landscape (flipped)'], [3, 'Portrait (flipped)']];
async function changeDisplay(ctx, change) {
  const o = Sys.display.main(); if (!o) return;
  const before = { mode: [o.width, o.height, o.refresh], scale: o.scale, transform: o.transform };
  try { await Sys.display.set(Object.assign({ name: o.name }, change)); }
  catch (e) { Notif.push({ app: 'settings', title: 'The display didn’t change', body: e.message }); return; }
  await sleep(600);
  const kept = await WS.confirmRevert(ctx.win, () => Sys.display.set({ name: o.name, mode: before.mode, scale: before.scale, transform: before.transform }).catch(() => {}));
  const now = Sys.display.main();
  if (kept && now) S.set('display', { mode: [now.width, now.height, now.refresh], scale: now.scale, transform: now.transform });
}
defPage('display', { title: 'Display', parent: 'system', icon: 'display', keywords: 'monitor screen resolution scale brightness night light orientation', render: (ctx) => {
  const o = Sys.display.main(); const bl = Sys.display.st.backlight;
  const modes = () => { const m = Sys.display.main(); if (!m) return []; const seen = new Set(); return m.modes.filter((x) => { const k = x[0] + 'x' + x[1]; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b[0] * b[1] - a[0] * a[1]).map((x) => [x[0] + 'x' + x[1], fmtRes(x) + (x[3] ? ' (Recommended)' : '')]); };
  const out = [
    WS.group('Brightness & color',
      WS.card(ctx, { sid: 'brightness', icon: 'brightness', title: 'Brightness', desc: bl ? 'Adjust the brightness of the built-in display' : 'Dims the screen. This display has no brightness control of its own.', ctl: WS.settingSlider(ctx, 'brightness', { min: bl ? 5 : 30, max: 100, fmt: (v) => v + '%', label: 'Brightness' }) }),
      WS.card(ctx, { sid: 'nightLight', icon: 'night', title: 'Night light', desc: S.data.nightSchedule ? `Scheduled: ${S.data.nightFrom} to ${S.data.nightTo}` : 'Use warmer colors to help block blue light', ctl: WS.settingToggle(ctx, 'nightLight', 'Night light'), go: 'nightlight' })),
  ];
  if (!IS_NATIVE) { out.push(WS.group('Scale & layout', needsNimbus())); return out; }
  if (!o) { out.push(WS.group('Scale & layout', WS.info('info', 'Looking for displays…', ''))); return out; }
  const modeVal = () => { const m = Sys.display.main(); return m ? m.width + 'x' + m.height : ''; };
  out.push(WS.group('Scale & layout',
    WS.card(ctx, { sid: 'scale', icon: 'scale', title: 'Scale', desc: 'Change the size of text, apps, and other items', ctl: WS.combo(ctx, SCALES.map(([v, l]) => [v, l + (v === 1 ? ' (Recommended)' : '')]), () => Sys.display.main()?.scale, (v) => changeDisplay(ctx, { scale: +v }), 'Scale', { width: 200 }) }),
    WS.card(ctx, { sid: 'resolution', icon: 'resolution', title: 'Display resolution', desc: 'Adjust the resolution to fit your connected display', ctl: WS.combo(ctx, modes, modeVal, (v) => {
      const [w, hh] = v.split('x').map(Number); const m = Sys.display.main();
      const best = m.modes.filter((x) => x[0] === w && x[1] === hh).sort((a, b) => b[2] - a[2])[0];
      if (best) return changeDisplay(ctx, { mode: best.slice(0, 3) });
    }, 'Display resolution', { width: 220 }) }),
    WS.card(ctx, { sid: 'orientation', icon: 'rotate', title: 'Display orientation', ctl: WS.combo(ctx, ORIENT, () => Sys.display.main()?.transform || 0, (v) => changeDisplay(ctx, { transform: +v }), 'Display orientation', { width: 200 }) })),
    WS.group(null, WS.expander(ctx, { sid: 'multiple', icon: 'display', title: 'Multiple displays', desc: 'Choose the presentation mode for your displays', items: () => [
      WS.sub({ title: Sys.display.st.outputs.length > 1 ? `${Sys.display.st.outputs.length} displays are connected` : 'One display is connected', desc: Sys.display.st.outputs.length > 1 ? 'The desktop shows on the first display. Using several displays together is coming later.' : 'Connect another display to use it with this PC.' }),
      WS.sub({ title: 'Detect other displays', ctl: WS.button('Detect', () => Sys.display.refresh()) }),
    ] })),
    WS.group('Related settings',
      WS.card(ctx, { icon: 'display', title: 'Advanced display', desc: 'Display information, refresh rate', go: 'advdisplay' }),
      WS.card(ctx, { icon: 'graphics', title: 'Graphics', desc: 'How this PC draws the screen', go: 'graphics' })));
  ctx.on('sys', (n) => { if (n === 'display') ctx.sync(() => {}); });
  return out;
} });
defSettings('display', [['brightness', 'Brightness', 'dim screen backlight'], ['nightLight', 'Night light', 'blue light warm'], ['scale', 'Scale', 'size text bigger zoom dpi'], ['resolution', 'Display resolution', 'screen size pixels'], ['orientation', 'Display orientation', 'rotate portrait landscape']]);

defPage('nightlight', { title: 'Night light', parent: 'display', icon: 'night', keywords: 'blue light warm schedule', render: (ctx) => [
  WS.group(null,
    WS.card(ctx, { sid: 'nightNow', icon: 'night', title: S.data.nightLight ? 'Night light is on' : 'Night light is off', ctl: WS.button(S.data.nightLight ? 'Turn off now' : 'Turn on now', () => { S.set('nightLight', !S.data.nightLight); ctx.rerender(); }) }),
    WS.card(ctx, { sid: 'nightStrength', icon: 'brightnessLow', title: 'Strength', ctl: WS.settingSlider(ctx, 'nightStrength', { min: 0, max: 100, fmt: (v) => v + '%', label: 'Night light strength' }) }),
    WS.expander(ctx, { sid: 'nightSchedule', icon: 'clock', title: 'Schedule night light', desc: 'Turn it on and off at set hours', open: !!S.data.nightSchedule, ctl: WS.settingToggle(ctx, 'nightSchedule', 'Schedule night light'), items: [
      WS.sub({ title: 'Turn on', ctl: timeInput(ctx, 'nightFrom') }),
      WS.sub({ title: 'Turn off', ctl: timeInput(ctx, 'nightTo') }),
    ] })),
] });
function timeInput(ctx, key) {
  const inp = h('input', { type: 'time', class: 'ws-input', value: S.data[key], style: { width: '130px' }, 'aria-label': key });
  inp.addEventListener('change', () => { if (inp.value) S.set(key, inp.value); });
  inp.addEventListener('click', (e) => e.stopPropagation());
  ctx.sync(() => { if (document.activeElement !== inp) inp.value = S.data[key]; });
  return inp;
}

defPage('advdisplay', { title: 'Advanced display', parent: 'display', icon: 'display', keywords: 'refresh rate hz information monitor', render: (ctx) => {
  const o = Sys.display.main();
  if (!IS_NATIVE) return [needsNimbus()];
  if (!o) return [WS.info('info', 'No display information yet', '')];
  const rates = () => { const m = Sys.display.main(); return m ? m.modes.filter((x) => x[0] === m.width && x[1] === m.height).map((x) => [x[2], fmtHz(x[2])]) : []; };
  return [
    WS.group('Display information',
      WS.expander(ctx, { icon: 'display', title: o.desc || o.name, desc: 'Display 1: Connected to this PC', open: true, items: [
        WS.sub({ title: 'Desktop mode', desc: `${o.width} × ${o.height}, ${fmtHz(o.refresh)}` }),
        WS.sub({ title: 'Connection', desc: o.name }),
        o.make || o.model ? WS.sub({ title: 'Made by', desc: [o.make, o.model].filter(Boolean).join(' ') }) : null,
        o.phys && o.phys[0] ? WS.sub({ title: 'Size', desc: `${o.phys[0]} × ${o.phys[1]} mm (${(Math.hypot(o.phys[0], o.phys[1]) / 25.4).toFixed(1)}″)` }) : null,
        WS.sub({ title: 'Scale', desc: Math.round(o.scale * 100) + '%' }),
      ] })),
    WS.group(null, WS.card(ctx, { sid: 'refresh', icon: 'gauge', title: 'Choose a refresh rate', desc: 'A higher rate gives smoother motion, but also uses more power', ctl: WS.combo(ctx, rates, () => Sys.display.main()?.refresh, (v) => { const m = Sys.display.main(); return changeDisplay(ctx, { mode: [m.width, m.height, +v] }); }, 'Refresh rate', { width: 160 }) })),
  ];
} });
defSettings('advdisplay', [['refresh', 'Refresh rate', 'hz hertz fps smooth']]);
defPage('graphics', { title: 'Graphics', parent: 'display', icon: 'graphics', keywords: 'gpu video card acceleration', render: (ctx) => {
  const ni = IS_NATIVE && Native.info;
  if (!ni) return [needsNimbus()];
  return [WS.group('Graphics',
    ...(ni.gpus.length ? ni.gpus : [{ name: 'Basic display', driver: '' }]).map((g) => WS.card(ctx, { icon: 'graphics', title: g.name, desc: g.driver ? 'Driver: ' + g.driver : '' })),
    WS.card(ctx, { icon: 'sparkle', title: ni.software ? 'Drawn by the processor' : 'Graphics acceleration is on', desc: ni.software ? 'This graphics card isn’t on the list Nimbus uses for acceleration, or this is a virtual machine. Everything works; animations are a bit slower.' : 'The desktop and programs draw with the graphics card.' }))];
} });

/* ---------- Sound ---------- */
const kindIcon = (d) => ({ headphones: 'headphones', bluetooth: 'bluetooth', hdmi: 'display', usb: 'usb', mic: 'mic' }[d.kind] || (d.source ? 'mic' : 'sound'));
function deviceList(ctx, kind) {
  const box = h('div', { class: 'ws-devlist' });
  const paint = () => {
    const list = Sys.sound.st[kind === 'source' ? 'inputs' : 'outputs'] || [];
    box.innerHTML = '';
    if (!list.length) { box.append(h('p', { class: 'ws-d ws-pad', text: kind === 'source' ? 'No microphones found' : 'No sound outputs found' })); return; }
    for (const d of list) {
      const b = h('button', { class: 'ws-dev' + (d.default ? ' on' : ''), role: 'radio', 'aria-checked': String(!!d.default) }, frag(`<span class="ws-radio-dot"></span>`), frag(`<span class="ws-ic">${fi(kindIcon(d))}</span>`), h('span', { class: 'ws-txt' }, h('span', { class: 'ws-t', text: d.name }), d.desc ? h('span', { class: 'ws-d', text: d.desc }) : null));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (!d.default) Sys.sound.set('default', kind, d.id); });
      box.append(b);
    }
  };
  ctx.sync(paint); paint();
  return box;
}
function volumeControl(ctx, kind) {
  const get = () => Sys.sound.def(kind);
  const mute = h('button', { class: 'ws-iconbtn', 'aria-label': 'Mute' });
  const paintMute = () => { const d = get(); mute.innerHTML = fi(d && (d.muted || !d.volume) ? (kind === 'source' ? 'micOff' : 'soundMute') : kind === 'source' ? 'mic' : 'sound'); mute.setAttribute('aria-pressed', String(!!(d && d.muted))); mute.disabled = !d; };
  mute.addEventListener('click', (e) => { e.stopPropagation(); const d = get(); if (d) Sys.sound.set('mute', kind, d.id, !d.muted); });
  ctx.sync(paintMute); paintMute();
  let t = 0;
  const sl = WS.slider(ctx, { min: 0, max: 100, get: () => get()?.volume ?? 0, set: (v) => { const d = get(); if (!d) return; d.volume = v; clearTimeout(t); t = setTimeout(() => Sys.sound.set('volume', kind, d.id, v), 40); }, fmt: (v) => String(v), label: kind === 'source' ? 'Input volume' : 'Volume', disabled: () => !get() });
  const val = h('span', { class: 'ws-num' });
  ctx.sync(() => { val.textContent = String(get()?.volume ?? ''); }); val.textContent = String(get()?.volume ?? '');
  return h('div', { class: 'ws-vol' }, mute, sl, val);
}
defPage('sound', { title: 'Sound', parent: 'system', icon: 'sound', keywords: 'volume speakers headphones microphone audio output input', render: (ctx) => {
  const st = Sys.sound.st;
  const shape = () => JSON.stringify([(Sys.sound.st.outputs || []).map((d) => d.id), (Sys.sound.st.inputs || []).map((d) => d.id), Sys.sound.st.available]);
  const was = shape();
  ctx.on('sys', (n) => { if (n === 'sound' && shape() !== was) ctx.rerender(); });
  const sysSounds = WS.card(ctx, { sid: 'sounds', icon: 'notifications', title: 'System sounds', desc: 'Chimes for startup, notifications and timers', ctl: WS.settingToggle(ctx, 'sounds', 'System sounds') });
  if (!IS_NATIVE) return [needsNimbus(), WS.group('Advanced', sysSounds)];
  if (!st.available) return [WS.info('warning', 'Sound isn’t working', st.error || 'The sound service isn’t running.', WS.button('Troubleshoot', () => runTroubleshooter(ctx, 'audio'))), WS.group('Advanced', sysSounds)];
  return [
    WS.group('Output',
      WS.expander(ctx, { sid: 'output', icon: 'sound', title: 'Choose where to play sound', desc: 'Programs might have their own settings', open: true, items: [deviceList(ctx, 'sink')] }),
      WS.card(ctx, { sid: 'volume', icon: 'speaker1', title: 'Volume', ctl: volumeControl(ctx, 'sink') }),
      WS.card(ctx, { icon: 'bluetooth', title: 'Pair a new output device', ctl: WS.button('Add device', () => addDeviceDialog(ctx)) })),
    WS.group('Input',
      WS.expander(ctx, { sid: 'input', icon: 'mic', title: 'Choose a device for speaking or recording', desc: 'Programs might have their own settings', open: true, items: [deviceList(ctx, 'source')] }),
      WS.card(ctx, { sid: 'inputVolume', icon: 'mic', title: 'Volume', ctl: volumeControl(ctx, 'source') })),
    WS.group('Advanced',
      WS.card(ctx, { icon: 'troubleshoot', title: 'Troubleshoot common sound problems', ctl: WS.button('Run', () => runTroubleshooter(ctx, 'audio')) }),
      WS.card(ctx, { icon: 'options', title: 'All sound devices', desc: 'Outputs and inputs, set the default', go: 'sounddevices' }),
      WS.card(ctx, { sid: 'mixer', icon: 'mixer', title: 'Volume mixer', desc: 'Volume for each program that plays sound', go: 'mixer' }),
      sysSounds),
  ];
} });
defSettings('sound', [['output', 'Choose where to play sound', 'speakers headphones output device'], ['volume', 'Volume', 'loud quiet mute'], ['input', 'Microphone', 'mic recording input device'], ['sounds', 'System sounds', 'chime beep startup']]);
defPage('sounddevices', { title: 'All sound devices', parent: 'sound', icon: 'options', keywords: 'speakers microphones', render: (ctx) => {
  if (!Sys.sound.st.available) return [WS.info('warning', 'Sound isn’t working', '')];
  const row = (d, kind) => WS.card(ctx, { iconHtml: WS.ic(kindIcon(d)), title: d.name, desc: (d.default ? 'Default · ' : '') + (d.desc || ''), ctl: d.default ? h('span', { class: 'ws-d', text: 'Default' }) : WS.button('Set as default', () => Sys.sound.set('default', kind, d.id)) });
  return [WS.group('Output devices', ...Sys.sound.st.outputs.map((d) => row(d, 'sink'))), WS.group('Input devices', ...Sys.sound.st.inputs.map((d) => row(d, 'source')))];
} });
defPage('mixer', { title: 'Volume mixer', parent: 'sound', icon: 'mixer', keywords: 'app volume per program', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  const st = Sys.sound.st;
  const apps = h('div', { class: 'ws-cards' });
  const paintApps = () => {
    apps.innerHTML = '';
    const streams = Sys.sound.st.streams || [];
    if (!streams.length) { apps.append(WS.card(ctx, { icon: 'apps', title: 'No programs are playing sound right now' })); return; }
    for (const s of streams) {
      let t = 0;
      const sl = WS.slider({ sync() {} }, { get: () => s.volume, set: (v) => { s.volume = v; clearTimeout(t); t = setTimeout(() => Sys.sound.set('volume', 'stream', s.id, v), 40); }, label: s.app + ' volume', fmt: String });
      const mb = h('button', { class: 'ws-iconbtn', 'aria-label': 'Mute ' + s.app, html: fi(s.muted ? 'soundMute' : 'sound') });
      mb.onclick = (e) => { e.stopPropagation(); Sys.sound.set('mute', 'stream', s.id, !s.muted); };
      apps.append(WS.card(ctx, { iconHtml: WS.ic('apps'), title: s.app, desc: s.name !== s.app ? s.name : '', ctl: h('div', { class: 'ws-vol' }, mb, sl) }));
    }
  };
  ctx.on('sys', (n) => { if (n === 'sound') paintApps(); }); paintApps();
  const outs = () => (Sys.sound.st.outputs || []).map((d) => [d.id, d.name]);
  const ins = () => (Sys.sound.st.inputs || []).map((d) => [d.id, d.name]);
  return [
    WS.group('System',
      WS.card(ctx, { icon: 'sound', title: 'Output device', ctl: WS.combo(ctx, outs, () => Sys.sound.def('sink')?.id, (v) => Sys.sound.set('default', 'sink', v), 'Output device', { width: 240 }) }),
      WS.card(ctx, { icon: 'mic', title: 'Input device', ctl: WS.combo(ctx, ins, () => Sys.sound.def('source')?.id, (v) => Sys.sound.set('default', 'source', v), 'Input device', { width: 240 }) }),
      WS.card(ctx, { icon: 'speaker1', title: 'Volume', ctl: volumeControl(ctx, 'sink') })),
    WS.group('Apps', apps),
    st.available ? WS.group(null, WS.card(ctx, { icon: 'reset', title: 'Reset sound devices and volumes for all programs to the defaults', ctl: WS.button('Reset', async () => { for (const s of Sys.sound.st.streams || []) await Sys.sound.set('volume', 'stream', s.id, 100); }) })) : null,
  ];
} });

/* ---------- Notifications and Focus ---------- */
defPage('notifications', { title: 'Notifications', parent: 'system', icon: 'notifications', keywords: 'alerts banners toasts do not disturb dnd', render: (ctx) => {
  const senders = Object.keys(APPS).filter((id) => appListed(id) && !APPS[id].launch).concat(['settings']).filter((v, i, a) => a.indexOf(v) === i);
  const appRow = (id) => WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon(APPS[id]?.icon || 'logo')}</span>`, title: APPS[id]?.name || 'Settings', desc: 'Banners, sounds', ctl: WS.toggle(ctx, () => !(S.data.notifOff || {})[id], (v) => S.set('notifOff', Object.assign({}, S.data.notifOff, { [id]: !v })), APPS[id]?.name + ' notifications') });
  return [
    WS.group(null,
      WS.expander(ctx, { sid: 'notifs', icon: 'notifications', title: 'Notifications', desc: 'Get notifications from apps and other senders', ctl: WS.settingToggle(ctx, 'notifs', 'Notifications'), items: [
        WS.sub({ ctl: WS.checkbox(ctx, 'Play a sound when a notification arrives', () => S.data.notifSound, (v) => S.set('notifSound', v)) }),
        WS.sub({ ctl: WS.checkbox(ctx, 'Show notifications on the lock screen', () => S.data.notifLock, (v) => S.set('notifLock', v)) }),
      ] }),
      WS.card(ctx, { sid: 'dnd', icon: 'dnd', title: 'Do not disturb', desc: 'Notifications go straight to the notification center', ctl: WS.settingToggle(ctx, 'dnd', 'Do not disturb') }),
      WS.expander(ctx, { sid: 'dndAuto', icon: 'clock', title: 'Turn on do not disturb automatically', items: [
        WS.sub({ ctl: WS.checkbox(ctx, 'During these times', () => S.data.dndAuto, (v) => S.set('dndAuto', v)) }),
        WS.sub({ title: 'From', ctl: timeInput(ctx, 'dndFrom') }), WS.sub({ title: 'To', ctl: timeInput(ctx, 'dndTo') }),
        WS.sub({ ctl: WS.checkbox(ctx, 'When a program is full screen', () => S.data.dndFull, (v) => S.set('dndFull', v)) }),
      ] }),
      WS.card(ctx, { icon: 'notifications', title: 'Send a test notification', ctl: WS.button('Send', () => Notif.push({ app: 'settings', title: 'This is a notification', body: 'Apps, timers and the system tell you things like this.' })) })),
    WS.group('Notifications from apps and other senders', ...senders.map(appRow)),
    WS.group('Additional settings', WS.card(ctx, { sid: 'notifTime', icon: 'timer', title: 'Dismiss notifications after this amount of time', ctl: WS.settingCombo(ctx, 'notifTime', [[5, '5 seconds'], [7, '7 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']], 'Notification time') })),
  ];
} });
defSettings('notifications', [['notifs', 'Notifications', 'alerts banners'], ['dnd', 'Do not disturb', 'quiet focus silence'], ['dndAuto', 'Turn on do not disturb automatically', 'schedule quiet hours full screen']]);
defPage('focus', { title: 'Focus', parent: 'system', icon: 'focus', keywords: 'focus session timer distraction', render: (ctx) => {
  const f = Clock.focus;
  return [
    WS.group(null, WS.card(ctx, { sid: 'focusStart', icon: 'focus', title: f.running ? 'A focus session is running' : 'Focus session', desc: f.running ? fmtDuration(f.left) + ' left' : 'Hide distractions for a while',
      ctl: f.running ? WS.button('Stop focus session', () => { Clock.reset('focus'); ctx.rerender(); }) : h('div', { class: 'ws-row' }, WS.combo(ctx, [[15, '15 mins'], [25, '25 mins'], [30, '30 mins'], [45, '45 mins'], [60, '1 hour'], [90, '90 mins'], [120, '2 hours']], () => S.data.focusMins, (v) => S.set('focusMins', +v), 'Session length', { width: 110 }), WS.button('Start focus session', () => { Clock.startFocus(S.data.focusMins); ctx.rerender(); }, { accent: true })) })),
    WS.group('While a focus session runs',
      WS.card(ctx, { ctl: WS.checkbox(ctx, 'Show the timer in the taskbar', () => S.data.focusTimer, (v) => S.set('focusTimer', v)) }),
      WS.card(ctx, { ctl: WS.checkbox(ctx, 'Turn on do not disturb', () => S.data.focusDnd, (v) => S.set('focusDnd', v)) })),
  ];
} });

/* ---------- Power ---------- */
defPage('power', { title: 'Power & battery', parent: 'system', icon: 'power', keywords: 'sleep screen timeout battery energy saver power mode performance', render: (ctx) => {
  const p = Sys.power.st; const bat = p.battery;
  const set = (which, k, v) => S.set(which, Object.assign({}, S.data[which], { [k]: +v }));
  const out = [];
  if (bat) out.push(h('div', { class: 'ws-battery' }, frag(`<span class="ws-battery-ic">${fi(bat.charging ? 'batteryCharge' : 'battery')}</span>`), h('div', {}, h('div', { class: 'ws-battery-pct', text: bat.percent + '%' }), h('div', { class: 'ws-d', text: bat.charging ? 'Charging' : p.ac ? 'Plugged in' : 'On battery' + (bat.timeLeft ? `, about ${fmtHM(bat.timeLeft)} left` : '') }))));
  const items = [
    WS.sub({ title: (bat ? 'Plugged in, t' : 'T') + 'urn off my screen after', ctl: WS.combo(ctx, TIMEOUTS, () => S.data.powerPlugged.screen, (v) => set('powerPlugged', 'screen', v), 'Screen off', { width: 150 }) }),
    WS.sub({ title: (bat ? 'Plugged in, p' : 'P') + 'ut my device to sleep after', ctl: WS.combo(ctx, TIMEOUTS, () => S.data.powerPlugged.sleep, (v) => set('powerPlugged', 'sleep', v), 'Sleep', { width: 150 }) }),
  ];
  if (bat) items.push(
    WS.sub({ title: 'On battery power, turn off my screen after', ctl: WS.combo(ctx, TIMEOUTS, () => S.data.powerBattery.screen, (v) => set('powerBattery', 'screen', v), 'Screen off on battery', { width: 150 }) }),
    WS.sub({ title: 'On battery power, put my device to sleep after', ctl: WS.combo(ctx, TIMEOUTS, () => S.data.powerBattery.sleep, (v) => set('powerBattery', 'sleep', v), 'Sleep on battery', { width: 150 }) }));
  const modes = { 'power-saver': 'Best power efficiency', balanced: 'Balanced', performance: 'Best performance' };
  out.push(WS.group('Power',
    WS.expander(ctx, { sid: 'timeouts', icon: 'screenOff', title: 'Screen and sleep', desc: IS_NATIVE ? '' : 'Works when Nimbus runs on a computer', open: true, items }),
    IS_NATIVE && p.profiles.length ? WS.card(ctx, { sid: 'powerMode', icon: 'gauge', title: 'Power mode', desc: 'Optimize your device based on power use and performance', ctl: WS.combo(ctx, p.profiles.map((x) => [x, modes[x] || x]), () => Sys.power.st.profile, async (v) => { await Sys.call('powerSet', { profile: v }).catch((e) => Notif.push({ app: 'settings', title: 'Power mode didn’t change', body: e.message })); Sys.power.refresh(); }, 'Power mode', { width: 210 }) }) : null));
  out.push(WS.group(bat ? 'Battery' : 'Energy',
    WS.expander(ctx, { sid: 'energySaver', icon: 'leaf', title: 'Energy saver', desc: 'Turns off transparency and animations to use less power', ctl: WS.settingToggle(ctx, 'energySaver', 'Energy saver'), items: bat ? [
      WS.sub({ title: 'Turn energy saver on automatically at', ctl: WS.settingCombo(ctx, 'saverAt', [[0, 'Never'], [10, '10%'], [20, '20%'], [30, '30%'], [40, '40%'], [50, '50%'], [100, 'Always']], 'Energy saver threshold', { width: 120 }) }),
    ] : [WS.sub({ title: 'Energy saver on a desktop PC', desc: 'Turn it on when you want this PC to use less power.' })] })));
  return out;
} });
defSettings('power', [['timeouts', 'Screen and sleep', 'timeout turn off screen sleep after minutes'], ['powerMode', 'Power mode', 'performance balanced efficiency'], ['energySaver', 'Energy saver', 'battery saver low power']]);

/* ---------- Storage ---------- */
defPage('storage', { title: 'Storage', parent: 'system', icon: 'storage', keywords: 'disk space drive cleanup temporary files storage sense', render: (ctx) => {
  const box = h('div', { class: 'ws-cards' }, WS.card(ctx, { icon: 'storage', title: 'Measuring…' }));
  const draw = (u) => {
    box.innerHTML = '';
    const used = u.total - u.free;
    box.append(h('div', { class: 'ws-card ws-storage-head' }, frag(`<span class="ws-icw">${WS.ic('storage')}</span>`), h('div', { class: 'ws-txt' }, h('div', { class: 'ws-t', text: u.label || 'Local disk' }), h('div', { class: 'ws-d', text: `${fmtBytes(used)} used of ${fmtBytes(u.total)}, ${fmtBytes(u.free)} free` }), WS.meter(used / (u.total || 1)))));
    for (const c of u.categories) box.append(WS.card(ctx, { icon: c.icon || 'folder', title: c.label, desc: fmtBytes(c.bytes), ctl: WS.meter(c.bytes / (used || 1), 'small'), go: c.go || null }));
  };
  const nimbusFiles = FS.usage();
  if (IS_NATIVE) Sys.call('storageUsage', {}, 60000).then((u) => { u.categories.push({ label: 'Your Nimbus files', bytes: nimbusFiles.bytes, icon: 'document' }); draw(u); }).catch((e) => { box.innerHTML = ''; box.append(WS.info('error', 'Couldn’t measure storage', e.message)); });
  else navigator.storage?.estimate?.().then((e) => draw({ label: 'This browser', total: e.quota || 0, free: (e.quota || 0) - (e.usage || 0), categories: [{ label: 'Your Nimbus files', bytes: nimbusFiles.bytes, icon: 'document' }] })).catch(() => {});
  return [
    IS_NATIVE && Native.live && !Storage.saving ? WS.info('info', 'This is a live session', 'Until you set up saving, Nimbus keeps your changes in memory, so this is memory, not a disk.', WS.button('Set up saving', () => ctx.go('saving'))) : null,
    WS.group('Local disk', box),
    WS.group('Storage management',
      WS.card(ctx, { sid: 'storageSense', icon: 'broom', title: 'Storage Sense', desc: 'Free up space automatically, clean up temporary files', ctl: WS.settingToggle(ctx, 'storageSense', 'Storage Sense'), go: 'storagesense' }),
      WS.card(ctx, { sid: 'cleanup', icon: 'delete', title: 'Cleanup recommendations', desc: 'Free up space by removing files you don’t need', go: 'cleanup' }),
      WS.card(ctx, { icon: 'storage', title: 'Disks & volumes', desc: 'The drives in this PC', go: 'disks' })),
  ];
} });
defSettings('storage', [['storageSense', 'Storage Sense', 'automatic cleanup free space'], ['cleanup', 'Cleanup recommendations', 'temporary files delete free space']]);
async function cleanUp(ctx, what) {
  let freed = 0;
  if (what.includes('bin')) { const n = FS.children('trash').length; if (n) { FS.emptyTrash(); freed += 0; } }
  const sysWhat = what.filter((w) => w !== 'bin');
  if (IS_NATIVE && sysWhat.length) { try { freed += (await Sys.call('storageClean', { what: sysWhat }, 120000)).freed || 0; } catch (e) { Notif.push({ app: 'settings', title: 'Cleanup didn’t finish', body: e.message }); return; } }
  Notif.push({ app: 'settings', title: 'Cleanup finished', body: freed ? `${fmtBytes(freed)} freed` : 'Temporary files are cleaned up.', silent: true });
  ctx.rerender();
}
defPage('storagesense', { title: 'Storage Sense', parent: 'storage', icon: 'broom', keywords: 'automatic cleanup', render: (ctx) => [
  WS.group('Cleanup of temporary files', WS.card(ctx, { ctl: WS.checkbox(ctx, 'Keep Nimbus running smoothly by cleaning up temporary system and program files automatically', () => S.data.storageSense, (v) => S.set('storageSense', v)) })),
  WS.group('Automatic cleanup',
    WS.card(ctx, { icon: 'clock', title: 'Run Storage Sense', ctl: WS.settingCombo(ctx, 'senseWhen', [['low', 'When disk space is low'], ['day', 'Every day'], ['week', 'Every week'], ['month', 'Every month']], 'When to run', { width: 220 }) }),
    WS.card(ctx, { icon: 'delete', title: 'Delete files in my Recycle Bin if they have been there for over', ctl: WS.settingCombo(ctx, 'senseBinDays', [[0, 'Never'], [1, '1 day'], [14, '14 days'], [30, '30 days'], [60, '60 days']], 'Recycle Bin age', { width: 140 }) })),
  WS.group(null, WS.card(ctx, { icon: 'broom', title: 'Run Storage Sense now', ctl: WS.button('Run now', () => cleanUp(ctx, ['cache', 'apt', 'tmp'])) })),
] });
defPage('cleanup', { title: 'Cleanup recommendations', parent: 'storage', icon: 'delete', keywords: 'temporary files free space', render: (ctx) => {
  const bin = FS.children('trash');
  const sizes = h('div', { class: 'ws-cards' }, WS.card(ctx, { icon: 'delete', title: 'Looking for files to clean up…' }));
  const picked = new Set(['cache', 'apt', 'tmp', 'bin']);
  const draw = (t) => {
    sizes.innerHTML = '';
    const rows = [['cache', 'Program caches', t.cache], ['apt', 'Downloaded program packages', t.apt], ['tmp', 'Temporary files', t.tmp], ['bin', `Recycle Bin (${bin.length} item${bin.length === 1 ? '' : 's'})`, null]];
    for (const [k, label, bytes] of rows) sizes.append(WS.card(ctx, { ctl: WS.checkbox(ctx, label + (bytes != null ? ` · ${fmtBytes(bytes)}` : ''), () => picked.has(k), (v) => (v ? picked.add(k) : picked.delete(k))) }));
    sizes.append(h('div', { class: 'ws-actions' }, WS.button('Clean up', () => cleanUp(ctx, [...picked]), { accent: true })));
  };
  if (IS_NATIVE) Sys.call('storageUsage', {}, 60000).then((u) => draw(u.temp || {})).catch(() => draw({}));
  else draw({});
  return [WS.group('Temporary files', sizes)];
} });
defPage('disks', { title: 'Disks & volumes', parent: 'storage', icon: 'storage', keywords: 'drives partitions usb', render: (ctx) => {
  if (!IS_NATIVE) return [needsNimbus()];
  const box = h('div', { class: 'ws-cards' }, WS.card(ctx, { icon: 'storage', title: 'Looking for drives…' }));
  Sys.call('disks').then((disks) => {
    box.innerHTML = '';
    if (!disks.length) box.append(WS.card(ctx, { icon: 'storage', title: 'No drives found' }));
    for (const d of disks) box.append(WS.expander(ctx, { iconHtml: '', icon: d.removable ? 'usb' : 'storage', title: d.model || d.name, desc: `${fmtBytes(d.size)}${d.removable ? ', removable' : ''}${d.nimbus ? ', Nimbus is running from it' : ''}`, items: (d.parts.length ? d.parts : [d]).map((p) => WS.sub({ title: p.label || p.name, desc: [p.fstype || 'No file system', p.size ? fmtBytes(p.size) : '', p.mount ? 'in use' : ''].filter(Boolean).join(', ') })) }));
  }).catch((e) => { box.innerHTML = ''; box.append(WS.info('error', 'Couldn’t list the drives', e.message)); });
  return [WS.group('Disks', box)];
} });
defPage('saving', { title: 'Saving your work', parent: 'system', icon: 'save', keywords: 'persistent persistence keep files usb live session', hidden: () => !(IS_NATIVE && Native.live), render: (ctx) => {
  const on = Storage.saving;
  return [WS.group(null, WS.card(ctx, { sid: 'saving', icon: 'save', title: on ? 'Saving is on' : 'Your work isn’t saved yet', desc: on ? 'Files, settings, Wi-Fi passwords and installed programs (like Chrome) are kept between restarts.' : 'This is a live session: files, settings and programs are gone when you shut down.',
    ctl: WS.button(on ? 'Details' : 'Set up saving', () => Storage.open(), { accent: !on }) }))];
} });

/* ---------- Multitasking, Troubleshoot, Recovery, Clipboard, About ---------- */
defPage('multitasking', { title: 'Multitasking', parent: 'system', icon: 'multitasking', keywords: 'snap layouts windows alt tab shake', render: (ctx) => [
  WS.group(null,
    WS.expander(ctx, { sid: 'snap', icon: 'snap', title: 'Snap windows', desc: 'Drag windows to the screen edges to put them side by side', ctl: WS.settingToggle(ctx, 'snapOn', 'Snap windows'), open: true, items: [
      WS.sub({ ctl: WS.checkbox(ctx, 'Show snap layouts when I hover over a window’s maximize button', () => S.data.snapHover, (v) => S.set('snapHover', v)) }),
      WS.sub({ ctl: WS.checkbox(ctx, 'Maximize a window when I drag it to the top of the screen', () => S.data.snapTop, (v) => S.set('snapTop', v)) }),
    ] }),
    WS.card(ctx, { sid: 'shake', icon: 'handWave', title: 'Title bar window shake', desc: 'When I grab a window’s title bar and shake it, minimize all other windows', ctl: WS.settingToggle(ctx, 'shake', 'Title bar window shake') }),
    WS.card(ctx, { icon: 'tab', title: 'Alt + Tab', desc: 'Pressing Alt + Tab shows', ctl: WS.combo(ctx, [['windows', 'Open windows']], () => 'windows', () => {}, 'Alt Tab', { width: 180 }) })),
] });
defSettings('multitasking', [['snap', 'Snap windows', 'layouts side by side split'], ['shake', 'Title bar window shake', 'minimize other windows']]);
async function runTroubleshooter(ctx, kind) {
  const titles = { network: 'Internet connections', audio: 'Playing audio', bluetooth: 'Bluetooth', display: 'Display' };
  const log = h('div', { class: 'ws-trouble' }, h('p', { class: 'ws-d', text: 'Looking for problems…' }), h('div', { class: 'ws-progress' }, h('i')));
  const p = Dialog.show({ title: titles[kind] + ' troubleshooter', content: log, within: ctx.win, buttons: [{ label: 'Close', value: true, primary: true }] });
  try {
    const r = await Sys.call('troubleshoot', { kind }, 90000);
    log.innerHTML = '';
    for (const step of r.steps || []) log.append(h('div', { class: 'ws-trouble-step ' + (step.ok ? 'ok' : 'bad'), html: fi(step.ok ? 'checkCircle' : 'warning') + `<span><b>${esc(step.title)}</b>${step.detail ? `<span class="ws-d">${esc(step.detail)}</span>` : ''}</span>` }));
    log.append(h('p', { class: 'ws-trouble-sum', text: r.summary || '' }));
  } catch (e) { log.innerHTML = ''; log.append(WS.info('error', 'The troubleshooter couldn’t run', e.message)); }
  await p;
  Sys.sound.refresh();
}
defPage('troubleshoot', { title: 'Troubleshoot', parent: 'system', icon: 'troubleshoot', keywords: 'fix problems repair internet audio', render: (ctx) => IS_NATIVE ? [
  WS.group('Most frequently used',
    WS.card(ctx, { sid: 'troubleNet', icon: 'wifi', title: 'Internet connections', desc: 'Checks the network, name lookups and reaching the internet', ctl: WS.button('Run', () => runTroubleshooter(ctx, 'network')) }),
    WS.card(ctx, { sid: 'troubleAudio', icon: 'sound', title: 'Playing audio', desc: 'Restarts the sound service and checks your speakers', ctl: WS.button('Run', () => runTroubleshooter(ctx, 'audio')) })),
  WS.group('Other',
    WS.card(ctx, { icon: 'bluetooth', title: 'Bluetooth', desc: 'Turns the adapter on if it was blocked', ctl: WS.button('Run', () => runTroubleshooter(ctx, 'bluetooth')) }),
    WS.card(ctx, { icon: 'display', title: 'Display', desc: 'Puts your display settings back', ctl: WS.button('Run', () => runTroubleshooter(ctx, 'display')) })),
] : [needsNimbus()] });
defSettings('troubleshoot', [['troubleNet', 'Internet connections troubleshooter', 'fix wifi network no internet'], ['troubleAudio', 'Audio troubleshooter', 'fix sound no audio crackling choppy']]);
defPage('recovery', { title: 'Recovery', parent: 'system', icon: 'recovery', keywords: 'reset restore firmware uefi bios advanced startup go back previous version undo update', render: (ctx) => [
  WS.group('Recovery options',
    goBackCard(ctx),
    WS.card(ctx, { sid: 'reset', icon: 'reset', title: 'Reset this PC', desc: 'Erase your Nimbus files and settings and start fresh', ctl: WS.button('Reset PC', () => resetPC(ctx.win)) }),
    IS_NATIVE ? WS.card(ctx, { sid: 'firmware', icon: 'restart', title: 'Advanced startup', desc: Native.info && Native.info.uefi ? 'Restart into your PC’s firmware settings (UEFI) to change the startup order or Secure Boot' : 'Restart; the Nimbus startup menu has more options', ctl: WS.button('Restart now', async () => {
      const ok = await Dialog.confirm('Restart now?', 'Save your work first. Your PC restarts' + (Native.info.uefi ? ' into its firmware settings.' : '.'), { ok: 'Restart now', within: ctx.win });
      if (ok) Sys.call('firmwareReboot', { firmware: !!Native.info.uefi }).catch((e) => Notif.push({ app: 'settings', title: 'Couldn’t restart', body: e.message }));
    }) }) : null),
  WS.group('Related support', WS.card(ctx, { icon: 'troubleshoot', title: 'Fix problems without resetting your PC', go: 'troubleshoot' })),
] });
defSettings('recovery', [['goback', 'Go back to the previous version', 'undo update uninstall rollback downgrade'], ['reset', 'Reset this PC', 'erase wipe factory fresh start'], ['firmware', 'Advanced startup', 'uefi bios firmware boot menu']]);
defPage('clipboard', { title: 'Clipboard', parent: 'system', icon: 'clipboard', keywords: 'copy paste history windows v', render: (ctx) => [
  WS.group(null,
    WS.card(ctx, { sid: 'clipHistory', icon: 'clipboard', title: 'Clipboard history', desc: 'Save what you copy so you can paste it later. Press the Windows key + V to see it.', ctl: WS.settingToggle(ctx, 'clipHistory', 'Clipboard history') }),
    WS.card(ctx, { icon: 'delete', title: 'Clear clipboard data', ctl: WS.button('Clear', () => { ClipHistory.clear(); Notif.push({ app: 'settings', title: 'Clipboard cleared', silent: true }); }) })),
] });
defSettings('clipboard', [['clipHistory', 'Clipboard history', 'win v paste copied']]);
defPage('about', { title: 'About', parent: 'system', icon: 'about', keywords: 'specs specifications version processor memory ram rename', render: (ctx) => {
  const ni = IS_NATIVE && Native.info;
  const specs = ni ? [['Device name', pcName()], ['Processor', `${ni.cpu}`], ['Installed RAM', fmtBytes(ni.memory)], ['Device ID', ni.machineId || '—'], ['System type', !ni.arch || ni.arch === 'x86_64' ? '64-bit operating system, x64-based processor' : ni.arch], ['Pen and touch', ni.touch ? 'Touch support' : 'No pen or touch input is available for this display']]
    : [['Device name', pcName()], ['Processor', navigator.hardwareConcurrency ? navigator.hardwareConcurrency + ' logical processors' : 'Not reported'], ['Memory', navigator.deviceMemory ? 'About ' + navigator.deviceMemory + ' GB' : 'Not reported'], ['Runs in', browserName()]];
  const nimbus = ni ? [['Edition', osTitle()], ['Version', ni.version + (ni.build ? ` (build ${ni.build})` : '')], ['Built on', ni.built ? fmtDT(ni.built * 1000, { dateStyle: 'medium' }) : '—'], ['Running', ni.live ? (Storage.saving ? 'From a USB stick or disc, saving your work' : 'From a USB stick or disc (live session)') : 'Installed'], ['Based on', ni.base], ['Linux', ni.kernel]]
    : [['Edition', osTitle()], ['Version', '0.1'], ['Running', 'In a browser tab']];
  const table = (rows) => h('dl', { class: 'ws-specs' }, ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
  const copy = (rows) => WS.button('Copy', async () => { const ok = await copyText(rows.map(([k, v]) => `${k}\t${v}`).join('\n')); Notif.push({ app: 'settings', title: ok ? 'Copied' : 'Couldn’t copy', silent: true }); });
  return [
    h('div', { class: 'ws-about-head' }, deviceArt(ctx), h('div', {}, h('div', { class: 'ws-hero-name', text: pcName() }), h('div', { class: 'ws-d', text: (ni && ni.device) || '' })), WS.button('Rename this PC', () => renamePC(ctx))),
    WS.group(null, WS.expander(ctx, { sid: 'specs', icon: 'about', title: 'Device specifications', ctl: copy(specs), open: true, items: [table(specs)] }),
      WS.expander(ctx, { sid: 'nimbusSpecs', iconHtml: '', icon: 'sparkle', title: 'Nimbus specifications', ctl: copy(nimbus), open: true, items: [table(nimbus)] })),
    WS.group('Related', WS.card(ctx, { sid: 'osName', icon: 'edit', title: 'Rename your OS', desc: 'Shown at startup, on the lock screen and in Welcome', ctl: WS.textbox(ctx, { get: () => S.data.osName, set: (v) => S.set('osName', v.trim() || 'Nimbus'), width: 200, label: 'OS name' }) })),
  ];
} });
defSettings('about', [['specs', 'Device specifications', 'processor cpu ram memory'], ['nimbusSpecs', 'Nimbus version', 'build ubuntu kernel'], ['osName', 'Rename your OS', 'name']]);
