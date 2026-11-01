// One-pass browser check: console errors, key flows, screenshots.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const url = 'file://' + path.join(__dirname, '..', 'dist', 'test.html');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type().toUpperCase() + ' ' + m.text()); });
  const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { errors.push(`STEP ${name} FAILED: ${e.message.split('\n')[0]}`); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(url);
  await page.waitForTimeout(1200);
  await shot('01-first-run');

  await step('welcome-start', async () => { await page.click('.app-welcome .btn.primary'); });
  await step('start-menu', async () => { await page.click('#tb-start'); await shot('02-start'); });
  await step('search', async () => { await page.keyboard.type('12*(3+4)'); await shot('03-search-math'); await page.fill('#start-q', 'dark'); await page.waitForTimeout(150); await shot('03b-search-dark'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); });

  await step('open-apps', async () => {
    await ev(() => { const { WM } = window.__n; ['files', 'notes', 'calculator', 'terminal', 'paint', 'photos', 'clock', 'mines', 'taskmgr', 'settings'].forEach((a) => WM.open(a)); });
    await page.waitForTimeout(500);
    await shot('04-many-windows');
  });
  await step('terminal', async () => {
    await ev(() => { const { WM } = window.__n; const t = WM.list().find((w) => w.appId === 'terminal'); WM.focus(t); WM.snapTo(t, 'max'); });
    await page.click('.term-in');
    for (const c of ['help', 'ls', 'cd Documents', 'ls -l', 'cat "Getting started.txt"', 'echo hello there > hi.txt', 'cat hi.txt', 'calc 2^10/4', 'tree ~', 'neofetch', 'bogus']) { await page.keyboard.type(c); await page.keyboard.press('Enter'); }
    await shot('05-terminal');
  });
  await step('files', async () => {
    await ev(() => { const { WM } = window.__n; const w = WM.list().find((x) => x.appId === 'files'); WM.focus(w); WM.snapTo(w, 'left'); });
    await page.click('.app-files .fx-place:nth-child(4)');
    await page.waitForTimeout(150);
    await page.dblclick('.app-files .fx-item:first-child');
    await page.waitForTimeout(150);
    await page.click('.app-files .fx-content', { button: 'right', position: { x: 400, y: 300 } });
    await shot('06-files-context');
    await page.keyboard.press('Escape');
  });
  await step('settings-pages', async () => {
    const w = await ev(() => { const { WM } = window.__n; const s = WM.list().find((x) => x.appId === 'settings'); WM.focus(s); WM.snapTo(s, 'max'); return true; });
    for (const p of ['personalization', 'taskbar', 'accounts', 'privacy', 'accessibility', 'about', 'system', 'apps']) {
      await ev((pg) => window.__n.WM.open('settings', { page: pg }), p);
      await page.waitForTimeout(120);
      if (p === 'personalization' || p === 'privacy' || p === 'about') await shot('07-settings-' + p);
    }
  });
  await step('dark-mode', async () => {
    await ev(() => { window.__n.S.set('theme', 'dark'); window.__n.S.set('accent', '#0f9fa8'); window.__n.S.set('wallpaper', 'tide'); });
    await ev(() => window.__n.WM.open('settings', { page: 'personalization' }));
    await shot('08-dark-personalization');
  });
  await step('calc', async () => {
    await ev(() => { const { WM } = window.__n; const c = WM.list().find((x) => x.appId === 'calculator'); WM.focus(c); });
    await page.click('.app-calc [data-k="7"]'); await page.click('.app-calc [data-k="*"]'); await page.click('.app-calc [data-k="6"]'); await page.click('.app-calc [data-k="eq"]');
    const v = await page.textContent('.app-calc .calc-val');
    if (v.trim() !== '42') errors.push('CALC expected 42 got ' + v);
    await page.keyboard.type('10/4=');
    const v2 = await page.textContent('.app-calc .calc-val');
    if (v2.trim() !== '2.5') errors.push('CALC expected 2.5 got ' + v2);
  });
  await step('paint', async () => {
    await ev(() => { const { WM } = window.__n; const p = WM.list().find((x) => x.appId === 'paint'); WM.focus(p); WM.snapTo(p, 'max'); });
    await page.waitForTimeout(300);
    const box = await page.locator('.app-paint .pt-wrap').boundingBox();
    await page.mouse.move(box.x + 60, box.y + 60); await page.mouse.down();
    for (let i = 0; i < 30; i++) await page.mouse.move(box.x + 60 + i * 12, box.y + 60 + Math.sin(i / 3) * 40);
    await page.mouse.up();
    await page.click('.app-paint [data-tool="rect"]');
    await page.mouse.move(box.x + 300, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 500, box.y + 320, { steps: 5 }); await page.mouse.up();
    await page.click('.app-paint .pt-sw[data-c="#3b82f6"]');
    await page.click('.app-paint [data-tool="fill"]');
    await page.mouse.click(box.x + 400, box.y + 260);
    await shot('09-paint');
  });
  await step('mines', async () => {
    await ev(() => { const { WM } = window.__n; const m = WM.list().find((x) => x.appId === 'mines'); WM.focus(m); });
    await page.click('.app-mines .mc[data-i="40"]');
    await page.waitForTimeout(100);
  });
  await step('taskview', async () => {
    await ev(() => window.__n.WM.taskView(true));
    await page.waitForTimeout(450);
    await shot('10-taskview');
    await page.keyboard.press('Escape');
  });
  await step('snap-fly', async () => {
    await ev(() => { const { WM } = window.__n; const c = WM.list().find((x) => x.appId === 'clock'); WM.focus(c); WM.snapTo(c, 'restore'); });
    const b = page.locator('.win[data-app="clock"] .wc.max');
    await b.hover(); await page.waitForTimeout(700);
    await shot('11-snap-layouts');
    await page.mouse.move(5, 5);
  });
  await step('drag-snap', async () => {
    const tb = await page.locator('.win[data-app="clock"] .win-titlebar').boundingBox();
    await page.mouse.move(tb.x + 100, tb.y + 20); await page.mouse.down();
    await page.mouse.move(tb.x + 300, tb.y + 60, { steps: 4 }); await page.mouse.move(2, 400, { steps: 8 });
    await page.waitForTimeout(250);
    await shot('12-snap-preview');
    await page.mouse.up();
  });
  await step('qs-nc', async () => {
    await page.click('#tb-tray'); await page.waitForTimeout(250); await shot('13-quick-settings');
    await page.click('#tb-clock'); await page.waitForTimeout(250); await shot('14-notifications');
    await page.keyboard.press('Escape');
  });
  await step('focus', async () => { await ev(() => window.__n.Clock.startFocus(25)); await page.waitForTimeout(400); });
  await step('light-and-taskbar-top', async () => {
    await ev(() => { const { S } = window.__n; S.set('theme', 'light'); S.set('tbPos', 'top'); S.set('tbAlign', 'left'); S.set('wallpaper', 'dunes'); });
    await ev(() => window.__n.WM.showDesktop());
    await page.waitForTimeout(400);
    await shot('15-top-taskbar-desktop');
    await ev(() => { const { S } = window.__n; S.set('tbPos', 'bottom'); S.set('tbAlign', 'center'); S.set('wallpaper', 'ridgeline'); });
  });
  await step('desktop-menu', async () => {
    await page.click('#desktop', { button: 'right', position: { x: 700, y: 400 } });
    await page.hover('.menu .mi:has-text("New")'); await page.waitForTimeout(300);
    await shot('16-desktop-menu');
    await page.keyboard.press('Escape');
  });
  await step('notes-save', async () => {
    await ev(() => window.__n.WM.open('notes'));
    await page.waitForTimeout(200);
    await page.keyboard.type('Shopping list\n- apples\n- bread');
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(250);
    await shot('17-save-dialog');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const saved = await ev(() => Object.values(window.__n.FS.nodes).some((n) => n.name === 'Shopping list.txt'));
    if (!saved) errors.push('NOTES save did not create Shopping list.txt');
  });
  await step('lock', async () => {
    await ev(() => window.__n.Power.lock());
    await page.waitForTimeout(400);
    await shot('18-lock');
    await page.mouse.click(700, 400);
    await page.waitForTimeout(700);
  });
  await step('persist', async () => {
    await page.waitForTimeout(600);
    const has = await ev(() => { try { return !!localStorage.getItem('nimbus-os:v1'); } catch { return 'blocked'; } });
    errors.push('INFO localStorage saved: ' + has);
  });
  await step('mobile', async () => {
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 800 });
    m.on('pageerror', (e) => errors.push('MOBILE PAGEERROR ' + e.message));
    await m.goto(url); await m.waitForTimeout(1000);
    await m.screenshot({ path: path.join(OUT, '19-mobile.png') });
    await m.close();
  });
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
