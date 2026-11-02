// Opens every Settings page, on a stand-in for the Nimbus OS bridge with realistic hardware, and in a plain
// browser. Fails on script errors, pages that don't open, and a few behaviors that must keep working.
//   python3 build.py && python3 build.py --native /tmp/native-shell --test && node test/settings.js [/tmp/native-shell] [--shots]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const dir = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || '/tmp/native-shell';
const SHOTS = process.argv.includes('--shots');

const bridge = `
window.__calls = [];
const GB = 1024 ** 3;
const sound = { available: true, outputs: [
    { id: 52, name: 'Speakers', desc: 'Realtek High Definition Audio', kind: 'speaker', default: true, volume: 64, muted: false },
    { id: 61, name: 'Headphones', desc: 'WH-1000XM4', kind: 'bluetooth', default: false, volume: 40, muted: false }],
  inputs: [{ id: 53, name: 'Microphone Array', desc: 'Realtek High Definition Audio', kind: 'mic', default: true, volume: 80, muted: false }],
  streams: [{ id: 90, app: 'Google Chrome', name: 'YouTube', volume: 100, muted: false }] };
const answers = {
  info: { version: '0.1', base: 'Ubuntu 24.04.3 LTS', kernel: '6.14.0-33-generic', cpu: 'AMD Ryzen 7 7840U w/ Radeon 780M Graphics', cores: 16,
    memory: 32 * GB, disk: { total: 512 * GB, free: 401 * GB }, gpus: [{ name: 'AMD Radeon 780M', driver: 'amdgpu' }], arch: 'x86_64', uefi: true,
    device: 'Framework Laptop 13', hostname: 'nimbus', uptime: 42, live: true, timezone: 'America/New_York', battery: { percent: 76, charging: false },
    software: false, built: 1793000000, build: '760f99d', machineId: '4f1c2a…' },
  battery: { percent: 75, charging: false },
  timezones: ['America/Chicago', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC'],
  setTimezone: 'Europe/London', power: 'ok', log: true,
  soundStatus: sound, soundSet: true,
  displayStatus: { outputs: [{ name: 'eDP-1', desc: 'BOE 0x0BCA', make: 'BOE', model: 'NE135FBM-N41', width: 2256, height: 1504, refresh: 60000, scale: 1.5, transform: 0, phys: [285, 190],
    modes: [[2256, 1504, 60000, 1], [1920, 1200, 60000], [1920, 1080, 60000], [1680, 1050, 59954], [1280, 800, 59910]] }], backlight: { percent: 80 } },
  displaySet: true, brightnessSet: true,
  inputStatus: { keyboards: [{ name: 'AT Translated Set 2 keyboard' }], pointers: [{ name: 'PIXA3854:00 093A:0274 Touchpad', touchpad: true }, { name: 'Logitech MX Master 3', touchpad: false }], touchpad: true },
  btStatus: { available: true, powered: true, discovering: false, name: 'nimbus', devices: [
    { address: 'AA:BB:CC:DD:EE:01', name: 'WH-1000XM4', icon: 'audio-headset', paired: true, connected: true, battery: 70 },
    { address: 'AA:BB:CC:DD:EE:02', name: 'MX Master 3', icon: 'input-mouse', paired: true, connected: false },
    { address: 'AA:BB:CC:DD:EE:03', name: 'JBL Flip 5', icon: 'audio-card', paired: false, connected: false, rssi: -60 }] },
  btDo: true,
  powerStatus: { battery: { percent: 76, charging: false, timeLeft: 15300 }, profiles: ['power-saver', 'balanced', 'performance'], profile: 'balanced', ac: false },
  powerSet: true,
  timeStatus: { ntp: true, synced: true, timezone: 'America/New_York', canNtp: true, lastSync: Date.now() - 600000 },
  netStatus: { available: true, airplane: false, connectivity: 'full', wifi: { present: true, enabled: true, ssid: 'Home', signal: 72, connecting: '' }, wired: { present: true, connected: false, name: '' } },
  wifiList: [{ ssid: 'Home', signal: 72, secure: true, saved: true, active: true }, { ssid: 'Cafe Guest', signal: 40, secure: false, saved: false, active: false }],
  netConns: [{ uuid: 'u1', name: 'Home', type: 'wifi', ssid: 'Home', auto: true, active: true, metered: 'no', macRandom: 'preserve', ip4method: 'auto', addresses: [], gateway: '', dns: [], ignoreAutoDns: false, last: 1793000000 },
    { uuid: 'u2', name: 'Wired connection 1', type: 'ethernet', auto: true, active: false, metered: 'unknown', ip4method: 'auto', addresses: [], gateway: '', dns: [], ignoreAutoDns: false },
    { uuid: 'u3', name: 'office', type: 'wireguard', auto: false, active: false, metered: 'unknown', ip4method: 'manual', addresses: ['10.0.0.2/32'], gateway: '', dns: ['10.0.0.1'], ignoreAutoDns: true }],
  netDetails: { devices: [{ iface: 'wlp1s0', type: 'wifi', state: 'connected', mac: '3C:A9:F4:11:22:33', conn: 'u1', connName: 'Home', ip4: ['192.168.1.23/24'], ip6: ['fe80::1c2b:3d4e/64'], gw4: '192.168.1.1', dns: ['192.168.1.1'], speed: '866 Mb/s', product: 'Wi-Fi 6E AX210', vendor: 'Intel Corporation', driver: 'iwlwifi', protocol: 'Wi-Fi 5 (802.11ac)', security: 'WPA2-Personal', band: '5 GHz', channel: '44', mtu: '1500' },
    { iface: 'enp0s31f6', type: 'ethernet', state: 'unavailable', mac: '3C:A9:F4:44:55:66', product: 'Ethernet Connection I219-V', driver: 'e1000e' }] },
  netUsage: [{ iface: 'wlp1s0', type: 'wifi', name: 'Wi-Fi', rx: 812 * 1024 * 1024, tx: 96 * 1024 * 1024 }, { iface: 'enp0s31f6', type: 'ethernet', name: 'Ethernet', rx: 0, tx: 0 }],
  hotspotStatus: { supported: true, on: false, ssid: 'nimbus', password: '', band: 'any' },
  printers: { available: true, printers: [{ name: 'Office_LaserJet', info: 'HP LaserJet Pro M404', uri: 'ipp://192.168.1.40/ipp/print', state: 'Idle', default: true, jobs: 0 }] },
  printerFind: [{ uri: 'ipp://192.168.1.41/ipp/print', name: 'Brother_HL-L2350DW', info: 'Brother HL-L2350DW series' }],
  cameras: [{ name: 'Integrated Camera', path: '/dev/video0' }],
  fonts: [{ family: 'Selawik', styles: 4 }, { family: 'DejaVu Sans', styles: 6 }, { family: 'Noto Sans', styles: 12 }, { family: 'Ubuntu Mono', styles: 4, user: true }],
  storageUsage: { label: 'Local disk', total: 512 * GB, free: 401 * GB, categories: [{ label: 'Programs', bytes: 3.2 * GB, icon: 'apps', go: 'installedapps' }, { label: 'System', bytes: 5.1 * GB, icon: 'system' }, { label: 'Temporary files', bytes: 640 * 1024 * 1024, icon: 'delete', go: 'cleanup' }],
    temp: { cache: 420 * 1024 * 1024, apt: 180 * 1024 * 1024, tmp: 40 * 1024 * 1024 } },
  storageClean: { freed: 600 * 1024 * 1024 },
  disks: [{ name: 'nvme0n1', model: 'WD_BLACK SN770 512GB', size: 512 * GB, removable: false, nimbus: false, parts: [{ name: 'nvme0n1p1', label: 'EFI', fstype: 'vfat', size: 512 * 1024 * 1024 }, { name: 'nvme0n1p2', label: '', fstype: 'ntfs', size: 511 * GB }] },
    { name: 'sda', model: 'SanDisk Ultra', size: 32 * GB, removable: true, nimbus: true, parts: [{ name: 'sda1', label: 'NIMBUS', fstype: 'iso9660', size: 1 * GB, mount: '/cdrom' }] }],
  updateCheck: { current: { version: '0.1', commit: '760f99d' }, nimbusNew: true, latest: { name: '0.1', date: Date.now() - 86400000, url: 'https://github.com/Dexinyy/nimbus-os/releases/tag/latest' }, chrome: { installed: true, version: '142.0.7444.59', candidate: '142.0.7444.134', update: true } },
  updateHistory: [{ name: 'Google Chrome 142.0.7444.59', time: 1793000000, ok: true }],
  troubleshoot: { steps: [{ title: 'The sound service is running', ok: true }, { title: 'Speakers are the default output', ok: true }], summary: 'No problems found.' },
  appStatus: { chrome: { installed: true, version: '142.0.7444.59', size: 380 * 1024 * 1024, installedAt: 1793000000 } },
  storageStatus: { live: true, saving: false },
  hostnameSet: true, timeSet: true, timeSync: true, cursorSet: true, clipWatch: true, proxySet: true, privacySet: true, wmReady: 0,
};
// a fresh live system's WebKit reports the plain "C" locale
Object.defineProperty(navigator, 'language', { get: () => 'C' });
window.webkit = { messageHandlers: { nimbus: { postMessage(json) {
  const m = JSON.parse(json); window.__calls.push(m);
  setTimeout(() => window.__nimbusNative.resolve(m.id, m.method in answers ? answers[m.method] : null), 15);
} } } };`;

async function run(native) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push('ERROR ' + m.text()); });
  if (native) await page.addInitScript(bridge);
  await page.goto('file://' + path.join(native ? dir : path.join(__dirname, '..', 'dist'), native ? 'index.html' : 'test.html'));
  await page.waitForTimeout(2600);
  // past the welcome window
  await page.evaluate(() => { const n = window.__n; if (n) { n.S.set('setupDone', true); n.WM.list().forEach((w) => n.WM.close(w, true)); } });
  await page.evaluate(() => window.__n.WM.open('settings'));
  await page.waitForTimeout(600);
  const ids = await page.evaluate(() => Object.keys(window.__n.SPAGES));
  const bad = [];
  for (const id of ids) {
    await page.evaluate((p) => window.__n.WM.open('settings', { page: p }), id);
    await page.waitForTimeout(native ? 140 : 60);
    const r = await page.evaluate(() => {
      const c = document.querySelector('.app-settings .ws-content');
      const err = [...document.querySelectorAll('.app-settings .ws-info.error b')].map((b) => b.textContent);
      return { title: document.querySelector('.app-settings .ws-bc-cur')?.textContent, n: c ? c.children.length : 0, err };
    });
    if (!r.n || r.err.includes('This page couldn’t open')) bad.push(`${id}: ${JSON.stringify(r)}`);
    if (SHOTS) await page.screenshot({ path: path.join(OUT, `st-${native ? 'n' : 'w'}-${id}.png`) });
  }
  // Find a setting
  const found = await page.evaluate(async () => {
    const i = document.querySelector('.app-settings .ws-search input'); i.focus(); i.value = 'resolution'; i.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 50));
    return [...document.querySelectorAll('.app-settings .ws-sug b')].map((b) => b.textContent);
  });
  if (!found.some((t) => /resolution/i.test(t))) bad.push('search for "resolution" found ' + JSON.stringify(found));
  // Start's search finds settings too
  const startHits = await page.evaluate(async () => { window.__n.Flyouts.open('start'); const q = document.getElementById('start-q'); q.value = 'night light'; q.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 50)); const t = [...document.querySelectorAll('#start .res-t, #start [class*="res"] .t, #start button')].map((b) => b.textContent).join(' | '); window.__n.Flyouts.close(); return t; });
  if (!/Night light/.test(startHits)) bad.push('Start search for "night light" missed Settings: ' + startHits.slice(0, 200));
  // toggles change settings
  await page.evaluate(() => window.__n.WM.open('settings', { page: 'colors' }));
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.__n.S.data.transparency);
  await page.click('.app-settings [data-sid="transparency"] .ws-toggle');
  const after = await page.evaluate(() => window.__n.S.data.transparency);
  if (before === after) bad.push('transparency toggle did nothing');
  // a combo box picks a value
  await page.evaluate(() => window.__n.WM.open('settings', { page: 'colors' }));
  await page.waitForTimeout(120);
  await page.click('.app-settings [data-sid="theme"] .ws-combo');
  await page.click('.ws-pop .ws-pop-it:has-text("Dark")');
  if ((await page.evaluate(() => window.__n.S.data.theme)) !== 'dark') bad.push('color mode combo did not pick Dark');
  if (native) {
    // sound: choosing an output asks PipeWire
    await page.evaluate(() => window.__n.WM.open('settings', { page: 'sound' }));
    await page.waitForTimeout(250);
    await page.click('.app-settings .ws-dev:has-text("Headphones")');
    await page.waitForTimeout(60);
    const call = await page.evaluate(() => window.__calls.filter((c) => c.method === 'soundSet').pop());
    if (!call || call.args.what !== 'default' || call.args.id !== 61) bad.push('choosing Headphones sent ' + JSON.stringify(call));
    // display scale asks the window manager, then offers to revert
    await page.evaluate(() => window.__n.WM.open('settings', { page: 'display' }));
    await page.waitForTimeout(250);
    await page.click('.app-settings [data-sid="scale"] .ws-combo');
    await page.click('.ws-pop .ws-pop-it:has-text("125%")');
    await page.waitForTimeout(900);
    const ds = await page.evaluate(() => window.__calls.filter((c) => c.method === 'displaySet').pop());
    if (!ds || ds.args.scale !== 1.25) bad.push('scale 125% sent ' + JSON.stringify(ds));
    const keep = await page.$('.modal:has-text("Keep these display settings")');
    if (!keep) bad.push('no "Keep these display settings?" dialog');
    else await page.click('.modal .btn:has-text("Keep changes")');
    if (SHOTS) {
      for (const [p, theme] of [['system', 'light'], ['display', 'light'], ['sound', 'dark'], ['devices', 'light'], ['network', 'dark'], ['personalization', 'light'], ['colors', 'dark'], ['taskbar', 'light'], ['update', 'light'], ['home', 'dark'], ['about', 'light'], ['time', 'light']]) {
        await page.evaluate(([pp, t]) => { window.__n.S.set('theme', t); window.__n.WM.open('settings', { page: pp }); }, [p, theme]);
        await page.waitForTimeout(450);
        await page.screenshot({ path: path.join(OUT, `settings-${p}-${theme}.png`) });
      }
    }
  }
  await browser.close();
  return { errors, bad, pages: ids.length };
}

(async () => {
  let fail = false;
  for (const native of [true, false]) {
    if (!native && !fs.existsSync(path.join(__dirname, '..', 'dist', 'test.html'))) continue;
    const r = await run(native);
    console.log(`${native ? 'Nimbus OS' : 'browser'}: ${r.pages} pages`);
    for (const e of r.errors) console.log('  ' + e);
    for (const b of r.bad) console.log('  BAD ' + b);
    if (r.errors.length || r.bad.length) fail = true;
  }
  console.log(fail ? 'FAILED' : 'settings: all good');
  process.exit(fail ? 1 : 0);
})();
