// Second pass: verify fixes, cloud sync between two devices, assistant tools, downloads.
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, 'shots');
const url = 'file://' + path.join(__dirname, '..', 'dist', 'test.html');

// A fake Claude viewer runtime: db + user + sample (with tools) + downloads
const fakeRuntime = (seed) => `
(() => {
  const store = new Map(${JSON.stringify(seed || [])});
  window.__fakeStore = store;
  const snap = (id, body) => ({ id, exists: !!body, data: () => body, metadata: { fromCache: false, hasPendingWrites: false } });
  const db = { collection: (p) => ({ path: p,
    doc: (id) => ({ id, path: p + '/' + id,
      get: async () => snap(id, store.get(p + '/' + id)),
      set: async (b) => { const s = JSON.stringify(b); if (s.length > 262144) throw { code: 'invalid_argument', message: 'too big' }; store.set(p + '/' + id, JSON.parse(s)); },
      delete: async () => { store.delete(p + '/' + id); } }),
    get: async () => { const docs = [...store.entries()].filter(([k]) => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/')).map(([k, v]) => snap(k.slice(p.length + 1), v)); return { docs, size: docs.length, empty: !docs.length }; } }) };
  const user = { id: async () => 'u_test' };
  const sample = async (input, opts = {}) => {
    window.__lastPrompt = input;
    if (opts.tools) {
      const t = (n) => opts.tools.find((x) => x.name === n);
      await t('change_settings').execute({ theme: 'dark', accent: '#d83b45' }, { signal: new AbortController().signal });
      await t('write_file').execute({ path: '/Documents/Packing list.txt', content: '- socks\\n- charger' }, { signal: new AbortController().signal });
      await t('start_timer').execute({ minutes: 10 }, { signal: new AbortController().signal });
      try { await t('read_file').execute({ path: '/Nope.txt' }, {}); } catch (e) { window.__toolErr = e.message; }
    }
    const text = 'Done. I switched you to **dark mode** with a red accent, saved your packing list:\\n- socks\\n- charger';
    opts.onText && opts.onText({ text, delta: text });
    return { text, truncated: false, modelTierApplied: 'quick' };
  };
  sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
  sample.json = async () => ({});
  const downloads = { save: async ({ filename, data }) => { window.__downloaded = filename; return { status: 'saved' }; } };
  window.claude = { use: (n) => new Promise((r) => setTimeout(() => r({ db, user, sample, downloads }[n] || null), 150)) };
})();`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', (e) => errors.push(`${tag} PAGEERROR ${e.message}\n${(e.stack || '').split('\n').slice(0, 3).join('\n')}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${tag} ${m.type().toUpperCase()} ${m.text()}`); });
  };
  const step = async (name, fn) => { try { await fn(); } catch (e) { errors.push(`STEP ${name} FAILED: ${e.message.split('\n')[0]}`); } };

  // ---- Device 1 ----
  const c1 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await c1.addInitScript(fakeRuntime());
  const p1 = await c1.newPage(); watch(p1, 'D1');
  await p1.goto(url); await p1.waitForTimeout(1500);
  await step('d1-welcome', async () => {
    await p1.fill('.app-welcome input[aria-label="What should we call you?"], .app-welcome input[aria-label="Your name"]', 'Dana Lee');
    await p1.waitForTimeout(500);
    await p1.click('.app-welcome .btn.primary');
  });
  await step('d1-notes', async () => {
    await p1.evaluate(() => window.__n.WM.open('notes'));
    await p1.waitForTimeout(200);
    // the earlier failure: a menu left open must not swallow keys
    await p1.click('#desktop', { button: 'right', position: { x: 700, y: 400 } }).catch(() => {});
    await p1.evaluate(() => window.__n.WM.open('notes'));
    await p1.waitForTimeout(200);
    await p1.keyboard.type('Shopping list\n- apples\n- bread');
    await p1.keyboard.press('Control+s'); await p1.waitForTimeout(300);
    await p1.keyboard.press('Enter'); await p1.waitForTimeout(300);
    const ok = await p1.evaluate(() => Object.values(window.__n.FS.nodes).some((n) => n.name === 'Shopping list.txt'));
    if (!ok) errors.push('D1 Notes save failed');
  });
  await step('d1-assistant', async () => {
    await p1.waitForTimeout(400);
    const avail = await p1.evaluate(() => !!window.__n.caps.sample && document.documentElement.classList.contains('has-assistant'));
    if (!avail) errors.push('D1 assistant not available');
    await p1.click('#tb-assist'); await p1.waitForTimeout(300);
    await p1.fill('.app-ai textarea', 'Make it dark with a red accent and save a packing list');
    await p1.keyboard.press('Enter'); await p1.waitForTimeout(900);
    const r = await p1.evaluate(() => ({ theme: window.__n.S.data.theme, accent: window.__n.S.data.accent, file: Object.values(window.__n.FS.nodes).some((n) => n.name === 'Packing list.txt'), timer: window.__n.Clock.timer.running, err: window.__toolErr, promptHasFiles: JSON.stringify(window.__lastPrompt).includes('Shopping list.txt') }));
    if (r.theme !== 'dark' || r.accent !== '#d83b45' || !r.file || !r.timer || !r.err || !r.promptHasFiles) errors.push('D1 assistant tools result ' + JSON.stringify(r));
    await p1.evaluate(() => { const { WM } = window.__n; const a = WM.list().find((w) => w.appId === 'assistant'); WM.focus(a); });
    await p1.waitForTimeout(200);
    await p1.screenshot({ path: path.join(OUT, '20-assistant.png') });
  });
  await step('d1-download', async () => {
    await p1.evaluate(() => { const { WM } = window.__n; WM.open('settings', { page: 'accounts' }); });
    await p1.waitForTimeout(200);
    await p1.click('.app-settings button:has-text("Download a backup")');
    await p1.waitForTimeout(200);
    const f = await p1.evaluate(() => window.__downloaded);
    if (!f || !/backup\.json$/.test(f)) errors.push('D1 download did not run: ' + f);
  });
  let seed;
  await step('d1-sync', async () => {
    await p1.waitForTimeout(2500);
    seed = await p1.evaluate(() => [...window.__fakeStore.entries()]);
    const keys = seed.map(([k]) => k.split('/').pop());
    const status = await p1.evaluate(() => window.__n.Store.status.cloud);
    if (status !== 'on' || !keys.includes('settings') || !keys.includes('fs') || !keys.some((k) => k.startsWith('c-'))) errors.push('D1 sync incomplete: ' + status + ' ' + keys.join(','));
  });

  // ---- Device 2: same account, empty browser ----
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await c2.addInitScript(fakeRuntime(seed));
  const p2 = await c2.newPage(); watch(p2, 'D2');
  await p2.goto(url); await p2.waitForTimeout(2200);
  await step('d2-adopt', async () => {
    const r = await p2.evaluate(() => ({ name: window.__n.S.data.userName, theme: window.__n.S.data.theme, shopping: Object.values(window.__n.FS.nodes).find((n) => n.name === 'Shopping list.txt'), welcomeOpen: window.__n.WM.list().some((w) => w.appId === 'welcome') }));
    const content = r.shopping ? await p2.evaluate((id) => window.__n.FS.read(id), r.shopping.id) : '';
    if (r.name !== 'Dana Lee' || r.theme !== 'dark' || !content.includes('apples') || r.welcomeOpen) errors.push('D2 adopt failed ' + JSON.stringify({ ...r, shopping: !!r.shopping, content }));
    const pics = await p2.evaluate(() => Object.values(window.__n.FS.nodes).filter((n) => n.kind === 'image').map((n) => window.__n.FS.read(n.id).length));
    if (!pics.length || pics.some((l) => l < 1000)) errors.push('D2 pictures missing or empty: ' + pics.join(','));
  });
  await step('d2-lock', async () => {
    await p2.evaluate(() => window.__n.Power.lock()); await p2.waitForTimeout(500);
    await p2.screenshot({ path: path.join(OUT, '21-lock.png') });
    await p2.mouse.click(600, 400); await p2.waitForTimeout(700);
  });

  // ---- Phone-sized screen ----
  const c3 = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const p3 = await c3.newPage(); watch(p3, 'M');
  await p3.goto(url); await p3.waitForTimeout(1200);
  await p3.screenshot({ path: path.join(OUT, '22-mobile.png') });

  console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
  await browser.close();
})();
