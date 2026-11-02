// Checks the Store against a stand-in for the machine side (nimbus_store.py): Home, search, an app's page,
// installing with progress, the app joining Start and the taskbar (its window mapped by its sandbox), the
// Library with an update, uninstalling, and Battle.net through Lutris.
//   python3 shell/build.py && node shell/test/store.js [--shots]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.argv.includes('--shots');
const url = 'file://' + path.resolve(__dirname, '../dist/test.html');

const ICON = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#1b2838"/><circle cx="24" cy="24" r="12" fill="#66c0f4"/></svg>').toString('base64');
const DISCORD = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#5865f2"/><circle cx="18" cy="26" r="4" fill="#fff"/><circle cx="30" cy="26" r="4" fill="#fff"/></svg>').toString('base64');

const bridge = `
window.__calls = [];
window.__programs = [];
const apps = {
  'com.valvesoftware.Steam': { id: 'com.valvesoftware.Steam', name: 'Steam', summary: 'Launcher for the Steam software distribution service', dev: 'Valve', cats: ['Game'], icon: '${ICON}', verified: true },
  'com.discordapp.Discord': { id: 'com.discordapp.Discord', name: 'Discord', summary: 'Messaging, voice and video client', dev: 'Discord Inc.', cats: ['Network'], icon: '${DISCORD}', verified: true },
  'lutris:battlenet': { id: 'lutris:battlenet', name: 'Battle.net', summary: 'Play Blizzard games', dev: 'Blizzard Entertainment', cats: ['Game'], icon: null, via: 'Lutris' },
  'com.spotify.Client': { id: 'com.spotify.Client', name: 'Spotify', summary: 'Online music streaming service', dev: 'Spotify', cats: ['AudioVideo'], icon: null, verified: true },
  'org.videolan.VLC': { id: 'org.videolan.VLC', name: 'VLC', summary: 'VLC media player', dev: 'VideoLAN', cats: ['AudioVideo'], icon: null },
};
const answers = {
  info: { version: '0.1', base: 'Ubuntu 24.04.3 LTS', kernel: '7.0.0-42-generic', cpu: 'Test CPU', cores: 4, memory: 8 * 1024 ** 3,
    disk: { total: 64 * 1024 ** 3, free: 40 * 1024 ** 3 }, gpus: [], device: 'Test PC', hostname: 'nimbus', uptime: 42,
    live: true, persistent: false, timezone: 'UTC', battery: null, software: true, wm: true },
  appStatus: { chrome: { installed: true, version: '142.0', icon: null } }, wmReady: true, wm: true, log: true, timezones: ['UTC'], battery: null,
  storeStatus: { flatpak: true, remote: true, catalogAge: null, jobs: [] },
  storeCatalog: { count: 2400, updated: 1 },
  storeHome: { gaming: [apps['com.valvesoftware.Steam'], apps['lutris:battlenet'], apps['com.discordapp.Discord']], essentials: [apps['com.discordapp.Discord'], apps['com.spotify.Client'], apps['org.videolan.VLC']] },
  storeUpdates: [], programLaunch: 4242, storeCancel: true,
};
const reply = (m, v, delay) => setTimeout(() => window.__nimbusNative.resolve(m.id, v), delay || 10);
window.webkit = { messageHandlers: { nimbus: { postMessage(json) {
  const m = JSON.parse(json); window.__calls.push(m);
  const a = m.args || {};
  if (m.method === 'storeCatalog') { window.__nimbusNative.event('store-progress', { id: '', state: 'catalog', text: 'Getting the list of apps from Flathub' }); answers.storeStatus.catalogAge = 5; return reply(m, answers.storeCatalog, 400); }
  if (m.method === 'storeSearch') { const q = (a.q || '').toLowerCase(); return reply(m, Object.values(apps).filter((x) => (!q || x.name.toLowerCase().includes(q)) && (!a.category || x.cats.includes(a.category)))); }
  if (m.method === 'storeApp') { const x = apps[a.id]; return reply(m, Object.assign({}, x, { desc: '<p>' + x.summary + '. <em>Really</em> good.</p><ul><li>One</li><li>Two</li></ul>',
    shots: [{ thumb: '${ICON}', full: '${ICON}', caption: 'The library' }], license: 'LicenseRef-proprietary', homepage: 'https://example.com/', version: '1.0.0', date: 1720000000,
    installed: window.__programs.some((p) => p.app === a.id || p.id === a.id), download: 12 * 1024 ** 2, size: 48 * 1024 ** 2,
    permissions: ['Your internet connection', 'Devices like game controllers, cameras and USB devices'], update: !!window.__update, mature: 1 })); }
  if (m.method === 'storeInstall') {
    let p = 0;
    const t = setInterval(() => {
      p += 20; window.__nimbusNative.event('store-progress', { id: a.id, progress: p, text: 'Installing ' + a.id, state: 'working' });
      if (p >= 100) {
        clearInterval(t);
        if (a.id.startsWith('lutris:')) { window.__nimbusNative.resolve(m.id, { installed: false, lutris: true }); return; }
        const x = apps[a.id];
        window.__programs.push({ id: 'fp:' + a.id, app: a.id, name: x.name, desc: x.summary, icon: x.icon, wmclass: a.id === 'com.discordapp.Discord' ? 'discord' : 'Steam', cats: x.cats, keywords: '', version: '1.0', size: 50e6, user: true, kind: 'flatpak' });
        window.__nimbusNative.resolve(m.id, { installed: true });
      }
    }, 120);
    return;
  }
  if (m.method === 'storeRemove') { window.__programs = window.__programs.filter((p) => p.app !== a.id); return reply(m, true, 200); }
  if (m.method === 'storeUpdates') return reply(m, window.__update ? [{ app: 'com.discordapp.Discord', ref: 'app/com.discordapp.Discord/x86_64/stable', kind: 'app', name: 'Discord' }] : []);
  if (m.method === 'storeUpdate') { window.__update = false; return reply(m, { updated: 1 }, 300); }
  if (m.method === 'programs') return reply(m, window.__programs);
  reply(m, answers[m.method]);
} } } };`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (ok, what) => { if (!ok) errors.push(what); };
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('ERROR ' + m.text()); });
  await page.addInitScript(bridge);
  await page.goto(url);
  await page.waitForTimeout(2600);
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'welcome'); if (w) __n.WM.close(w, true); });
  const shot = (n) => SHOTS ? page.screenshot({ path: path.join(OUT, n + '.png') }) : null;
  const calls = (m) => page.evaluate((mm) => window.__calls.filter((c) => c.method === mm).map((c) => c.args), m);
  try {
    check(await page.$('#tb-apps [data-app="store"]'), 'the Store is not pinned to the taskbar');
    await page.evaluate(() => __n.WM.open('store'));
    await page.waitForTimeout(250);
    check(await page.$('.app-store .ms-spin'), 'no "getting ready" while the catalog downloads');
    await page.waitForTimeout(1200);
    check((await calls('storeCatalog')).length === 1, 'the catalog was not downloaded on first open');
    check(await page.$('.app-store .ms-hero .ms-slide.on'), 'no hero banner on Home');
    const cards = await page.$$eval('.app-store .ms-card .ms-card-n', (els) => els.map((e) => e.textContent));
    check(cards.includes('Steam') && cards.includes('Battle.net') && cards.includes('Spotify'), 'Home cards: ' + cards.join(', '));
    check(await page.$('.app-store .ms-note'), 'no note about saving on a live system');
    await shot('s1-store-home');

    // Search from the title bar
    await page.fill('.ms-search', 'disc');
    await page.press('.ms-search', 'Enter');
    await page.waitForTimeout(300);
    const res = await page.$$eval('.app-store .ms-card .ms-card-n', (els) => els.map((e) => e.textContent));
    check(res.length === 1 && res[0] === 'Discord', 'search results: ' + res.join(', '));

    // Discord's page, then install it
    await page.click('.app-store .ms-card');
    await page.waitForTimeout(400);
    check(/Discord/.test(await page.textContent('.app-store .ms-side h1')), 'app page title');
    check(await page.$('.app-store .ms-desc ul li'), 'description markup missing');
    check((await page.textContent('.app-store .ms-perms')).includes('internet'), 'permissions not listed');
    await shot('s2-app-page');
    await page.click('.app-store .ms-get');
    await page.waitForTimeout(380);
    check(await page.$('.app-store .ms-prog .ms-bar i'), 'no progress bar while installing');
    const pct = await page.textContent('.app-store .ms-prog-t');
    check(/\d+%/.test(pct), 'no percentage while installing: ' + pct);
    check(await page.$('.ms-nav-i[data-page="library"] .ms-badge:not([hidden])'), 'the Library shows no download going on');
    await shot('s3-installing');
    await page.waitForTimeout(1200);
    check(/Open/.test(await page.textContent('.app-store .ms-get')), 'Install did not turn into Open');
    check(await page.evaluate(() => !!__n.APPS['fp:com.discordapp.Discord'] && __n.APPS['fp:com.discordapp.Discord'].program), 'Discord is not in the app list after installing');
    check(await page.evaluate(() => !!__n.S.data.appAdded['fp:com.discordapp.Discord']), 'Discord is not "recently added"');

    // Opening it: a window arrives from its sandbox and gets Discord's taskbar button
    await page.click('.app-store .ms-get');
    await page.waitForTimeout(100);
    check((await calls('programLaunch')).some((a) => a.id === 'fp:com.discordapp.Discord'), 'Open did not start Discord');
    await page.evaluate(() => window.__nimbusNative.event('wm', { ev: 'new', id: 21, app: 'discord', title: 'Discord', x: 200, y: 120, w: 900, h: 600, state: 'normal', parent: 0, min: 0, pid: 999, x11: 1, deco: 0, flatpak: 'com.discordapp.Discord' }));
    await page.waitForTimeout(300);
    check(await page.$('#tb-apps [data-app="fp:com.discordapp.Discord"].running'), 'Discord\'s window has no taskbar button of its own');
    // a game Steam starts gets a button of its own, named by its window
    await page.evaluate(() => window.__nimbusNative.event('wm', { ev: 'new', id: 22, app: 'steam_app_570', title: 'Dota 2', x: 0, y: 0, w: 1366, h: 860, state: 'full', parent: 0, min: 0, pid: 1000, x11: 1, deco: 0, flatpak: 'com.valvesoftware.Steam' }));
    await page.waitForTimeout(200);
    check(await page.evaluate(() => __n.WM.byNid(22).app.name === 'Dota 2'), 'a Steam game window is not named by its title');
    await page.evaluate(() => { window.__nimbusNative.event('wm', { ev: 'gone', id: 21 }); window.__nimbusNative.event('wm', { ev: 'gone', id: 22 }); });

    // Start lists it, and can uninstall it
    await page.evaluate(() => __n.Flyouts.toggle('start'));
    await page.waitForTimeout(300);
    await page.evaluate(() => __n.Flyouts.close());

    // Library: an update waits; updating it
    await page.evaluate(() => { window.__update = true; });
    await page.click('.ms-nav-i[data-page="library"]');
    await page.waitForTimeout(500);
    const lib = await page.textContent('.app-store .ms-libhead');
    check(/1 update is available/.test(lib), 'the Library does not show the update: ' + lib);
    await shot('s4-library');
    await page.click('.app-store .ms-libhead .btn.primary');
    await page.waitForTimeout(700);
    check((await calls('storeUpdate')).length === 1, 'Update all did not update');

    // Battle.net: through Lutris, after saying what will happen
    await page.click('.ms-nav-i[data-page="gaming"]');
    await page.waitForTimeout(400);
    const gameCards = await page.$$('.app-store .ms-card');
    for (const c of gameCards) if ((await c.textContent()).includes('Battle.net')) { await c.click(); break; }
    await page.waitForTimeout(400);
    check((await page.textContent('.app-store .ms-meta')).includes('Lutris'), 'Battle.net does not say it runs with Lutris');
    await page.click('.app-store .ms-get');
    await page.waitForTimeout(300);
    check(await page.$('.modal'), 'no explanation before setting up Battle.net');
    await shot('s5-battlenet');
    await page.click('.modal .btn.primary');
    await page.waitForTimeout(900);
    check((await calls('storeInstall')).some((a) => a.id === 'lutris:battlenet'), 'Battle.net was not set up');

    // Uninstalling Discord from Settings > Apps > Installed apps
    await page.evaluate(() => __n.WM.open('settings', { page: 'installedapps' }));
    await page.waitForTimeout(600);
    const rows = await page.$$eval('.ws-card .ws-t', (els) => els.map((e) => e.textContent));
    check(rows.some((t) => t.includes('Discord')), 'Discord is not in Installed apps: ' + rows.join(', '));
    await page.evaluate(() => { __n.Programs.uninstall('fp:com.discordapp.Discord'); });
    await page.waitForTimeout(200);
    await page.click('.modal .btn.primary');
    await page.waitForTimeout(600);
    check((await calls('storeRemove')).some((a) => a.id === 'com.discordapp.Discord'), 'uninstalling did not remove Discord');
    check(await page.evaluate(() => !__n.APPS['fp:com.discordapp.Discord']), 'Discord stayed in the app list after uninstalling');
  } catch (e) { errors.push('FAILED: ' + e.message); }
  await browser.close();
  console.log(errors.length ? errors.join('\n') : 'All Store tests passed');
  process.exit(errors.length ? 1 : 0);
})();
