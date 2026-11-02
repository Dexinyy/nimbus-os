// Checks Settings > Nimbus Update against a stand-in for the machine side. An update downloads, installs and asks for
// a restart, with Start's power menu following along. Cancelling and failing work. Without saving, or when a version
// needs the new ISO, the page explains why. Recovery goes back to the previous version.
//   python3 shell/build.py && node shell/test/update.js [--shots]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = process.argv.includes('--shots');
const url = 'file://' + path.resolve(__dirname, '../dist/test.html');

const bridge = `
window.__calls = [];
const now = Math.floor(Date.now() / 1000);
window.__upd = { mode: 'inplace', fail: false, cancelled: false, step: 220 };
const avail = { name: 'Nimbus OS 0.1', version: '0.1', commit: '9c1d2e3', date: now - 5 * 3600, size: 1183000, packages: 1,
  notes: [{ commit: '9c1d2e3', date: now - 5 * 3600, subject: 'Settings: install Nimbus updates in place' }, { commit: '8b7a6c5', date: now - 86400, subject: 'Store: faster search' }] };
const back = { version: '0.1', commit: '5a6b7c8', date: now - 10 * 86400, time: now - 3 * 86400 };
function check() {
  const m = window.__upd.mode;
  const st = { ok: true, current: { version: '0.1', commit: '760f99d0', date: now - 3 * 86400 }, live: true, saving: m !== 'saving', pending: null, back,
    iso: 'https://github.com/Dexinyy/nimbus-os/releases/tag/latest', chrome: null };
  if (m === 'none') return Object.assign(st, { available: null, nimbusNew: false });
  return Object.assign(st, { available: avail, nimbusNew: true, inplace: m === 'inplace', why: m === 'inplace' ? '' : m,
    reason: m === 'iso' ? 'This version changes how Nimbus OS starts, so it needs the new ISO.' : m === 'saving' ? 'Saving is off.' : '' });
}
const answers = {
  info: { version: '0.1', base: 'Ubuntu 24.04.3 LTS', kernel: '6.14.0-33-generic', cpu: 'Test CPU', cores: 4, memory: 8 * 1024 ** 3, disk: { total: 64 * 1024 ** 3, free: 40 * 1024 ** 3 },
    gpus: [], device: 'Test PC', hostname: 'nimbus', uptime: 42, live: true, persistent: true, timezone: 'UTC', battery: null, software: true, wm: true, built: now - 3 * 86400, build: '760f99d' },
  appStatus: { chrome: { installed: true, version: '142.0', icon: null } }, wmReady: true, wm: true, log: true, timezones: ['UTC'], programs: [], power: 'reboot',
  updateStatus: { ok: true, current: { version: '0.1', commit: '760f99d0' }, pending: null, back, saving: true, live: true },
  updateHistory: [], storeUpdates: [], securityStatus: { defs: { present: false }, prefs: {}, activeThreats: [], firewall: {} },
};
const reply = (m, v, d) => setTimeout(() => window.__nimbusNative.resolve(m.id, v), d || 10);
window.webkit = { messageHandlers: { nimbus: { postMessage(json) {
  const m = JSON.parse(json); window.__calls.push(m);
  if (m.method === 'updateCheck') return reply(m, check(), 120);
  if (m.method === 'updateCancel') { window.__upd.cancelled = true; return reply(m, true); }
  if (m.method === 'updateBack') return reply(m, { ok: true, back: true, version: '0.1', commit: '5a6b7c8', date: back.date }, 300);
  if (m.method === 'updateInstall') {
    window.__upd.cancelled = false;
    let phase = 'download', pct = 0;
    const t = setInterval(() => {
      if (window.__upd.cancelled && phase === 'download') { clearInterval(t); return window.__nimbusNative.reject(m.id, 'cancelled'); }
      pct += 10;
      if (window.__upd.fail && phase === 'install' && pct >= 40) { clearInterval(t); return window.__nimbusNative.reject(m.id, 'Couldn’t install hello: E: Unable to locate package hello'); }
      if (pct > 100) { if (phase === 'download') { phase = 'install'; pct = 0; } else { clearInterval(t);
        return window.__nimbusNative.resolve(m.id, { ok: true, name: 'Nimbus OS 0.1', version: '0.1', commit: '9c1d2e3', date: avail.date, changed: 14, kept: [], packages: ['hello'], warnings: [] }); } }
      window.__nimbusNative.event('update-progress', { phase, pct: Math.min(pct, 100), text: phase === 'download' ? (pct / 100 * 1.2).toFixed(1) + ' of 1.2 MB' : pct < 60 ? 'Installing hello' : 'Replacing Nimbus’s files' });
    }, window.__upd.step);
    return;
  }
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
  await page.evaluate(() => { __n.S.set('setupDone', true); __n.WM.list().forEach((w) => __n.WM.close(w, true)); });
  const shot = (n) => (SHOTS ? page.screenshot({ path: path.join(OUT, n + '.png') }) : null);
  const text = (sel) => page.textContent(sel).catch(() => '');
  const calls = (m) => page.evaluate((mm) => window.__calls.filter((c) => c.method === mm).map((c) => c.args), m);
  const reset = async (mode, extra) => {
    await page.evaluate(([md, ex]) => { Object.assign(window.__upd, { mode: md, fail: false, cancelled: false }, ex || {}); Object.assign(__n.Upd, { st: null, job: null, error: '', busy: false }); __n.S.set('updChecked', 0); }, [mode, extra]);
    await page.evaluate(() => __n.WM.open('settings', { page: 'home' }));
    await page.evaluate(() => __n.WM.open('settings', { page: 'update' }));
    await page.waitForFunction(() => __n.Upd.st && !__n.Upd.busy, null, { timeout: 5000 });
    await page.waitForTimeout(250);
  };
  try {
    // An update that installs in place
    await reset('inplace');
    check(/Updates available/.test(await text('.app-settings .ws-hero-name')), 'the hero does not say updates are available');
    const item = await text('.app-settings .ws-card:has-text("Nimbus OS 0.1 (build 9c1d2e3)")');
    check(/Pending download/.test(item) && /1\.1 MB download plus 1 Ubuntu package/.test(item), 'the update line is wrong: ' + item);
    check(await page.$('.app-settings .ws-hero .ws-btn:has-text("Download & install")'), 'no Download & install button');
    await shot('u1-available');
    await page.click('.app-settings .ws-hl:has-text("What’s new")');
    await page.waitForTimeout(200);
    check(/install Nimbus updates in place/.test(await text('.modal')), 'What’s new does not list the changes');
    await shot('u2-whats-new');
    await page.click('.modal .btn:has-text("Close")');
    // Downloading, then installing, then a restart
    await page.click('.app-settings .ws-hero .ws-btn:has-text("Download & install")');
    await page.waitForFunction(() => /Downloading – [3-9]\d%/.test(document.querySelector('.app-settings .upd-prog')?.textContent || ''), null, { timeout: 5000 });
    check(await page.$('.app-settings .upd-prog .ws-hl:has-text("Cancel")'), 'no Cancel while downloading');
    check(!(await page.$('.app-settings .ws-hero .ws-btn')), 'the hero still has a button while updating');
    await shot('u3-downloading');
    await page.waitForFunction(() => /Installing – [2-9]\d%/.test(document.querySelector('.app-settings .upd-prog')?.textContent || ''), null, { timeout: 8000 });
    check(!(await page.$('.app-settings .upd-prog .ws-hl:has-text("Cancel")')), 'Cancel still offered while installing');
    await shot('u4-installing');
    // Restarting halfway would leave Nimbus half updated: it waits
    await page.evaluate(() => { __n.Power.restart(); });
    await page.waitForTimeout(250);
    check(/installing an update/.test(await text('.modal')), 'restarting during the install was not held back');
    await shot('u5-restart-held');
    await page.click('.modal .btn:has-text("OK")');
    check(!(await calls('power')).length && !(await page.$('.screen.boot')), 'the PC restarted during the install');
    await page.waitForFunction(() => /Restart required/.test(document.querySelector('.app-settings .ws-hero-name')?.textContent || ''), null, { timeout: 8000 });
    check(/Pending restart/.test(await text('.app-settings .ws-group')), 'the update line does not wait for a restart');
    check(await page.$('.app-settings .ws-hero .ws-btn:has-text("Restart now")'), 'no Restart now button');
    check(await page.evaluate(() => __n.Notif.items.some((n) => /Restart to finish updating/.test(n.title))), 'no notification about the restart');
    await shot('u6-restart-required');
    // Start's power menu
    await page.evaluate(() => __n.Flyouts.open('start'));
    await page.waitForTimeout(300);
    check(await page.$('#start-power.upd'), 'no dot on Start’s power button');
    await page.click('#start-power');
    await page.waitForTimeout(200);
    const menu = await text('.menu');
    check(/Update and restart/.test(menu) && /Update and shut down/.test(menu), 'the power menu does not offer Update and restart: ' + menu);
    await shot('u7-power-menu');
    await page.keyboard.press('Escape');
    await page.evaluate(() => __n.Flyouts.close());
    // The System page's tile
    await page.evaluate(() => __n.WM.open('settings', { page: 'system' }));
    await page.waitForTimeout(250);
    check(/Restart required/.test(await text('.app-settings .ws-hero-tiles')), 'System’s Nimbus Update tile does not say a restart is needed');

    // Cancelling a download
    await reset('inplace', { step: 300 });
    await page.click('.app-settings .ws-hero .ws-btn:has-text("Download & install")');
    await page.waitForSelector('.app-settings .upd-prog .ws-hl:has-text("Cancel")', { timeout: 3000 });
    await page.click('.app-settings .upd-prog .ws-hl:has-text("Cancel")');
    await page.waitForFunction(() => !__n.Upd.job, null, { timeout: 3000 });
    await page.waitForTimeout(200);
    check((await calls('updateCancel')).length === 1, 'Cancel did not reach the helper');
    check(/Pending download/.test(await text('.app-settings .ws-group')), 'after cancelling the update is not offered again');

    // An install that fails
    await reset('inplace', { fail: true, step: 60 });
    await page.click('.app-settings .ws-hero .ws-btn:has-text("Download & install")');
    await page.waitForFunction(() => __n.Upd.job && __n.Upd.job.phase === 'error', null, { timeout: 8000 });
    await page.waitForTimeout(200);
    check(/Install error/.test(await text('.app-settings .ws-group')) && /Unable to locate package/.test(await text('.app-settings .ws-group')), 'the failure is not shown');
    check(await page.$('.app-settings .ws-hero .ws-btn:has-text("Try again")'), 'no Try again');
    await shot('u8-failed');

    // Saving is off; a version that needs the new ISO; nothing new
    await reset('saving');
    check(await page.$('.app-settings .ws-card .ws-btn:has-text("Turn on saving")') && /Turn on saving to install updates here/.test(await text('.app-settings .ws-group')), 'without saving the page does not explain');
    check(await page.$('.app-settings .ws-hero .ws-btn:has-text("Check for updates")'), 'without saving the hero should only check');
    await shot('u9-saving-off');
    await reset('iso');
    check(await page.$('.app-settings .ws-card .ws-btn:has-text("Get the ISO")') && /needs the new ISO/.test(await text('.app-settings .ws-group')), 'a version that needs the ISO is not explained');
    await shot('u10-needs-iso');
    await reset('none');
    check(/You’re up to date/.test(await text('.app-settings .ws-hero-name')), 'not up to date');
    await shot('u11-up-to-date');

    // Recovery: go back to the version before the last update
    await page.evaluate(() => { __n.Upd.local = null; __n.WM.open('settings', { page: 'recovery' }); });
    await page.waitForSelector('.app-settings [data-sid="goback"] .ws-btn:not([disabled])', { timeout: 3000 });
    check(/go back to build 5a6b7c8/.test(await text('.app-settings [data-sid="goback"]')), 'Go back does not name the earlier build');
    await shot('u12-recovery');
    await page.click('.app-settings [data-sid="goback"] .ws-btn');
    await page.waitForSelector('.modal .btn:has-text("Go back")');
    await page.click('.modal .btn:has-text("Go back")');
    await page.waitForSelector('.modal .btn:has-text("Restart now")', { timeout: 3000 });
    check((await calls('updateBack')).length === 1, 'Go back did not reach the helper');
    await shot('u13-went-back');
    await page.click('.modal .btn:has-text("Later")');
    await page.evaluate(() => __n.WM.open('settings', { page: 'update' }));
    await page.waitForTimeout(300);
    check(/Restart required/.test(await text('.app-settings .ws-hero-name')) && /Going back to this version/.test(await text('.app-settings .ws-group')), 'the update page does not wait for the restart after going back');
    check(await page.evaluate(() => __n.S.data.updWentBack === '5a6b7c8'), 'going back was not remembered for the next start');
  } catch (e) { errors.push('FAILED: ' + e.message); }
  await browser.close();
  if (errors.length) { console.log(errors.join('\n')); console.log('update: FAILED'); process.exit(1); }
  console.log('update: all good');
})();
