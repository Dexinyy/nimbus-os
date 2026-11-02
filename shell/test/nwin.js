// Checks how the desktop works with nimbus-wm, against a stand-in for the window manager:
// program windows on the taskbar, what the page asks to draw above them, keyboard hand-offs,
// keys passed on from programs, minimizing and closing, and the Chrome installer.
//   python3 shell/build.py && node shell/test/nwin.js
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.resolve(__dirname, '../dist/test.html'); // web build with the test hook (python3 shell/build.py)

const bridge = (installed) => `
window.__calls = [];
window.webkit = { messageHandlers: { nimbus: { postMessage(json) {
  const m = JSON.parse(json); window.__calls.push(m);
  const answers = {
    info: { version: '0.1', base: 'Ubuntu 24.04.3 LTS', kernel: '7.0.0-42-generic', cpu: 'Test CPU', cores: 4, memory: 8 * 1024 ** 3,
      disk: { total: 64 * 1024 ** 3, free: 40 * 1024 ** 3 }, gpus: [], device: 'Test PC', hostname: 'nimbus', uptime: 42,
      live: true, persistent: false, timezone: 'UTC', battery: null, software: true, wm: true },
    appStatus: { chrome: { installed: ${installed}, version: ${installed ? "'142.0.7444.59'" : 'null'}, icon: null } },
    appInstall: { installed: true }, appLaunch: true, wmReady: true, wm: true, log: true, timezones: ['UTC'], battery: null,
  };
  if (m.method === 'appInstall') {
    let p = 0;
    const tick = setInterval(() => { p += 25; window.__nimbusNative.event('app-progress', { app: 'chrome', progress: p, text: 'Downloading Google Chrome' });
      if (p >= 100) { clearInterval(tick); window.__installed = true; window.__nimbusNative.resolve(m.id, { installed: true }); } }, 60);
    return;
  }
  if (m.method === 'appStatus' && window.__installed) { setTimeout(() => window.__nimbusNative.resolve(m.id, { chrome: { installed: true, version: '142.0', icon: null } }), 10); return; }
  setTimeout(() => window.__nimbusNative.resolve(m.id, answers[m.method]), 10);
} } } };`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const check = (ok, what) => { if (!ok) errors.push(what); };
  const open = async (installed) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('ERROR ' + m.text()); });
    await page.addInitScript(bridge(installed));
    await page.goto(url);
    await page.waitForTimeout(2600);
    await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'welcome'); if (w) __n.WM.close(w, true); });
    await page.waitForTimeout(300);
    return page;
  };
  const wmCalls = (page) => page.evaluate(() => window.__calls.filter((c) => c.method === 'wm').map((c) => c.args));
  const lastOf = async (page, cmd) => (await wmCalls(page)).filter((c) => c.cmd === cmd).pop();
  const event = (page, ev) => page.evaluate((e) => window.__nimbusNative.event('wm', e), ev);
  const chrome = { ev: 'new', id: 7, app: 'google-chrome', title: 'New Tab - Google Chrome', x: 120, y: 60, w: 900, h: 600, state: 'normal', parent: 0, min: 0, pid: 4242 };

  const page = await open(true);
  try {
    check(await page.evaluate(() => document.documentElement.classList.contains('wm')), 'the page does not know it runs under the window manager');
    check((await wmCalls(page)).some((c) => c.cmd === 'area'), 'no work area sent');
    check(await page.evaluate(() => window.__calls.some((c) => c.method === 'wmReady')), 'wmReady not called');
    check(await page.$('#tb-apps [data-app="chrome"]'), 'Chrome is not pinned to the taskbar');

    // A Chrome window appears
    await event(page, chrome);
    await page.waitForTimeout(400);
    check(await page.$('#tb-apps [data-app="chrome"].running.focused'), 'Chrome window is not running and focused on the taskbar');
    let lay = await lastOf(page, 'layout');
    check(lay && lay.stack.length === 1 && lay.stack[0][0] === 7 && lay.stack[0][1].length === 0, 'layout for one program window: ' + JSON.stringify(lay));
    const tb = await page.$eval('#taskbar', (el) => { const r = el.getBoundingClientRect(); return [Math.floor(r.left), Math.floor(r.top)]; });
    check(lay && lay.top.some((r) => r[0] === tb[0] && r[1] === tb[1]), 'the taskbar is not above programs: ' + JSON.stringify(lay && lay.top));
    await page.screenshot({ path: path.join(OUT, 'w1-chrome.png') });

    // Settings opens above it: the page takes the keyboard and asks for Settings to be drawn over Chrome
    await page.evaluate(() => __n.WM.open('settings'));
    await page.waitForTimeout(500);
    const focus0 = await lastOf(page, 'focus');
    check(focus0 && focus0.id === 0, 'opening Settings did not take the keyboard: ' + JSON.stringify(focus0));
    lay = await lastOf(page, 'layout');
    const st = await page.$eval('.win[data-app="settings"]', (el) => { const r = el.getBoundingClientRect(); return [Math.floor(r.left), Math.floor(r.top), Math.round(r.width)]; });
    check(lay && lay.stack[0][1].some((r) => r[0] === st[0] && r[1] === st[1] && Math.abs(r[2] - st[2]) <= 1 && r[4] > 0), 'Settings is not above Chrome: ' + JSON.stringify(lay));

    // Clicking Chrome (the window manager reports it): Chrome is on top again
    await event(page, { ev: 'focus', id: 7 });
    await page.waitForTimeout(400);
    check(await page.evaluate(() => __n.WM.activeId() === 'n7'), 'Chrome is not the active window after a click');
    lay = await lastOf(page, 'layout');
    check(lay && lay.stack[0][1].length === 0, 'Settings still drawn over Chrome after clicking Chrome: ' + JSON.stringify(lay));

    // The Windows key, pressed in Chrome: Start opens over it, with the keyboard; Escape gives it back
    const before = (await wmCalls(page)).length;
    await event(page, { ev: 'key', key: 'super', id: 7 });
    await page.waitForTimeout(500);
    check(await page.evaluate(() => __n.Flyouts.cur === 'start'), 'Windows key from Chrome did not open Start');
    lay = await lastOf(page, 'layout');
    const sr = await page.$eval('#start', (el) => Math.floor(el.getBoundingClientRect().left));
    check(lay && lay.top.some((r) => r[0] === sr), 'Start is not drawn above Chrome');
    await page.screenshot({ path: path.join(OUT, 'w2-start-over-chrome.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const after = (await wmCalls(page)).slice(before);
    check(after.some((c) => c.cmd === 'focus' && c.id === 7), 'closing Start did not give Chrome the keyboard back: ' + JSON.stringify(after.filter((c) => c.cmd === 'focus')));

    // Alt+Tab from Chrome: the switcher shows, Alt's release (in the page) switches to Settings
    await event(page, { ev: 'key', key: 'alt+tab', id: 7 });
    await page.waitForTimeout(250);
    check(await page.$('.switcher'), 'Alt+Tab from Chrome did not show the switcher');
    await page.screenshot({ path: path.join(OUT, 'w3-alt-tab.png') });
    await page.keyboard.down('Alt'); await page.keyboard.up('Alt');
    await page.waitForTimeout(300);
    check(await page.evaluate(() => __n.WM.active() && __n.WM.active().appId === 'settings'), 'Alt+Tab did not switch to Settings');

    // Windows key + Up maximizes Chrome through the window manager
    await page.evaluate(() => __n.WM.focus(__n.WM.byNid(7)));
    await event(page, { ev: 'key', key: 'super+up', id: 7 });
    await page.waitForTimeout(200);
    const geom = await lastOf(page, 'geom');
    check(geom && geom.id === 7 && geom.state === 1 && geom.h > 600, 'Windows+Up did not maximize Chrome: ' + JSON.stringify(geom));
    await event(page, { ev: 'geom', id: 7, x: 0, y: 0, w: 1280, h: 736, state: 'max' });

    // Dragging Chrome to the left edge snaps it
    await event(page, { ev: 'moving', id: 7, x: 0, y: 100, px: 2, py: 300 });
    await page.waitForTimeout(150);
    check(await page.$('#snap-preview.show'), 'no snap preview while dragging Chrome to the edge');
    await event(page, { ev: 'moved', id: 7, x: 0, y: 100, px: 2, py: 300 });
    await page.waitForTimeout(200);
    const snap = await lastOf(page, 'geom');
    check(snap && snap.state === 2 && snap.x === 0 && snap.w === 640, 'dropping Chrome on the left edge did not snap it: ' + JSON.stringify(snap));

    // Clicking its taskbar button while it is active minimizes it; the window manager hides it
    await page.evaluate(() => __n.WM.focus(__n.WM.byNid(7)));
    await page.waitForTimeout(100);
    await page.click('#tb-apps [data-app="chrome"]');
    await page.waitForTimeout(500);
    const show = await lastOf(page, 'show');
    check(show && show.id === 7 && show.on === 0, 'minimizing did not hide Chrome: ' + JSON.stringify(show));
    await page.click('#tb-apps [data-app="chrome"]');
    await page.waitForTimeout(600);
    const shown = await lastOf(page, 'show');
    check(shown && shown.on === 1, 'restoring did not show Chrome: ' + JSON.stringify(shown));

    // A program started from Terminal gets its own taskbar button
    await event(page, { ev: 'new', id: 8, app: 'org.gnome.Calculator', title: 'Calculator', x: 300, y: 200, w: 360, h: 500, state: 'normal', parent: 0, min: 0, pid: 99 });
    await page.waitForTimeout(300);
    check(await page.$('#tb-apps [data-app="x:org.gnome.Calculator"]'), 'a program from Terminal has no taskbar button');
    check(!(await page.evaluate(() => [...document.querySelectorAll('#start .apps-all [data-app], #start [data-app]')].some((b) => b.dataset.app.startsWith('x:')))), 'programs from Terminal appear in Start');

    // An X11 program that leaves its title bar to the window manager: Nimbus draws one right above its window
    await event(page, { ev: 'new', id: 9, app: 'XTerm', title: 'xterm', x: 400, y: 300, w: 480, h: 300, state: 'normal', parent: 0, min: 0, pid: 77, x11: 1, deco: 32 });
    await page.waitForTimeout(400);
    const bar = () => page.$eval('#windows > .win.native.deco > .win-titlebar', (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
    const frame = await bar();
    check(frame[0] === 400 && frame[1] === 268 && frame[2] === 480 && frame[3] === 32, 'title bar for an X11 window: ' + JSON.stringify(frame));
    await page.screenshot({ path: path.join(OUT, 'w5-x11-frame.png') });
    lay = await lastOf(page, 'layout');
    const under = lay && lay.stack.find((x) => x[0] === 7);
    check(under && under[1].some((r) => r[0] === 400 && r[1] === 268 && r[2] === 480 && r[3] === 32), 'the X11 title bar is not drawn above Chrome below it: ' + JSON.stringify(lay));
    const own = lay && lay.stack.find((x) => x[0] === 9);
    check(own && own[1].length === 0, 'the X11 window has things drawn over it: ' + JSON.stringify(own));
    // dragging the title bar lets the window manager move the window
    await page.mouse.move(560, 284); await page.mouse.down();
    await page.waitForTimeout(150);
    const grab = await lastOf(page, 'grab');
    check(grab && grab.id === 9 && grab.edges === 0, 'dragging the X11 title bar did not start a move: ' + JSON.stringify(grab));
    await page.mouse.up();
    // its bottom right corner resizes it
    await page.mouse.move(400 + 480 + 4, 300 + 300 + 4); await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
    const rgrab = await lastOf(page, 'grab');
    check(rgrab && rgrab.id === 9 && rgrab.edges === 10, 'the X11 window\'s corner did not start a resize: ' + JSON.stringify(rgrab));
    // maximizing puts the window below the title bar
    await page.click('#windows > .win.native.deco .wc.max');
    await page.waitForTimeout(200);
    const mg = await lastOf(page, 'geom');
    check(mg && mg.id === 9 && mg.state === 1 && mg.y === 32 && mg.x === 0 && mg.w === 1280, 'maximizing the X11 window: ' + JSON.stringify(mg));
    await event(page, { ev: 'geom', id: 9, x: 0, y: 32, w: 1280, h: mg.h, state: 'max' });
    await page.waitForTimeout(200);
    const mframe = await bar();
    check(mframe[0] === 0 && mframe[1] === 0 && mframe[2] === 1280, 'title bar of the maximized X11 window: ' + JSON.stringify(mframe));
    // full screen hides it; a program that starts drawing its own title bar loses ours
    await event(page, { ev: 'geom', id: 9, x: 0, y: 0, w: 1280, h: 800, state: 'full' });
    await page.waitForTimeout(150);
    check(await page.$eval('#windows > .win.native.deco > .win-titlebar', (el) => getComputedStyle(el).display === 'none'), 'the title bar shows on a full-screen X11 window');
    await event(page, { ev: 'deco', id: 9, deco: 0 });
    await page.waitForTimeout(150);
    check(!(await page.$('#windows > .win.native.deco')), 'the title bar stayed after the program stopped wanting it');
    await event(page, { ev: 'gone', id: 9 });

    // Alt+F4 from Chrome asks it to close; it goes when the window manager says so
    await page.evaluate(() => __n.WM.focus(__n.WM.byNid(7)));
    await event(page, { ev: 'key', key: 'alt+f4', id: 7 });
    await page.waitForTimeout(200);
    const close = await lastOf(page, 'close');
    check(close && close.id === 7, 'Alt+F4 did not ask Chrome to close: ' + JSON.stringify(close));
    await event(page, { ev: 'gone', id: 7 });
    await event(page, { ev: 'gone', id: 8 });
    await page.waitForTimeout(400);
    check(!(await page.$('#tb-apps [data-app="chrome"].running')), 'Chrome still shows as running after it closed');
    lay = await lastOf(page, 'layout');
    check(lay && lay.stack.length === 0, 'layout still lists closed windows: ' + JSON.stringify(lay));

    // Brightness reaches the window manager
    await page.evaluate(() => __n.S.set('brightness', 50));
    await page.waitForTimeout(100);
    const ov = await lastOf(page, 'overlay');
    check(ov && ov.dim === 400, 'brightness not sent to the window manager: ' + JSON.stringify(ov));
  } catch (e) { errors.push('FAILED: ' + e.message); }
  await page.close();

  // Chrome not installed yet: opening it offers to install it, then opens it
  const p2 = await open(false);
  try {
    await p2.evaluate(() => __n.WM.open('chrome'));
    await p2.waitForTimeout(500);
    check(await p2.$('.app-installer'), 'opening Chrome before it is installed did not offer to install it');
    const text = await p2.textContent('.app-installer');
    check(/Terms of Service/.test(text) && /Saving isn’t on/.test(text), 'installer text: ' + text.slice(0, 200));
    await p2.screenshot({ path: path.join(OUT, 'w4-installer.png') });
    await p2.click('.app-installer .btn.primary');
    await p2.waitForTimeout(1500);
    const launched = await p2.evaluate(() => window.__calls.find((c) => c.method === 'appLaunch'));
    check(launched && launched.args.app === 'chrome', 'Chrome was not opened after installing');
    check(await p2.evaluate(() => __n.Apps.installed('chrome')), 'the desktop does not know Chrome is installed');
  } catch (e) { errors.push('FAILED: ' + e.message); }
  await browser.close();
  console.log(errors.length ? errors.join('\n') : 'All window manager tests passed');
  process.exit(errors.length ? 1 : 0);
})();
