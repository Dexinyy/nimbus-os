// End-to-end test of the real terminal: the desktop page in Chromium, with terminal calls going to
// term_bridge.py (nimbus_term.Terminals + real bash) and other native calls answered by a mock.
// usage: node shell/test/rterm.js   (from the repository root, after python3 shell/build.py)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail) => { results.push([name, ok]); console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : '  ' + (detail || ''))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const home = fs.mkdtempSync('/tmp/rterm-home-');
  fs.writeFileSync(path.join(home, '.bashrc'), 'PS1="\\u@nimbus:\\w\\$ "\n');
  const py = spawn('python3', [path.join(__dirname, 'term_bridge.py')], { env: { ...process.env, HOME: home, LANG: 'C.UTF-8' }, cwd: home });
  py.stderr.on('data', (d) => process.stderr.write('[bridge] ' + d));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.exposeBinding('__bridgeSend', (_src, raw) => { py.stdin.write(raw + '\n'); });
  let buf = '';
  py.stdout.on('data', async (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const m = JSON.parse(line);
      const js = m.event ? `window.__nimbusNative.event(${JSON.stringify(m.event)}, ${JSON.stringify(m.data)})`
        : `window.__nimbusNative.${m.ok ? 'resolve' : 'reject'}(${m.reply}, ${JSON.stringify(m.data)})`;
      page.evaluate(js).catch(() => {});
    }
  });
  await page.addInitScript(() => {
    const info = { version: '0.1', base: 'Ubuntu 24.04 LTS', kernel: '7.0.0', cpu: 'Test CPU', cores: 2, memory: 4e9, disk: { total: 2e9, free: 1e9 },
      gpus: [], device: 'Test PC', hostname: 'nimbus', uptime: 1, live: true, timezone: 'UTC', battery: null, software: true };
    const term = new Set(['termOpen', 'termInput', 'termResize', 'termClose', 'log']);
    window.webkit = { messageHandlers: { nimbus: { postMessage(raw) {
      const m = JSON.parse(raw);
      if (term.has(m.method)) { window.__bridgeSend(raw); return; }
      const reply = { info, timezones: ['UTC'], battery: null }[m.method];
      setTimeout(() => window.__nimbusNative.resolve(m.id, reply === undefined ? true : reply), 5);
    } } } };
  });
  await page.goto('file://' + path.resolve(__dirname, '../dist/test.html'));
  await page.waitForTimeout(3000);
  // Close Welcome, open Terminal with Ctrl+Alt+T
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'welcome'); if (w) __n.WM.close(w, true); });
  await page.keyboard.press('Control+Alt+t');
  const screenText = () => page.evaluate(() => [...document.querySelectorAll('.rt-back .rt-row, .rt-screen .rt-row')].map((r) => r.textContent).join('\n'));
  const waitFor = async (needle, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await screenText()).includes(needle)) return true; await sleep(100); } return false; };
  const promptSeen = async () => { const end = Date.now() + 6000; while (Date.now() < end) { if (/@[^\s]+:~[#$]/.test(await screenText())) return true; await sleep(100); } return false; };
  check('bash prompt appears', await promptSeen(), await screenText());

  await page.keyboard.type('echo hello-$((6*7))');
  await page.keyboard.press('Enter');
  check('typing a command runs it', await waitFor('hello-42'), await screenText());

  await page.keyboard.type("printf '\\033[1;32mGREEN\\033[0m \\033[48;5;27m BLUE \\033[0m 日本\\n'");
  await page.keyboard.press('Enter');
  let style = null;
  for (let i = 0; i < 40 && !style; i++) { await sleep(100); style = await page.evaluate(() => { const s = [...document.querySelectorAll('.rt-screen span')].find((x) => x.textContent === 'GREEN'); return s ? [s.style.color, s.style.fontWeight] : null; }); }
  check('colors and bold are drawn', style && style[0] === 'rgb(79, 220, 143)' && style[1] === '700', JSON.stringify(style));
  const wide = await page.evaluate(() => { const s = [...document.querySelectorAll('.rt-screen .rt-w2')][0]; return s ? Math.round(s.getBoundingClientRect().width) : 0; });
  const cell = await page.evaluate(() => { const p = document.createElement('span'); p.className = 'rt-probe'; p.textContent = 'MMMMMMMMMM'; document.querySelector('.rt-screen').append(p); const w = p.getBoundingClientRect().width / 10; p.remove(); return w; });
  check('wide characters take two columns', Math.abs(wide - 2 * cell) < 1.5, `${wide} vs ${2 * cell}`);

  await page.keyboard.type('stty size');
  await page.keyboard.press('Enter');
  await sleep(500);
  const before = (await screenText()).split('\n').reverse().find((l) => /^\d+ \d+$/.test(l.trim()));
  await page.evaluate(() => { const w = __n.WM.list().find((x) => x.appId === 'terminal'); __n.WM.toggleMax(w); });
  await sleep(700);
  await page.keyboard.type('clear; stty size');
  await page.keyboard.press('Enter');
  await sleep(600);
  const after = (await screenText()).split('\n').find((l) => /^\d+ \d+$/.test(l.trim()));
  check('maximizing resizes the terminal', before && after && before !== after, `${before} -> ${after}`);

  await page.keyboard.type('seq 1 300');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 60; i++) { if ((await screenText()).split('\n').some((l) => l.trim() === '300')) break; await sleep(100); }
  await sleep(200);
  const backRows = await page.evaluate(() => document.querySelectorAll('.rt-back .rt-row').length);
  check('scrolled lines are kept above', backRows > 200, backRows);

  await page.keyboard.type('sleep 20');
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.press('Control+c');
  await sleep(300);
  await page.keyboard.type('echo stopped-ok');
  await page.keyboard.press('Enter');
  check('Ctrl+C stops a running command', await waitFor('\nstopped-ok') || (await screenText()).split('\n').some((l) => l.trim() === 'stopped-ok'), (await screenText()).slice(-300));

  await page.keyboard.type('echo abc');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+k');
  await page.keyboard.type('echo ctrl-k-is-for-bash');
  await page.keyboard.press('Enter');
  const startOpen = await page.evaluate(() => !!document.querySelector('.flyout.open, .start.open, #start.open'));
  check('Ctrl+K edits the command line instead of opening Start', (await waitFor('ctrl-k-is-for-bash')) && !startOpen, (await screenText()).slice(-200));

  if (fs.existsSync('/usr/bin/less')) {
    await page.keyboard.type('seq 1 500 | less');
    await page.keyboard.press('Enter');
    await sleep(800);
    const alt = await page.evaluate(() => document.querySelector('.rterm').classList.contains('alt'));
    await page.screenshot({ path: path.join(shots, 'rterm-less.png') });
    await page.keyboard.press('q');
    await sleep(500);
    const back = await page.evaluate(() => !document.querySelector('.rterm').classList.contains('alt'));
    check('less uses the alternate screen and q returns to the shell', alt && back, `${alt} ${back}`);
  }

  await page.keyboard.type('ls --color=always /usr');
  await page.keyboard.press('Enter');
  await sleep(500);
  await page.screenshot({ path: path.join(shots, 'rterm.png') });

  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await sleep(800);
  const gone = await page.evaluate(() => !__n.WM.list().some((x) => x.appId === 'terminal'));
  check('exit closes the window', gone, '');

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  py.stdin.end();
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} failed` : '\nAll real terminal tests passed');
  process.exit(failed ? 1 : 0);
})();
