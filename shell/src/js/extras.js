/* ========== Things Settings switches on ==========
   Screenshots (Print screen), clipboard history (Windows key + V), the volume and brightness keys,
   night light's schedule, Game Mode, apps that start when you sign in, and microphone privacy. */

/* ---- Screenshots: grim through the launcher, saved to Pictures > Screenshots ---- */
const Shots = {
  folder() {
    let f = FS.children('pictures').find((n) => n.type === 'folder' && n.name === 'Screenshots');
    if (!f) f = FS.create('pictures', 'Screenshots', 'folder');
    return f.id;
  },
  busy: false,
  async take() {
    if (!IS_NATIVE || this.busy) return;
    this.busy = true;
    try {
      const r = await Sys.call('screenshot', { clip: S.data.shotClip !== false }, 30000);
      flashScreen();
      const name = 'Screenshot ' + new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '') + '.png';
      const n = FS.create(this.folder(), name, 'file', r.data, 'image');
      Notif.push({ app: 'photos', title: 'Screenshot saved', body: (S.data.shotClip !== false ? 'Copied to the clipboard and saved' : 'Saved') + ' to Pictures › Screenshots.', action: () => WM.open('photos', { file: n.id }), silent: true });
    } catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t take a screenshot', body: e.message }); }
    this.busy = false;
  },
};

/* ---- Clipboard history ---- */
const ClipHistory = {
  items: [],
  load() { try { this.items = JSON.parse(localStorage.getItem('nimbus-clip') || '[]'); } catch { this.items = []; } },
  save() { try { localStorage.setItem('nimbus-clip', JSON.stringify(this.items.filter((x) => x.pinned || this.items.indexOf(x) < 25))); } catch {} },
  add(item) {
    if (!S.data.clipHistory || !item || (!item.text && !item.image)) return;
    if (item.text && item.text.length > 20000) item.text = item.text.slice(0, 20000);
    const same = this.items.find((x) => (item.text && x.text === item.text) || (item.image && x.image === item.image));
    if (same) this.items = this.items.filter((x) => x !== same);
    this.items.unshift(Object.assign({ id: uid(), time: Date.now(), pinned: !!(same && same.pinned) }, item));
    const keep = this.items.filter((x) => x.pinned), rest = this.items.filter((x) => !x.pinned).slice(0, 25);
    this.items = this.items.filter((x) => keep.includes(x) || rest.includes(x));
    this.save(); bus.emit('clip-history');
  },
  clear() { this.items = this.items.filter((x) => x.pinned); this.save(); bus.emit('clip-history'); if (IS_NATIVE) Sys.call('clipboardSet', { text: '' }).catch(() => {}); },
  watch() { if (IS_NATIVE) Sys.call('clipWatch', { on: !!S.data.clipHistory }).catch(() => {}); },
  async paste(item) {
    Flyouts.close();
    if (IS_NATIVE) {
      try { await Sys.call('clipboardSet', item.image ? { image: item.image } : { text: item.text }); } catch { return; }
      setTimeout(() => NativeWin.call('paste', {}), 120); // into the window that had the keyboard
    } else {
      const ok = await copyText(item.text || '');
      Notif.push({ app: 'settings', title: ok ? 'Copied' : 'Couldn’t copy', body: ok ? 'Press Ctrl+V to paste it.' : '', silent: true });
    }
  },
};
ClipHistory.load();
bus.on('native:clipboard', (d) => ClipHistory.add(d));
document.addEventListener('copy', () => { if (!IS_NATIVE) setTimeout(() => { const t = String(getSelection() || ''); if (t) ClipHistory.add({ text: t }); }, 0); }, true);

/* The Windows key + V panel, a flyout like Quick settings */
const ClipFly = {
  open() { this.render(); },
  render() {
    const el = document.getElementById('clip'); el.innerHTML = '';
    const head = h('div', { class: 'clip-head' }, h('h3', { text: 'Clipboard history' }));
    if (S.data.clipHistory && ClipHistory.items.length) head.append(h('button', { class: 'btn sm', text: 'Clear all', onclick: () => { ClipHistory.clear(); this.render(); } }));
    el.append(head);
    if (!S.data.clipHistory) {
      el.append(h('div', { class: 'clip-off' }, h('p', { text: 'Turn it on to see things you copy here, and paste them again later.' }), h('button', { class: 'btn primary', text: 'Turn on', onclick: () => { S.set('clipHistory', true); this.render(); } })));
      return;
    }
    if (!ClipHistory.items.length) { el.append(h('p', { class: 'clip-empty', text: 'You’ll see your clipboard history here once you’ve copied something.' })); return; }
    const list = h('div', { class: 'clip-list' });
    for (const it of ClipHistory.items) {
      const b = h('div', { class: 'clip-item', role: 'button', tabindex: '0' });
      b.append(it.image ? h('img', { src: it.image, alt: 'Copied picture' }) : h('div', { class: 'clip-text', text: it.text }));
      const pin = h('button', { class: 'ibtn', 'aria-label': it.pinned ? 'Unpin' : 'Pin', 'data-tip': it.pinned ? 'Unpin' : 'Pin', html: ui(it.pinned ? 'unpin' : 'pin') });
      pin.addEventListener('click', (e) => { e.stopPropagation(); it.pinned = !it.pinned; ClipHistory.save(); this.render(); });
      const del = h('button', { class: 'ibtn', 'aria-label': 'Delete', 'data-tip': 'Delete', html: ui('trash') });
      del.addEventListener('click', (e) => { e.stopPropagation(); ClipHistory.items = ClipHistory.items.filter((x) => x !== it); ClipHistory.save(); this.render(); });
      b.append(h('div', { class: 'clip-acts' }, pin, del));
      b.addEventListener('click', () => ClipHistory.paste(it));
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') ClipHistory.paste(it); });
      list.append(b);
    }
    el.append(list);
    requestAnimationFrame(() => list.querySelector('.clip-item')?.focus());
  },
};
bus.on('clip-history', () => { if (Flyouts.cur === 'clip') ClipFly.render(); });

/* ---- Volume and brightness keys, with Windows' little indicator ---- */
const OSD = {
  t: 0,
  show(icon, value, label) {
    const el = document.getElementById('osd');
    el.innerHTML = `<span class="osd-ic">${FLUENT[icon] ? fi(icon) : ui(icon)}</span><span class="osd-bar"><i style="width:${clamp(value, 0, 100)}%"></i></span><span class="osd-v">${esc(label != null ? label : String(Math.round(value)))}</span>`;
    el.hidden = false; requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(this.t); this.t = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; NativeWin.schedule(); }, 200); }, 1600);
    NativeWin.schedule();
  },
};
function hardwareKey(k) {
  if (k === 'volume-up' || k === 'volume-down') {
    const v = clamp((S.data.volume || 0) + (k === 'volume-up' ? 2 : -2), 0, 100);
    if (S.data.muted && IS_NATIVE) { const d = Sys.sound.def('sink'); if (d) Sys.sound.set('mute', 'sink', d.id, false); }
    S.set('volume', v); OSD.show(v ? 'volume' : 'mute', v);
    return true;
  }
  if (k === 'volume-mute') {
    const d = IS_NATIVE && Sys.sound.def('sink');
    if (d) { Sys.sound.set('mute', 'sink', d.id, !d.muted); S.set('muted', !d.muted); } else S.set('muted', !S.data.muted);
    OSD.show(S.data.muted ? 'mute' : 'volume', S.data.muted ? 0 : S.data.volume, S.data.muted ? 'Muted' : null);
    return true;
  }
  if (k === 'mic-mute') { const d = IS_NATIVE && Sys.sound.def('source'); if (d) Sys.sound.set('mute', 'source', d.id, !d.muted); OSD.show('mic', d && !d.muted ? 0 : 100, d && !d.muted ? 'Microphone off' : 'Microphone on'); return true; }
  if (k === 'brightness-up' || k === 'brightness-down') {
    const min = Sys.display.st.backlight ? 5 : 30;
    const v = clamp((S.data.brightness || 100) + (k === 'brightness-up' ? 10 : -10), min, 100);
    S.set('brightness', v); OSD.show('sun', v);
    return true;
  }
  if (k === 'print' || k === 'super+shift+s') { if (k !== 'print' || S.data.printScreen !== false) Shots.take(); return true; }
  if (k === 'super+v') { Flyouts.toggle('clip'); return true; }
  return false;
}

/* ---- Night light on a schedule ---- */
let nightWant = null;
function nightSchedule() {
  if (!S.data.nightSchedule) { nightWant = null; return; }
  const want = inHours(S.data.nightFrom, S.data.nightTo);
  if (want !== nightWant) { nightWant = want; if (!!S.data.nightLight !== want) S.set('nightLight', want); }
}

/* ---- Game Mode: best performance and quiet while a program is full screen ---- */
const GameMode = {
  on: false, prevProfile: '',
  check() {
    const w = WM.active();
    const full = !!(S.data.gameMode && w && (w.full || w.state === 'full'));
    if (full === this.on) return;
    this.on = full;
    if (!IS_NATIVE || !Sys.power.st.profiles.includes('performance')) return;
    if (full) { this.prevProfile = Sys.power.st.profile; if (this.prevProfile !== 'performance') Sys.call('powerSet', { profile: 'performance' }).then(() => Sys.power.refresh()).catch(() => {}); }
    else if (this.prevProfile && this.prevProfile !== 'performance') Sys.call('powerSet', { profile: this.prevProfile }).then(() => Sys.power.refresh()).catch(() => {});
  },
};
bus.on('wm', () => GameMode.check());

/* ---- Microphone access off: Nimbus keeps every microphone muted ---- */
function micGuard() {
  if (!IS_NATIVE || S.data.micAccess !== false || !Sys.sound.st.available) return;
  for (const d of Sys.sound.st.inputs || []) if (!d.muted) Sys.sound.set('mute', 'source', d.id, true);
}
bus.on('sys', (n) => { if (n === 'sound') micGuard(); });

/* ---- Apps that start when you sign in ---- */
function startupApps() {
  const ids = (S.data.startupApps || []).filter(appListed);
  ids.forEach((id, i) => setTimeout(() => WM.open(id), 900 + i * 400));
}

/* ---- The screen turning off by itself, and sleeping (the window manager's idle timers) ---- */
bus.on('native:idle', (e) => {
  if (!e) return;
  if (e.what === 'sleep') Power.sleep();
  else if (e.what === 'off' && S.data.lockPin && S.data.lockOnWake !== false) Power.lock();
});

/* ---- Updates: what the launcher may do by itself, and a daily look for new versions ---- */
function updatePrefs() { if (IS_NATIVE) Sys.call('updatePrefs', { auto: S.data.autoUpdate !== false, metered: !!S.data.updMetered, paused: S.data.updPause || 0 }).catch(() => {}); }
async function dailyUpdateCheck() {
  if (!IS_NATIVE || S.data.updNotify === false || (S.data.updPause && S.data.updPause > Date.now())) return;
  if (S.data.updChecked && Date.now() - S.data.updChecked < 20 * 3600e3) return;
  if (Net.status && Net.status.connectivity === 'none') return;
  try {
    Upd.st = await Sys.call('updateCheck', {}, 120000); S.set('updChecked', Date.now());
    const s = Upd.st;
    if (s.nimbusNew || (s.chrome && s.chrome.update)) Notif.push({ app: 'settings', title: 'Updates are available', body: [s.nimbusNew ? 'A new version of Nimbus OS' : '', s.chrome && s.chrome.update ? 'Google Chrome ' + s.chrome.candidate : ''].filter(Boolean).join(' and '), action: () => WM.open('settings', { page: 'update' }) });
  } catch {}
}

function extrasInit() {
  Object.assign(APPLY, { clipHistory: () => ClipHistory.watch(), nightSchedule, nightFrom: () => { nightWant = null; nightSchedule(); }, nightTo: () => { nightWant = null; nightSchedule(); }, gameMode: () => GameMode.check(), micAccess: micGuard,
    autoUpdate: updatePrefs, updMetered: updatePrefs, updPause: updatePrefs });
  setInterval(nightSchedule, 30000); nightSchedule();
  ClipHistory.watch();
  updatePrefs();
  if (IS_NATIVE) { setTimeout(dailyUpdateCheck, 150000); setInterval(dailyUpdateCheck, 3 * 3600e3); }
}

/* Boot tests only ("nimbus.test=settings"): Settings' hardware through the real services, written to the
   system log for os/qmp.py to read; the Settings pages open one after another for its screenshots. */
async function testSettings() {
  const log = (t) => Native.call('log', { text: 'test settings: ' + t }).catch(() => {});
  try {
    let snd = Sys.sound.st;
    for (let i = 0; i < 30; i++) { snd = await Sys.sound.refresh(); if (snd.available && snd.outputs.length) break; await sleep(2000); }
    log(`sound ${snd.available ? 'available' : 'unavailable (' + (snd.error || '') + ')'} outputs=${snd.outputs.length} default=${(Sys.sound.def('sink') || {}).name || 'none'}`);
    const d = Sys.sound.def('sink');
    if (d) {
      await Sys.call('soundSet', { what: 'volume', kind: 'sink', id: d.id, value: 37 });
      await sleep(1000); await Sys.sound.refresh();
      log('volume now ' + (Sys.sound.def('sink') || {}).volume);
    }
    let ds = await Sys.display.refresh();
    for (let i = 0; i < 10 && !ds.outputs.length; i++) { await sleep(1000); ds = await Sys.display.refresh(); }
    const o = ds.outputs[0];
    log(o ? `display ${o.name} ${o.width}x${o.height} modes=${o.modes.length} scale=${o.scale}` : 'display none');
    if (o) {
      const target = o.modes.find((m) => m[0] === 1280 && m[1] === 800) || o.modes.find((m) => m[0] !== o.width);
      if (target) {
        await Sys.display.set({ name: o.name, mode: target.slice(0, 3) });
        await sleep(3000); const n = (await Sys.display.refresh()).outputs[0];
        log(`resolution changed to ${n.width}x${n.height}`);
        await Sys.display.set({ name: o.name, mode: [o.width, o.height, o.refresh], scale: 1 });
        await sleep(3000); const b = (await Sys.display.refresh()).outputs[0];
        log(`resolution back to ${b.width}x${b.height}`);
      }
    }
    const inp = await Sys.input.refresh(); log(`input keyboards=${inp.keyboards.length} pointers=${inp.pointers.length}`);
    const bt = await Sys.bt.refresh(); log('bluetooth ' + (bt.available ? 'adapter' : 'no adapter') + (bt.error ? ' (' + bt.error + ')' : ''));
    const pw = await Sys.power.refresh(); log('power modes ' + (pw.profiles.join(',') || 'none') + ' active=' + (pw.profile || 'none'));
    const tm = await Sys.time.refresh(); log(`time ntp=${tm.ntp} zone=${tm.timezone}`);
    const pr = await Sys.call('printers').catch((e) => ({ available: false, error: e.message })); log('printing ' + (pr.available ? 'ready' : 'unavailable (' + pr.error + ')'));
    const st = await Sys.call('storageUsage', {}, 60000).catch((e) => ({ error: e.message })); log('storage ' + (st.total ? fmtBytes(st.total) + ' total' : 'failed (' + st.error + ')'));
    for (const p of ['system', 'sound', 'display', 'devices', 'network', 'personalization', 'time', 'update']) {
      WM.open('settings', { page: p }); await sleep(3500);
      const err = [...document.querySelectorAll('.app-settings .ws-info.error')].map((e) => e.textContent).find((t) => /couldn’t open/.test(t));
      log('page ' + p + (err ? ' failed: ' + err : ''));
    }
    // every other page, quickly
    const broken = [];
    for (const p of Object.keys(SPAGES)) {
      WM.open('settings', { page: p }); await sleep(120);
      if ([...document.querySelectorAll('.app-settings .ws-info.error')].some((e) => /couldn’t open/.test(e.textContent))) broken.push(p);
    }
    log(`all pages: ${Object.keys(SPAGES).length} opened, ${broken.length} failed${broken.length ? ': ' + broken.join(', ') : ''}`);
    WM.open('settings', { page: 'system' });
    log('done');
  } catch (e) { log('failed: ' + e.message); }
}
