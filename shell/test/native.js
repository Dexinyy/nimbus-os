// Checks the desktop in "native" mode against a stand-in for the nimbus-shell bridge.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const dir = process.argv[2] || '/tmp/native-shell';
const url = 'file://' + path.join(dir, 'index.html');

const bridge = `
window.__calls = [];
window.webkit = { messageHandlers: { nimbus: { postMessage(json) {
  const m = JSON.parse(json); window.__calls.push(m);
  const answers = {
    info: { version: '0.1', base: 'Ubuntu 24.04.3 LTS', kernel: '6.14.0-33-generic', cpu: 'AMD Ryzen 7 7840U w/ Radeon 780M Graphics', cores: 16,
      memory: 32 * 1024 ** 3, disk: { total: 512 * 1024 ** 3, free: 401 * 1024 ** 3 }, gpus: [{ name: 'AMD', driver: 'amdgpu' }],
      device: 'Framework Laptop 13', hostname: 'nimbus', uptime: 42, live: true, timezone: 'America/New_York', battery: { percent: 76, charging: false }, software: false },
    battery: { percent: 75, charging: false },
    timezones: ['America/Chicago', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC'],
    setTimezone: 'Europe/London', power: 'ok', log: true,
  };
  setTimeout(() => window.__nimbusNative.resolve(m.id, answers[m.method]), 20);
} } } };`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 3).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('ERROR ' + m.text()); });
  const step = async (name, fn) => { try { await fn(); } catch (e) { errors.push(`STEP ${name} FAILED: ${e.message.split('\n')[0]}`); } };
  await page.addInitScript(bridge);
  await page.goto(url);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'n1-boot.png') });
  await page.waitForTimeout(2200);
  await step('welcome', async () => {
    const tz = await page.$eval('.app-welcome select', (s) => s.value);
    if (tz !== 'America/New_York') errors.push('Welcome time zone shows ' + tz);
    const live = await page.textContent('.wl-sync');
    if (!/Live session/.test(live)) errors.push('Welcome storage line: ' + live);
    await page.screenshot({ path: path.join(OUT, 'n2-welcome.png') });
    await page.selectOption('.app-welcome select', 'Europe/London');
    await page.waitForTimeout(100);
    const call = await page.evaluate(() => window.__calls.find((c) => c.method === 'setTimezone'));
    if (!call || call.args.tz !== 'Europe/London') errors.push('setTimezone not called: ' + JSON.stringify(call));
    await page.click('.app-welcome .btn.primary');
  });
  await step('meta-start', async () => {
    await page.keyboard.down('Meta'); await page.keyboard.up('Meta');
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => window.__n === undefined ? document.getElementById('start').classList.contains('open') : true);
    if (!open) errors.push('Windows key did not open Start');
    await page.keyboard.press('Escape');
  });
  await step('about', async () => {
    await page.keyboard.down('Meta'); await page.keyboard.press('i'); await page.keyboard.up('Meta');
    await page.waitForTimeout(300);
    await page.click('.app-settings .ws-nav:has-text("System")');
    await page.waitForTimeout(200);
    await page.click('.app-settings .ws-card:has-text("Device specifications, rename PC")');
    await page.waitForTimeout(300);
    const t = await page.textContent('.app-settings .ws-content');
    if (!/Framework Laptop 13/.test(t) || !/6\.14/.test(t) || !/32\.0 GB/.test(t)) errors.push('About specs: ' + t.slice(0, 300));
    await page.screenshot({ path: path.join(OUT, 'n3-about.png') });
  });
  await step('alt-tab', async () => {
    await page.keyboard.down('Meta'); await page.keyboard.press('e'); await page.keyboard.up('Meta');
    await page.waitForTimeout(300);
    await page.keyboard.down('Alt'); await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, 'n4-alttab.png') });
    const shown = await page.$('.switcher');
    if (!shown) errors.push('Alt+Tab switcher did not show');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(150);
    const active = await page.$eval('.win.active', (w) => w.dataset.app).catch(() => 'none');
    if (active !== 'settings') errors.push('Alt+Tab should return to Settings, active is ' + active);
  });
  await step('alt-f4', async () => {
    await page.keyboard.down('Alt'); await page.keyboard.press('F4'); await page.keyboard.up('Alt');
    await page.waitForTimeout(250);
    const left = await page.$$eval('.win', (ws) => ws.map((w) => w.dataset.app));
    if (left.includes('settings')) errors.push('Alt+F4 did not close Settings: ' + left.join(','));
  });
  await step('terminal', async () => {
    await page.keyboard.press('Control+Alt+t');
    await page.waitForTimeout(300);
    // On Nimbus OS, Terminal is a real shell (tested by rterm.js); here it only has to open
    const real = await page.$('.rterm');
    if (!real) errors.push('Ctrl+Alt+T did not open the real terminal');
    await page.screenshot({ path: path.join(OUT, 'n5-terminal.png') });
  });
  await step('shutdown', async () => {
    await page.click('#tb-start'); await page.waitForTimeout(300);
    await page.click('#start-power'); await page.waitForTimeout(150);
    await page.click('.menu .mi:has-text("Shut down")');
    await page.waitForTimeout(2600);
    const p = await page.evaluate(() => window.__calls.filter((c) => c.method === 'power').map((c) => c.args.action));
    if (!p.includes('poweroff')) errors.push('Shut down did not call poweroff: ' + p.join(','));
    await page.screenshot({ path: path.join(OUT, 'n6-shutdown.png') });
  });
  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
