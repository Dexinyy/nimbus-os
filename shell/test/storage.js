// "Saving your work" UI test: the desktop page with a mock storage helper behind the native bridge.
// usage: node shell/test/storage.js   (from the repository root, after python3 shell/build.py)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + (detail || ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GB = 1e9;

async function boot(browser, { persistent = false, candidates }) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript(({ persistent, candidates }) => {
    const info = { version: '0.1', base: 'Ubuntu 24.04 LTS', kernel: '7.0.0', cpu: 'Test CPU', cores: 2, memory: 4e9, disk: { total: 2e9, free: 1e9 },
      gpus: [], device: 'Test PC', hostname: 'nimbus', uptime: 1, live: true, persistent, timezone: 'UTC', battery: null, software: true, open: '', test: '' };
    const state = { setups: [], storage: persistent ? { device: '/dev/sdb3', active: true, disk: { name: 'SanDisk Ultra', kind: 'USB stick', size: 16e9 }, size: 14e9, free: 13e9 } : null };
    window.__state = state;
    const methods = {
      info: () => info, timezones: () => ['UTC'], battery: () => null, netStatus: () => ({ available: false }),
      storageStatus: () => ({ ok: true, label: 'writable', persistentBoot: true, storage: state.storage, candidates: state.storage ? [] : candidates }),
      storageSetup: ({ id }) => { state.setups.push(id); state.storage = { device: '/dev/x', active: false, disk: { name: 'X', kind: 'disk', size: 1 }, size: 1, free: null }; return { ok: true, storage: state.storage, candidates: [] }; },
      power: ({ action }) => { state.power = action; return action; },
    };
    window.webkit = { messageHandlers: { nimbus: { postMessage(raw) {
      const m = JSON.parse(raw);
      setTimeout(() => { try { const f = methods[m.method]; window.__nimbusNative.resolve(m.id, f ? f(m.args || {}) : true); } catch (e) { window.__nimbusNative.reject(m.id, e.message); } }, 20);
    } } } };
  }, { persistent, candidates });
  await page.goto('file://' + path.resolve(__dirname, '../dist/test.html'));
  await page.waitForTimeout(3000);
  return page;
}
const dialogTitle = (page) => page.evaluate(() => document.querySelector('.modal-scrim .modal h2, .modal-scrim h2, .modal-scrim .dlg-title')?.textContent || '');
const clickButton = (page, label) => page.evaluate((label) => { const b = [...document.querySelectorAll('.modal-scrim button')].find((x) => x.textContent.trim() === label); if (b) b.click(); return !!b; }, label);

(async () => {
  const browser = await chromium.launch();
  const offers = [
    { id: 'empty:sdb', kind: 'empty', device: '/dev/sdb', disk: { name: 'VBOX HARDDISK', kind: 'disk', size: 8.6 * GB }, size: 8.6 * GB },
    { id: 'empty:sdc', kind: 'empty', device: '/dev/sdc', disk: { name: 'Spare SSD', kind: 'disk', size: 120 * GB }, size: 120 * GB },
  ];

  let page = await boot(browser, { candidates: offers });
  const welcomeLink = await page.evaluate(() => [...document.querySelectorAll('.wl-foot .linkbtn')].map((b) => b.textContent));
  check('Welcome offers to set up saving in a live session', welcomeLink.includes('Set up saving'), welcomeLink.join(','));
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'welcome'); if (w) __n.WM.close(w, true); __n.WM.open('settings', { page: 'saving' }); });
  await sleep(700);
  const row = await page.evaluate(() => document.querySelector('[data-sid="saving"] .ws-t')?.textContent);
  check('Settings › System says the work isn’t saved yet', row === 'Your work isn’t saved yet', row);
  await page.click('[data-sid="saving"] .ws-btn');
  await sleep(600);
  const opts = await page.evaluate(() => [...document.querySelectorAll('.stg-opt b')].map((b) => b.textContent));
  check('the dialog offers the empty disks by name', opts.length === 2 && opts[0] === 'Empty disk: VBOX HARDDISK' && opts[1] === 'Empty disk: Spare SSD', opts.join(' | '));
  await page.screenshot({ path: path.join(shots, 'storage-choose.png') });
  await page.click('.stg-opt >> nth=1');
  await clickButton(page, 'Set up saving');
  await sleep(500);
  const warn = await dialogTitle(page);
  check('using a disk needs a second, explicit confirmation naming it', warn === 'Use Spare SSD?', warn);
  await clickButton(page, 'Cancel');
  await sleep(400);
  check('cancelling sets up nothing', (await page.evaluate(() => window.__state.setups.length)) === 0);

  await page.click('[data-sid="saving"] .ws-btn');
  await sleep(600);
  await clickButton(page, 'Set up saving');
  await sleep(500);
  await clickButton(page, 'Erase and use it');
  await sleep(800);
  const ready = await dialogTitle(page);
  const setups = await page.evaluate(() => window.__state.setups);
  check('confirming sets up the chosen disk', setups.join() === 'empty:sdb' && ready === 'Saving is ready', `${setups} / ${ready}`);
  await clickButton(page, 'Restart now');
  await sleep(1500);
  check('Restart now restarts the computer', (await page.evaluate(() => window.__state.power)) === 'reboot', await page.evaluate(() => window.__state.power));
  check('no page errors (1)', page.errors.length === 0, page.errors.join(' | '));
  await page.close();

  page = await boot(browser, { candidates: [] });
  await page.evaluate(() => __n.Storage.open());
  await sleep(600);
  const none = await page.evaluate(() => document.querySelector('.modal-scrim')?.textContent || '');
  check('with no place to save, it explains how to add one', none.includes('No place to save yet') && none.includes('VirtualBox') && none.includes('USB stick'), none.slice(0, 160));
  await page.close();

  page = await boot(browser, { persistent: true, candidates: [] });
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'welcome'); if (w) __n.WM.close(w, true); __n.WM.open('settings', { page: 'saving' }); });
  await sleep(700);
  const on = await page.evaluate(() => document.querySelector('[data-sid="saving"] .ws-t')?.textContent);
  const label = await page.evaluate(() => __n.Store.shortLabel());
  check('with saving on, Settings and the status label say so', on === 'Saving is on' && label === 'Saved', `${on} / ${label}`);
  check('no page errors (2)', page.errors.length === 0, page.errors.join(' | '));
  await page.close();

  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? `\n${failed} failed` : '\nAll storage UI tests passed');
  process.exit(failed ? 1 : 0);
})();
