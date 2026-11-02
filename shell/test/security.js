// Checks Nimbus Security and Settings' game controllers against a stand-in for the machine side: every page
// renders, a scan shows its progress and its threat, Start actions quarantines it, the firewall's switches and
// allowed apps call the helper, and a controller's button presses light up the test.
//   python3 shell/build.py && node shell/test/security.js [--shots]
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
window.__st = {
  engine: '1.0.7', defs: { present: true, version: '1.27450', built: now - 3600, sigs: 8712345, updated: now - 3600, parts: {} },
  prefs: { realtime: true, downloads: true, pua: true, puaDownloads: true, notify: true, exclusions: [{ type: 'folder', path: '/home/nimbus/Games' }], allowed: [], lastQuick: now - 7200, lastFull: 0 },
  activeThreats: [], quarantined: 0, scan: null, realtime: true,
  firewall: { available: true, active: true, profile: 'public', enabled: { private: true, public: true }, block: { private: false, public: false }, incoming: 'deny', shares: [],
    apps: [{ id: 'steam-remote-play', name: 'Steam Remote Play', ports: '27031:27036/udp, 27036:27037/tcp', private: true, public: false, custom: false },
      { id: 'ssh', name: 'Remote sign-in (SSH)', ports: '22/tcp', private: false, public: false, custom: false }] },
  secureBoot: { supported: true, on: false }, tpm: { present: true, version: '2.0', name: 'TPM 2.0 Device' }, lockdown: 'none',
  network: { uuid: '0f0e0d0c-0b0a-0908-0706-050403020100', type: '802-11-wireless', name: 'Home Wi-Fi', profile: 'public' },
};
window.__hist = [{ id: 'h1', kind: 'scan', title: 'Quick scan', detail: '1,234 files scanned, 0 threats found', severity: 'info', status: 'done', time: now - 7200 }];
const answers = {
  info: { version: '0.1', base: 'Ubuntu 24.04.3 LTS', kernel: '7.0.0', cpu: 'Test CPU', cores: 4, memory: 8 * 1024 ** 3, disk: { total: 64 * 1024 ** 3, free: 40 * 1024 ** 3 },
    gpus: [], device: 'Test PC', hostname: 'nimbus', uptime: 42, live: false, persistent: true, timezone: 'UTC', battery: null, software: true, wm: true },
  appStatus: { chrome: { installed: true, version: '142.0', icon: null } }, wmReady: true, wm: true, log: true, timezones: ['UTC'], programs: [],
  securityDevice: { secureBoot: { supported: true, on: false }, tpm: { present: true, version: '2.0', name: 'TPM 2.0 Device' }, lockdown: 'none', uefi: true,
    mitigations: [{ name: 'Address space layout randomization (ASLR)', on: true, desc: 'x' }, { name: 'Data Execution Prevention (NX)', on: true, desc: 'x' }, { name: 'Control-flow protection (CET)', on: false, desc: 'x' }] },
  securityHealth: [{ id: 'storage', title: 'Storage capacity', ok: true, desc: '40.0 GB free of 64.0 GB' }, { id: 'time', title: 'Time service', ok: true, desc: 'The clock is set from the internet' }],
  controllers: [{ id: 'event7', name: 'DualSense Wireless Controller', model: 'DualSense', family: 'playstation', vendor: '054c', product: '0ce6', connection: 'Bluetooth', battery: { level: 70, charging: false }, rumble: true }],
  controllerWatch: true, controllerRumble: true, securityPrefs: true,
};
const reply = (m, v, d) => setTimeout(() => window.__nimbusNative.resolve(m.id, v), d || 10);
window.webkit = { messageHandlers: { nimbus: { postMessage(json) {
  const m = JSON.parse(json); window.__calls.push(m); const a = m.args || {};
  if (m.method === 'securityStatus') return reply(m, JSON.parse(JSON.stringify(window.__st)));
  if (m.method === 'securityHistory') return reply(m, window.__hist);
  if (m.method === 'securityScan') {
    let n = 0;
    window.__nimbusNative.event('security-scan', { kind: a.kind, state: 'loading', scanned: 0, total: 0, threats: [] });
    const t = setInterval(() => { n += 400; window.__nimbusNative.event('security-scan', { kind: a.kind, state: 'scanning', scanned: n, total: 2000, threats: [], current: '/home/nimbus/Downloads/file' + n });
      if (n >= 2000) { clearInterval(t);
        const th = { id: 't1', kind: 'threat', title: 'Win.Test.EICAR_HDB-1', threat: 'Win.Test.EICAR_HDB-1', path: '/tmp/invoice.pdf.com', severity: 'severe', category: 'Test file (harmless)', status: 'active', source: 'quick', time: now };
        window.__st.activeThreats = [th]; window.__hist.unshift(th);
        window.__nimbusNative.resolve(m.id, { kind: a.kind, state: 'done', scanned: 2000, total: 2000, threats: [th], started: now - 75, finished: now }); } }, 150);
    return;
  }
  if (m.method === 'securityActAll') { window.__st.activeThreats = []; window.__st.quarantined = 1; window.__hist[0].status = 'quarantined'; return reply(m, 1); }
  if (m.method === 'firewallSet') {
    if (a.what === 'block') window.__st.firewall.block[a.profile] = a.on;
    if (a.what === 'enabled') window.__st.firewall.enabled[a.profile] = a.on;
    if (a.what === 'app') window.__st.firewall.apps.find((x) => x.id === a.app)[a.profile] = a.on;
    return reply(m, window.__st.firewall);
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
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'welcome'); if (w) __n.WM.close(w, true); });
  const shot = (n) => SHOTS ? page.screenshot({ path: path.join(OUT, n + '.png') }) : null;
  const calls = (m) => page.evaluate((mm) => window.__calls.filter((c) => c.method === mm).map((c) => c.args), m);
  try {
    await page.evaluate(() => __n.WM.open('security'));
    await page.waitForTimeout(700);
    const tiles = await page.$$eval('.app-security .sec-tile b', (els) => els.map((e) => e.textContent));
    check(tiles.length === 6 && tiles.includes('Firewall & network protection'), 'home tiles: ' + tiles.join(', '));
    check(/protected/.test(await page.textContent('.app-security .sec-hero')), 'home does not say the device is protected');
    await shot('x1-security-home');
    // Each page renders
    for (const id of ['virus', 'scanoptions', 'threatsettings', 'exclusions', 'allowed', 'updates', 'account', 'firewall', 'fwprofile', 'fwapps', 'appbrowser', 'exploit', 'device', 'health', 'history', 'settings']) {
      await page.evaluate((pg) => __n.WM.open('security', { page: pg, profile: 'public' }), id);
      await page.waitForTimeout(350);
      const h1 = await page.$eval('.app-security .sec-page', (el) => (el.querySelector('h1') || {}).textContent || '');
      check(h1.length > 2, 'page ' + id + ' has no heading');
      if (['firewall', 'device', 'fwapps'].includes(id)) await shot('x-security-' + id);
    }
    // A quick scan: progress, then its threat, then Start actions
    await page.evaluate(() => __n.WM.open('security', { page: 'virus' }));
    await page.waitForTimeout(400);
    await page.click('.app-security .sec-scan .btn');
    await page.waitForTimeout(500);
    check(/files scanned|Loading/.test(await page.textContent('.app-security .sec-scan')), 'no progress while scanning');
    await shot('x2-scanning');
    await page.waitForTimeout(1400);
    check(/Threat found/.test(await page.textContent('.app-security .sec-scan')), 'the scan\'s threat is not shown');
    await shot('x3-threat');
    await page.click('.app-security .sec-scan .btn.primary');
    await page.waitForTimeout(600);
    check((await calls('securityActAll')).length === 1, 'Start actions did nothing');
    check(/No current threats/.test(await page.textContent('.app-security .sec-scan')), 'threat still shown after Start actions');
    // Firewall: block incoming on public networks, allow SSH on private ones
    await page.evaluate(() => __n.WM.open('security', { page: 'fwprofile', profile: 'public' }));
    await page.waitForTimeout(400);
    await page.click('.app-security .ws-check');
    await page.waitForTimeout(300);
    check((await calls('firewallSet')).some((a) => a.what === 'block' && a.profile === 'public' && a.on), 'blocking incoming connections did not reach the firewall');
    await page.evaluate(() => __n.WM.open('security', { page: 'fwapps' }));
    await page.waitForTimeout(400);
    await page.click('.app-security .sec-tr:nth-child(3) input:first-of-type');
    await page.waitForTimeout(300);
    check((await calls('firewallSet')).some((a) => a.what === 'app' && a.app === 'ssh' && a.profile === 'private' && a.on), 'allowing an app did not reach the firewall');
    // History lists the threat as quarantined
    await page.evaluate(() => __n.WM.open('security', { page: 'history' }));
    await page.waitForTimeout(500);
    await page.click('.app-security .sec-hhead');
    await page.waitForTimeout(200);
    check(/Threat quarantined/.test(await page.textContent('.app-security .sec-hist')), 'history does not show the quarantined threat');
    await shot('x4-history');
    // Settings > Privacy & security > Nimbus Security
    await page.evaluate(() => __n.WM.open('settings', { page: 'winsec' }));
    await page.waitForTimeout(700);
    check((await page.textContent('.app-settings')).includes('Protection areas'), 'Settings has no Nimbus Security page');
    // Settings > Bluetooth & devices > Game controllers: the DualSense, its battery, the test
    await page.evaluate(() => __n.WM.open('settings', { page: 'controllers' }));
    await page.waitForTimeout(700);
    const pads = await page.textContent('.app-settings');
    check(/DualSense Wireless Controller/.test(pads) && /Battery 70%/.test(pads), 'the controller or its battery is missing');
    await page.click('.app-settings .ws-card:has-text("DualSense Wireless Controller") .ws-ctl button:has-text("Test")');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__nimbusNative.event('controller-input', { id: 'event7', buttons: { south: true, rb: true }, axes: { lx: 0.8, ly: -0.5, rx: 0, ry: 0, lt: 0.6, rt: 0, hatx: 0, haty: -1 } }));
    await page.waitForTimeout(200);
    check(await page.$('.gp-svg [data-b="south"].on'), 'Cross did not light up in the test');
    check(await page.$('.gp-svg [data-b="up"].on'), 'the d-pad did not light up');
    await shot('x5-controller-test');
    check((await calls('controllerWatch')).some((a) => a.on && a.id === 'event7'), 'the test did not start watching the controller');
  } catch (e) { errors.push('FAILED: ' + e.message); }
  await browser.close();
  console.log(errors.length ? errors.join('\n') : 'All Security and controller tests passed');
  process.exit(errors.length ? 1 : 0);
})();
