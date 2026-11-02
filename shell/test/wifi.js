// Wi-Fi UI test: the desktop page with a mock NetworkManager behind the native bridge.
// usage: node shell/test/wifi.js   (from the repository root, after python3 shell/build.py)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + (detail || ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const info = { version: '0.1', base: 'Ubuntu 24.04 LTS', kernel: '7.0.0', cpu: 'Test CPU', cores: 2, memory: 4e9, disk: { total: 2e9, free: 1e9 },
      gpus: [], device: 'Test PC', hostname: 'nimbus', uptime: 1, live: true, timezone: 'UTC', battery: null, software: true };
    // A small NetworkManager
    const nm = { wifi: true, airplane: false, connected: '', saved: new Set(), calls: [] };
    const air = [
      { ssid: 'Home Fibre', signal: 82, secure: true, security: 'WPA2' },
      { ssid: 'Café Libre', signal: 48, secure: false, security: '' },
      { ssid: 'Neighbours 5G', signal: 22, secure: true, security: 'WPA3' },
    ];
    const status = () => ({ available: true, wifi: { present: true, hardware: true, enabled: nm.wifi && !nm.airplane, ssid: nm.connected, signal: nm.connected ? air.find((n) => n.ssid === nm.connected).signal : 0, connecting: '', device: 'wlan0' },
      wired: { present: true, connected: false, name: '' }, connectivity: nm.connected ? 'full' : 'none', airplane: nm.airplane });
    const list = () => (nm.wifi && !nm.airplane ? air.map((n) => ({ ...n, active: n.ssid === nm.connected, saved: nm.saved.has(n.ssid) })).sort((a, b) => b.active - a.active || b.signal - a.signal) : []);
    const methods = {
      info: () => info, timezones: () => ['UTC'], battery: () => null,
      netStatus: status, wifiList: list,
      wifiConnect: ({ ssid, password }) => {
        const n = air.find((x) => x.ssid === ssid);
        if (n.secure && !nm.saved.has(ssid) && password !== 'correct horse') throw new Error(`The password for ${ssid} isn't right.`);
        nm.connected = ssid; nm.saved.add(ssid); return status();
      },
      wifiDisconnect: () => { nm.connected = ''; return status(); },
      wifiForget: ({ ssid }) => { nm.saved.delete(ssid); if (nm.connected === ssid) nm.connected = ''; return status(); },
      wifiRadio: ({ on }) => { nm.wifi = on; if (!on) nm.connected = ''; return status(); },
      airplane: ({ on }) => { nm.airplane = on; if (on) nm.connected = ''; return status(); },
    };
    window.__nm = nm;
    window.webkit = { messageHandlers: { nimbus: { postMessage(raw) {
      const m = JSON.parse(raw); nm.calls.push(m.method);
      setTimeout(() => {
        try { const f = methods[m.method]; window.__nimbusNative.resolve(m.id, f ? f(m.args || {}) : true); }
        catch (e) { window.__nimbusNative.reject(m.id, e.message); }
      }, m.method === 'wifiConnect' ? 300 : 20);
    } } } };
  });
  await page.goto('file://' + path.resolve(__dirname, '../dist/test.html'));
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'welcome'); if (w) __n.WM.close(w, true); });

  const trayLabel = () => page.evaluate(() => document.querySelector('#tb-tray').getAttribute('aria-label'));
  check('tray shows "Not connected" when offline', (await trayLabel()).includes('Not connected'), await trayLabel());

  await page.click('#tb-tray');
  await sleep(500);
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#qs .qtile > span')].map((s) => s.textContent));
  check('Quick settings has Wi-Fi and Airplane mode tiles', tiles[0] === 'Wi-Fi' && tiles[1] === 'Airplane mode', tiles.join(', '));

  await page.click('#qs .qb-more');
  await sleep(500);
  const names = await page.evaluate(() => [...document.querySelectorAll('#qs .net-name')].map((s) => s.textContent));
  check('the Wi-Fi view lists networks, strongest first', names.join('|') === 'Home Fibre|Café Libre|Neighbours 5G', names.join('|'));

  await page.click('#qs .net-head >> nth=0');
  await sleep(300);
  const pwFocused = await page.evaluate(() => document.activeElement?.type === 'password');
  check('opening a secured network asks for its password', pwFocused, '');
  await page.keyboard.type('wrong-password');
  await page.keyboard.press('Enter');
  await sleep(700);
  const err = await page.evaluate(() => document.querySelector('#qs .net-err')?.textContent);
  check('a wrong password is explained', err === "The password for Home Fibre isn't right.", err);
  await page.screenshot({ path: path.join(shots, 'wifi-error.png') });

  await page.fill('#qs .net-pw input', 'correct horse');
  await page.keyboard.press('Enter');
  await sleep(900);
  const state = await page.evaluate(() => document.querySelector('#qs .net.active .net-state')?.textContent);
  check('the right password connects', state === 'Connected', state);
  check('the tray shows the network', (await trayLabel()).includes('Home Fibre'), await trayLabel());
  await page.screenshot({ path: path.join(shots, 'wifi-connected.png') });

  // A typed password survives a refresh of the list
  await page.click('#qs .net-head >> nth=2');
  await sleep(200);
  await page.keyboard.type('half-typed');
  await page.evaluate(() => __n.bus.emit('native:net', __n.Net.status));
  await page.evaluate(() => __n.Net.scan(false));
  await sleep(300);
  const kept = await page.evaluate(() => [document.activeElement?.value, document.activeElement?.type]);
  check('a password being typed survives list refreshes', kept[0] === 'half-typed' && kept[1] === 'password', kept.join(','));

  await page.click('#qs .qs-head .ibtn');
  await sleep(300);
  await page.click('#qs .qtile >> nth=1 >> .qb');
  await sleep(500);
  check('airplane mode turns everything off', (await trayLabel()).includes('Airplane mode'), await trayLabel());
  await page.click('#qs .qtile >> nth=1 >> .qb');
  await sleep(500);

  // Settings opened before the first network status arrives must fill in once it does
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(() => { const s = __n.Net.status; __n.Net.status = null; __n.WM.open('settings', { page: 'network' }); return s; });
  await sleep(500);
  const before = await page.evaluate(() => document.querySelector('.app-settings .net-hero .ws-d')?.textContent || '');
  await page.evaluate((s) => __n.bus.emit('native:net', s), saved);
  await sleep(500);
  await page.evaluate(() => __n.WM.open('settings', { page: 'wifi' }));
  await sleep(700);
  const after = await page.evaluate(() => document.querySelectorAll('.app-settings .net').length);
  check('a page opened before the network status arrives fills in later', before.includes('isn’t running') && after === 3, `${before} / ${after}`);
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'settings'); if (w) __n.WM.close(w, true); });
  await sleep(300);

  // Settings > Network & internet
  await page.evaluate(() => __n.WM.open('settings', { page: 'network' }));
  await sleep(900);
  const hero = await page.evaluate(() => document.querySelector('.net-hero-t')?.textContent);
  check('Settings shows the network page', hero === 'Not connected' || hero === 'Home Fibre', hero);
  await page.evaluate(() => __n.WM.open('settings', { page: 'wifi' }));
  await sleep(900);
  const listed = await page.evaluate(() => document.querySelectorAll('.app-settings .net').length);
  check('Settings lists networks too', listed === 3, listed);
  await page.click('.app-settings .net-head >> nth=1');
  await sleep(200);
  await page.click('.app-settings .net.open .btn.primary');
  await sleep(900);
  await page.evaluate(() => __n.WM.open('settings', { page: 'network' }));
  await sleep(600);
  const now = await page.evaluate(() => document.querySelector('.net-hero-t')?.textContent);
  check('an open network connects without a password, and the page updates', now === 'Café Libre', now);
  await page.screenshot({ path: path.join(shots, 'wifi-settings.png') });

  const search = await page.evaluate(() => { const i = document.querySelector('.app-settings .ws-search input'); i.value = 'wifi'; i.dispatchEvent(new Event('input')); return [...document.querySelectorAll('.app-settings .ws-sug b')].map((x) => x.textContent); });
  check('searching Settings finds Wi-Fi', search.includes('Wi-Fi'), search.join(', '));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? `\n${failed} failed` : '\nAll Wi-Fi tests passed');
  process.exit(failed ? 1 : 0);
})();
