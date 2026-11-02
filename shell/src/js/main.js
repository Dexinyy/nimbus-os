/* ========== First-run files ========== */
function seedFS() {
  FS.init({}, {});
  const txt = (parent, name, body) => FS.create(parent, name, 'file', body, 'text');
  txt('desktop', 'Read me.txt', `Welcome to your new desktop

Everything here works. A few things to try:

- Drag a window by its title bar. Drop it on a screen edge to snap it.
- Hover a window's maximize button for more layouts.
- Right-click anything for the full menu.
- Press Ctrl+K to search apps, files and settings, or to do quick math.
${IS_NATIVE ? '- Press the Windows key to open Start, and Alt+Tab to switch windows.' : '- Drag files from your computer onto the desktop to import them.'}

Your files and settings save automatically.
Make it yours in Settings > Personalization.
`);
  txt('documents', 'Getting started.txt', `Getting started

Keyboard shortcuts
  Ctrl+K              Search
  Ctrl+Alt+T          Terminal
  Ctrl+Alt+D          Show the desktop
  Ctrl+Alt+L          Lock
  Alt+Shift+Arrows    Snap the active window
  Ctrl+S              Save in Notes and Paint
  F2                  Rename the selected file
  Delete              Move to the Recycle Bin

Ideas
  - Open Terminal and type "neofetch".
  - Draw something in Paint, then choose File > Set as wallpaper.
  - Start a focus session from the clock in the taskbar.
  - Play a round of Mines.
`);
  const proj = FS.create('documents', 'Projects', 'folder');
  txt(proj.id, 'Weekend plan.txt', `Example: a weekend plan

Saturday
  - Farmers market at 9
  - Fix the bike tire
  - Movie night

Sunday
  - Call Grandma
  - Meal prep for the week
`);
  try {
    for (const id of ['ridgeline', 'nebula']) {
      const w = WALLS.find((x) => x.id === id);
      FS.create('pictures', w.name + '.jpg', 'file', renderWall(id, 1280, 720, 0.82), 'image');
    }
  } catch (e) { console.warn('Could not create sample pictures', e); }
  S.data.recent = [];
}

/* ========== Start up ========== */
function boot() {
  document.body.insertAdjacentHTML('afterbegin', SVG_DEFS);
  const local = Store.readLocal();
  if (local && local.nodes && local.settings) {
    Store.quietly(() => { S.load(local.settings); FS.init(local.nodes, local.contents || {}); FS.updatedAt = local.fsUpdatedAt || 0; });
    Store.setHadLocal(true);
  } else {
    Store.quietly(() => { S.load({}); seedFS(); });
    Store.setHadLocal(false);
  }
  if (IS_NATIVE) document.documentElement.classList.add('native');
  Start.build(); Taskbar.init(); Desktop.init(); TbHide.init();
  applyAll();
  Sys.init(); extrasInit();
  Desktop.render(); Taskbar.render(); Taskbar.focusChip();
  if (IS_NATIVE) {
    // This page is the desktop of a real computer: show the startup screen and read the hardware.
    Power.boot();
    bus.on('native-info', applyEffects);
    Native.refresh().then((info) => {
      bus.emit('store');
      if (!info) return;
      // "nimbus.open=app[:page]" on the kernel command line opens an app at startup
      if (info.open) { const [app, pg] = info.open.split(':'); if (APPS[app]) WM.open(app, pg ? { page: pg } : {}); }
      // Boot tests: "nimbus.test=wifi" joins the simulated access point the way the Wi-Fi menu does
      if (info.test === 'wifi') testWifi();
      if (info.test === 'storage') testStorage();
      // Under the window manager real programs open as windows on this desktop (nwin.js)
      NativeWin.init();
      Sys.wmReady();
      if (NativeWin.on) {
        // the Store's apps first, so windows that are already open (after the desktop restarts) get their buttons
        Programs.refresh().finally(() => Native.call('wmReady').catch(() => {}));
        Apps.refresh();
        // Chrome is the default browser: pin it for anyone whose taskbar was set up before it was there
        if (!S.data.chromePinned) {
          if (!S.data.pinned.includes('chrome')) S.set('pinned', ['chrome', ...S.data.pinned]);
          if (!S.data.startPins.includes('chrome')) { S.set('startPins', ['chrome', ...S.data.startPins]); Start.render(); }
          S.set('chromePinned', true);
        }
        // the Store too, for taskbars set up before it was there
        if (!S.data.storePinned) {
          if (!S.data.pinned.includes('store')) { const p = [...S.data.pinned]; p.splice(Math.max(0, p.indexOf('files') + 1), 0, 'store'); S.set('pinned', p); }
          if (!S.data.startPins.includes('store')) { const p = [...S.data.startPins]; p.splice(Math.max(0, p.indexOf('chrome') + 1), 0, 'store'); S.set('startPins', p); }
          S.set('storePinned', true);
        }
        Taskbar.render(); Start.render();
      }
      if (info.test === 'chrome') testChrome();
      if (info.test === 'settings') testSettings();
    });
    Net.refresh();
  } else if (S.data.lockOnStart) Power.lock();
  if (!S.data.setupDone) WM.open('welcome');
  else startupApps();
  Store.ready();

  bus.on('store-adopted', () => {
    Shell.reloadAll();
    const welcome = WM.list().find((w) => w.appId === 'welcome');
    if (welcome && S.data.setupDone && welcome.untouched?.()) WM.close(welcome, true);
  });

  // Capabilities from the Claude viewer arrive later, or never (then each resolves null).
  const C = window.claude;
  if (!C || typeof C.use !== 'function') { Store.noCloud(); return; }
  const use = (n) => Promise.resolve().then(() => C.use(n)).catch(() => null);
  use('downloads').then((d) => { caps.downloads = d || null; document.documentElement.classList.toggle('has-downloads', !!d); bus.emit('caps'); });
  use('sample').then(async (s) => {
    if (!s) return;
    caps.sample = s;
    try { const lim = await s.limits(); caps.tools = !!lim?.tools; caps.maxTools = lim?.tools?.maxCount || 0; } catch { caps.tools = false; }
    document.documentElement.classList.add('has-assistant');
    bus.emit('caps');
  });
  Promise.all([use('db'), use('user')]).then(([db, user]) => {
    caps.db = db || null; caps.user = user || null;
    if (db && user) Store.connect(db, user); else Store.noCloud();
  });
}
boot();
