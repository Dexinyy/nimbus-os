/* ========== Programs' windows (nimbus-wm) ==========
   On Nimbus OS the desktop page runs under nimbus-wm, the window manager, which draws real
   programs' windows (Google Chrome, or anything started from Terminal) above the page.
   This module keeps the two in step:
   - windows the window manager reports become stand-ins in WM's stack (see WM.openNative), so
     the taskbar, Alt+Tab, task view and snapping treat them like Nimbus's own windows;
   - each frame it works out which parts of the page belong above each program window
     (Nimbus windows stacked higher, the taskbar, menus...) and sends that as a "layout";
   - it moves the keyboard between the page and programs, and handles keys like the Windows
     key that the window manager passes on while a program has the keyboard.
   Without the window manager (a browser, or the old kiosk session) every call does nothing. */
const NativeWin = {
  on: false,
  kbd: 0,           // what has the keyboard: a window manager id, or 0 for the page
  prevKbd: 0, kbdAt: 0, restore: 0, uiOpen: false,
  raf: 0, burstUntil: 0, lastLayout: '', lastArea: '', lastOverlay: '',

  init() {
    if (!IS_NATIVE || !Native.info || !Native.info.wm) return;
    this.on = true;
    caps.programs = true;
    document.documentElement.classList.add('wm');
    bus.on('native:wm', (ev) => { try { this.event(ev); } catch (e) { console.error(e); } });
    const os = document.getElementById('os');
    // Anything outside apps' own content that changes may move what sits above a program's window.
    new MutationObserver((muts) => {
      for (const m of muts) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (t && t.closest('.win-body') && !t.matches('.win-body')) continue;
        this.schedule(); return;
      }
    }).observe(os, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    for (const type of ['transitionend', 'animationend', 'animationstart', 'transitionstart']) os.addEventListener(type, () => this.schedule(), true);
    window.addEventListener('resize', () => this.schedule());
    this.area(WM.area());
    this.overlay();
    bus.emit('caps');
  },
  call(cmd, args = {}) {
    if (!this.on) return;
    Native.call('wm', Object.assign({ cmd }, args), 5000).catch((e) => console.warn('window manager:', e.message));
  },
  area(A) {
    if (!this.on) return;
    const key = [A.x, A.y, A.w, A.h].join(' ');
    if (key === this.lastArea) return;
    this.lastArea = key; this.call('area', { x: A.x, y: A.y, w: A.w, h: A.h });
  },
  // Brightness and night light tint program windows too, so the window manager draws them over everything.
  overlay() {
    if (!this.on) return;
    const dim = Math.round(((100 - clamp(S.data.brightness, 30, 100)) / 100) * 0.8 * 1000);
    const night = S.data.nightLight ? Math.round((0.1 + (clamp(S.data.nightStrength, 0, 100) / 100) * 0.45) * 600) : 0; // a plain tint, lighter than the page's multiplied one
    const key = dim + ' ' + night; if (key === this.lastOverlay) return;
    this.lastOverlay = key; this.call('overlay', { dim, night });
  },
  focus(id, force) {
    if (!this.on) return;
    if (id && this.uiOpen) { this.restore = id; return; } // a menu is open: the window gets the keyboard when it closes
    if (!force && id === this.kbd) return;
    this.kbd = id; this.call('focus', { id });
  },

  /* ---- events from the window manager ---- */
  event(ev) {
    switch (ev.ev) {
      case 'hello': this.lastArea = ''; this.lastLayout = ''; this.lastOverlay = ''; this.area(WM.area()); this.overlay(); this.schedule(); Sys.wmReady(); break;
      case 'output': this.lastArea = ''; this.lastLayout = ''; this.lastOverlay = ''; this.area(WM.area()); this.overlay(); this.schedule(); Sys.display.refresh(); break;
      case 'new': WM.openNative(ev, Apps.forWindow(ev.app, ev)); if (!ev.min) this.kbd = ev.id; this.schedule(); break; // new windows get the keyboard
      case 'gone': WM.nativeGone(ev.id); break;
      case 'title': WM.nativeTitle(ev.id, ev.title); break;
      case 'app': { const w = WM.byNid(ev.id); if (w) { w.appId = Apps.forWindow(ev.app, { flatpak: w.flatpak, title: w.title }); w.app = APPS[w.appId]; bus.emit('wm'); } break; }
      case 'parent': { const w = WM.byNid(ev.id); if (w) w.parent = ev.parent; break; }
      case 'deco': WM.nativeDeco(ev.id, ev.deco); break;
      case 'geom': WM.nativeGeom(ev); break;
      case 'moving': WM.nativeMoving(ev, false); break;
      case 'moved': WM.nativeMoving(ev, true); break;
      case 'focus':
        // the window manager moved the keyboard after a click
        this.prevKbd = this.kbd; this.kbd = ev.id; this.kbdAt = Date.now();
        if (ev.id) { const w = WM.byNid(ev.id); if (w) WM.focus(w, true); }
        break;
      case 'req': {
        const w = WM.byNid(ev.id); if (!w) break;
        if (ev.what === 'min') WM.minimize(w);
        else if (ev.what === 'activate') WM.focus(w);
        else if (ev.what === 'menu') WM.titleMenu(w, ev.x, ev.y);
        break;
      }
      case 'key': this.key(ev.key); break;
    }
  },
  // Nimbus's shortcuts, passed on by the window manager while a program has the keyboard
  key(k) {
    if (/^(volume-|brightness-|mic-mute)/.test(k)) { hardwareKey(k); return; } // these work on the lock screen too
    if (document.getElementById('screens').childElementCount) return;
    if (hardwareKey(k)) return;
    if (k === 'super') { if (!Menu.isOpen) Flyouts.toggle('start'); return; }
    if (k.startsWith('super+')) {
      const name = k.slice(6);
      const key = { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', tab: 'Tab' }[name] || name;
      metaShortcut({ key, preventDefault() {} });
      return;
    }
    if (k === 'alt+tab' || k === 'alt+shift+tab') { if (!Switcher.el) Switcher.open(); else Switcher.move(k === 'alt+tab' ? 1 : -1); return; }
    if (k === 'alt+f4') { altF4(); return; }
    if (k === 'ctrl+shift+escape' || k === 'ctrl+alt+delete') { WM.open('taskmgr'); return; }
    if (k === 'ctrl+alt+t') WM.open('terminal');
    else if (k === 'ctrl+alt+d') WM.showDesktop();
    else if (k === 'ctrl+alt+l') Power.lock();
  },

  /* ---- layout: which parts of the page go above each program window ---- */
  schedule() {
    if (!this.on) return;
    this.burstUntil = Date.now() + 350; // keep following animations for a moment
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  },
  frame() {
    this.raf = 0;
    this.send(this.compute());
    if (Date.now() < this.burstUntil) this.raf = requestAnimationFrame(() => this.frame());
  },
  compute() {
    const os = document.getElementById('os');
    const vis = (el) => !!el && el.isConnected && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const rect = (el, r) => { const b = el.getBoundingClientRect(); return [Math.floor(b.left), Math.floor(b.top), Math.ceil(b.right) - Math.floor(b.left), Math.ceil(b.bottom) - Math.floor(b.top), r == null ? Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) : r]; };
    const natives = WM.list().filter((w) => w.native && !w.min).sort((a, b) => WM.zOf(a) - WM.zOf(b));
    const top = [];
    // Things that need the keyboard while they're open
    const ui = !!(Flyouts.cur || Menu.isOpen || Switcher.el || document.querySelector('#os .modal') || os.classList.contains('tv') || document.getElementById('screens').childElementCount);
    if (os.classList.contains('tv') || document.getElementById('screens').childElementCount) {
      top.push([0, 0, innerWidth, innerHeight, 0]); // task view and the lock screen cover everything
    } else {
      const act = WM.active();
      const fullTop = act && act.native && act.full && !act.min && natives[natives.length - 1] === act;
      const tb = document.getElementById('taskbar');
      if ((!fullTop || Flyouts.cur) && vis(tb)) top.push(rect(tb));
      for (const id of ['start', 'qs', 'nc', 'clip', 'osd']) { const el = document.getElementById(id); if (el && !el.hidden) top.push(rect(el)); }
      for (const el of document.querySelectorAll('#os > .menu, body > .menu, #os .switcher, #os .snapfly, #os .modal, #toasts > .toast')) if (vis(el)) top.push(rect(el));
      const tip = document.getElementById('tip'); if (tip.classList.contains('show')) top.push(rect(tip));
    }
    this.uiChanged(ui);
    if (!natives.length) return { top: [], stack: [] };
    // Nimbus windows (and the snap preview, and stand-ins flying to the taskbar) interleave with programs by z order
    const layers = [];
    for (const el of document.querySelectorAll('#windows > .win:not(.native), #windows > .win.native.ghost, #snap-preview.show')) {
      if (!vis(el)) continue;
      layers.push({ z: parseInt(el.style.zIndex, 10) || 0, r: rect(el, el.classList.contains('max') ? 0 : null) });
    }
    // the title bars Nimbus draws for X11 programs' windows go above the program windows below them (their resize
    // edges, being invisible, don't: those work where the desktop shows around the window)
    for (const el of document.querySelectorAll('#windows > .win.native.deco:not(.ghost):not(.full)')) {
      if (!vis(el)) continue;
      const bar = el.querySelector(':scope > .win-titlebar');
      if (bar && vis(bar)) layers.push({ z: parseInt(el.style.zIndex, 10) || 0, r: rect(bar, 0) });
    }
    const stack = natives.map((w) => [w.nid, layers.filter((l) => l.z > WM.zOf(w)).map((l) => l.r)]);
    return { top, stack };
  },
  send(layout) {
    const key = JSON.stringify(layout);
    if (key === this.lastLayout) return;
    this.lastLayout = key;
    this.call('layout', layout);
  },
  // Start, menus, dialogs and the switcher take the keyboard; when they close it goes back to the program.
  uiChanged(open) {
    if (open === this.uiOpen) return;
    this.uiOpen = open;
    if (open) {
      this.restore = this.kbd || (Date.now() - this.kbdAt < 1500 ? this.prevKbd : 0);
      if (this.kbd) { this.kbd = 0; this.call('focus', { id: 0 }); }
    } else {
      const w = WM.active(), id = this.restore; this.restore = 0;
      if (id && w && w.native && w.nid === id && !w.min) this.focus(id, true);
    }
  },
};

/* ========== Programs Nimbus can install (Google Chrome) ========== */
const Apps = {
  status: {},
  // A window's app id (from the program; an X11 window's class) to the entry in APPS that shows it
  forWindow(appId, ev) {
    const id = String(appId || '');
    if (/^(google-chrome|chrome)/i.test(id)) return 'chrome';
    const program = Programs.forWindow(id, ev); // from the Store
    if (program) return program;
    const key = 'x:' + (id || (ev && ev.flatpak) || 'program');
    if (!APPS[key]) {
      // a game Steam started, or a Windows program Lutris runs: its window's title names it best
      const game = ev && ev.flatpak && /^(com\.valvesoftware\.Steam|net\.lutris\.Lutris)$/.test(ev.flatpak) && ev.title;
      const name = game ? ev.title : id ? id.replace(/^.*\./, '').replace(/\.exe$/i, '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Program';
      APPS[key] = { name, icon: game ? 'launcher' : 'app', native: true, requires: 'never', desc: '' };
      if (id) Native.call('appInfo', { appId: id }).then((info) => {
        if (!info) return;
        if (info.name) APPS[key].name = info.name;
        if (info.icon) APPS[key].icon = info.icon;
        bus.emit('wm');
      }).catch(() => {});
    }
    return key;
  },
  async refresh() {
    if (!IS_NATIVE) return this.status;
    try { this.status = (await Native.call('appStatus')) || {}; } catch { this.status = {}; }
    const c = this.status.chrome;
    APPS.chrome.icon = c && c.installed && c.icon ? c.icon : 'browser';
    bus.emit('apps'); bus.emit('wm');
    return this.status;
  },
  installed(id) { return !!(this.status[id] && this.status[id].installed); },
  async launch(id, args = {}) {
    if (!this.installed(id)) await this.refresh();
    if (!this.installed(id)) { WM.open('installer', { app: id, url: args.url || '' }); return; }
    try { await Native.call('appLaunch', { app: id, url: args.url || '' }); }
    catch (e) { Notif.push({ app: id, title: APPS[id].name + ' could not start', body: e.message }); }
  },
  openUrl(url) {
    if (!/^(https?|file):/i.test(String(url || ''))) return;
    return this.launch('chrome', { url });
  },
};
if (IS_NATIVE) bus.on('native:open-url', (d) => { const urls = (d && d.urls) || []; Apps.launch('chrome', { url: urls[0] || '' }); });

/* The window that downloads and installs Chrome */
function mountInstaller(root, api, args) {
  const id = args.app || 'chrome';
  const app = APPS[id];
  root.classList.add('app-installer');
  const head = h('div', { class: 'in-head' }, h('span', { class: 'in-icon', html: appIcon(app.icon) }), h('div', {}, h('h2', { text: app.name }), h('p', { class: 'muted', text: 'from Google' })));
  const body = h('div', { class: 'in-body' });
  const foot = h('div', { class: 'in-foot' });
  root.append(head, body, foot);
  let busy = false, url = args.url || '';
  api.onArgs = (a) => { if (a && a.url) url = a.url; };
  api.beforeClose(() => !busy || Dialog.confirm('Stop installing?', 'Chrome keeps installing in the background and opens when it is ready.', { ok: 'Close' }));
  const button = (label, fn, primary) => h('button', { class: 'btn' + (primary ? ' primary' : ''), text: label, onclick: fn });
  function ask() {
    body.innerHTML = '';
    body.append(
      h('p', { text: 'Google Chrome is the web browser for Nimbus. Nimbus downloads it from Google (about 120 MB), installs it and keeps it up to date.' }),
      h('p', { class: 'muted small', text: 'By installing, you agree to the Google Terms of Service (policies.google.com/terms) and the Chrome and ChromeOS Additional Terms of Service (google.com/chrome/terms).' }));
    if (Native.info && Native.info.live && !Native.info.persistent) {
      body.append(h('p', { class: 'in-note', html: ui('info') + '<span>Saving isn’t on, so Chrome is removed when you restart. <a href="#" data-save>Set up saving</a> to keep it.</span>' }));
      body.querySelector('[data-save]').addEventListener('click', (e) => { e.preventDefault(); Storage.open(); });
    }
    foot.innerHTML = '';
    foot.append(button('Not now', () => api.close(true)), button('Install', install, true));
    foot.querySelector('.primary').focus();
  }
  async function install() {
    busy = true;
    const bar = h('div', { class: 'in-bar' }, h('i'));
    const status = h('p', { class: 'in-status', text: 'Getting ready…' });
    body.innerHTML = ''; body.append(status, bar); foot.innerHTML = '';
    const off = bus.on('native:app-progress', (p) => {
      if (!p || p.app !== id) return;
      status.textContent = p.text || status.textContent;
      if (typeof p.progress === 'number') bar.firstChild.style.width = clamp(p.progress, 0, 100) + '%';
    });
    try {
      await Native.call('appInstall', { app: id }, 30 * 60 * 1000);
      await Apps.refresh();
      busy = false; off();
      status.textContent = 'Chrome is installed. Opening it…'; bar.firstChild.style.width = '100%';
      S.set('appAdded', Object.assign({}, S.data.appAdded, { [id]: Date.now() }));
      Notif.push({ app: id, title: 'Google Chrome is installed', body: 'It’s your web browser. Find it on the taskbar and in Start.', silent: true });
      await Apps.launch(id, { url });
      setTimeout(() => api.close(true), 900);
    } catch (e) {
      busy = false; off();
      body.innerHTML = '';
      body.append(h('p', { class: 'in-error', html: ui('warning') + `<span>${esc(e.message)}</span>` }));
      foot.innerHTML = '';
      foot.append(button('Network settings', () => WM.open('settings', { page: 'network' })), button('Try again', install, true));
    }
  }
  ask();
}

/* Boot test (nimbus.test=chrome): install Chrome, open a page, put Nimbus windows over it. Results go to the
   system log, which os/qmp.py reads, and qmp.py drives the keyboard for the rest. */
async function testChrome() {
  const log = (text) => Native.call('log', { text: 'test chrome: ' + text }).catch(() => {});
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(250); } };
  try {
    await Apps.refresh();
    if (!NativeWin.on) throw new Error('the window manager is not running');
    if (!Apps.installed('chrome')) {
      log('installing');
      const t0 = Date.now();
      const off = bus.on('native:app-progress', (p) => { if (p && p.text && /Download|Install/.test(p.text) && p.progress != null && Math.round(p.progress) % 25 === 0) log(`progress ${Math.round(p.progress)}% ${p.text}`); });
      await Native.call('appInstall', { app: 'chrome' }, 15 * 60 * 1000);
      off();
      await Apps.refresh();
      log(`installed in ${Math.round((Date.now() - t0) / 1000)} s (${(Apps.status.chrome && Apps.status.chrome.version) || '?'})`);
    }
    const page = 'data:text/html,' + encodeURIComponent('<title>Nimbus test page</title><body style="margin:0;font:48px sans-serif;background:#1a73e8;color:#fff;display:grid;place-items:center;height:100vh">Hello from Chrome on Nimbus</body>');
    await Native.call('appLaunch', { app: 'chrome', url: page, test: true });
    const w = await until(() => WM.list().find((x) => x.native && x.appId === 'chrome'), 90000);
    if (!w) throw new Error('no Chrome window appeared');
    log(`window opened: ${w.title}`);
    const titled = await until(() => /Nimbus test page/.test(w.title), 30000);
    log(titled ? 'page loaded: ' + w.title : 'page title never arrived: ' + w.title);
    await sleep(4000);
    WM.snapTo(w, 'max');
    await sleep(2500);
    log(`maximized: ${w.state} ${w.w}x${w.h}`);
    const off = bus.on('native:wm', (ev) => { if (ev && ev.ev === 'gone' && ev.id === w.nid) { log('window closed'); off(); } });
    log('ready'); // qmp.py takes over: Start over Chrome, Settings over Chrome, Alt+Tab, typing, closing
  } catch (e) { log('failed: ' + e.message); }
}
