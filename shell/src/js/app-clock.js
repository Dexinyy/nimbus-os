/* ========== Clock service (keeps running when the Clock window is closed) ========== */
const Clock = {
  focus: { dur: 25 * 60000, left: 25 * 60000, end: 0, running: false, prevDnd: null, sessions: 0, day: new Date().toDateString() },
  timer: { dur: 5 * 60000, left: 5 * 60000, end: 0, running: false, label: 'Timer' },
  sw: { start: 0, acc: 0, running: false, laps: [] },
  t: 0,
  tickOn() { if (!this.t) this.t = setInterval(() => this.tick(), 250); },
  tick() {
    const now = Date.now(); let any = this.sw.running;
    for (const k of ['focus', 'timer']) {
      const x = this[k];
      if (!x.running) continue;
      x.left = Math.max(0, x.end - now);
      if (x.left <= 0) { x.running = false; x.left = 0; this.done(k); } else any = true;
    }
    bus.emit('clock');
    if (!any) { clearInterval(this.t); this.t = 0; }
  },
  start(k, ms) {
    const x = this[k];
    if (ms != null) { x.dur = ms; x.left = ms; }
    if (x.left <= 0) x.left = x.dur;
    x.end = Date.now() + x.left; x.running = true;
    if (k === 'focus' && S.data.focusDnd && x.prevDnd === null) { x.prevDnd = S.data.dnd; if (!S.data.dnd) S.set('dnd', true); }
    this.tickOn(); bus.emit('clock');
  },
  pause(k) { const x = this[k]; if (!x.running) return; x.left = Math.max(0, x.end - Date.now()); x.running = false; bus.emit('clock'); },
  reset(k) { const x = this[k]; x.running = false; x.left = x.dur; if (k === 'focus') this.restoreDnd(); bus.emit('clock'); },
  restoreDnd() { const f = this.focus; if (f.prevDnd !== null) { const p = f.prevDnd; f.prevDnd = null; if (S.data.dnd !== p) S.set('dnd', p); } },
  startFocus(min) { WM.open('clock', { tab: 'focus' }); this.start('focus', Math.round(min * 60000)); },
  startTimer(min, label) { this.timer.label = label || 'Timer'; this.start('timer', Math.round(min * 60000)); },
  done(k) {
    Sound.play('alarm');
    if (k === 'focus') {
      const f = this.focus; const today = new Date().toDateString();
      if (f.day !== today) { f.day = today; f.sessions = 0; }
      f.sessions++; f.left = f.dur; this.restoreDnd();
      Notif.push({ app: 'clock', title: 'Focus session complete', body: `Nice work. That was ${Math.round(f.dur / 60000)} minutes. Take a short break.`, action: () => WM.open('clock', { tab: 'focus' }), silent: true, actions: [{ label: 'Start another', primary: true, run: () => this.start('focus') }] });
    } else {
      this.timer.left = this.timer.dur;
      Notif.push({ app: 'clock', title: (this.timer.label || 'Timer') + ' is done', body: `${fmtDuration(this.timer.dur)} is up.`, action: () => WM.open('clock', { tab: 'timer' }), silent: true });
    }
  },
  swElapsed() { return this.sw.acc + (this.sw.running ? Date.now() - this.sw.start : 0); },
};

/* ========== Clock app ========== */
const ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'Pacific/Honolulu'];
const zoneCity = (z) => z.split('/').pop().replace(/_/g, ' ');
function zoneOffset(z) {
  const now = new Date();
  const parts = (tz) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(now); const g = (t) => +p.find((x) => x.type === t).value; return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')); };
  const diff = Math.round((parts(z) - parts(Intl.DateTimeFormat().resolvedOptions().timeZone)) / 60000);
  if (!diff) return 'Same time as you';
  const hrs = diff / 60; const abs = Math.abs(hrs);
  return `${hrs > 0 ? '+' : '−'}${Number.isInteger(abs) ? abs : abs.toFixed(1)} hr${abs === 1 ? '' : 's'}`;
}
function mountClock(root, api, args) {
  let tab = args.tab || 'focus';
  root.classList.add('app-clock');
  root.innerHTML = `<nav class="ck-tabs" role="tablist">${[['focus', 'target', 'Focus'], ['timer', 'timer', 'Timer'], ['stopwatch', 'clock', 'Stopwatch'], ['world', 'globe', 'World clock']].map(([k, ic, l]) => `<button role="tab" data-tab="${k}">${ui(ic)}<span>${l}</span></button>`).join('')}</nav><div class="ck-body"></div>`;
  const body = root.querySelector('.ck-body');
  const ring = (frac, big, small) => {
    const R = 92, C = 2 * Math.PI * R;
    return `<div class="ck-ring"><svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="${R}" class="trk"/><circle cx="110" cy="110" r="${R}" class="prg" style="stroke-dasharray:${C};stroke-dashoffset:${(C * (1 - clamp(frac, 0, 1))).toFixed(1)}"/></svg><div class="ck-ring-t"><div class="big num">${big}</div><div class="small muted">${small}</div></div></div>`;
  };
  function renderFocus() {
    const f = Clock.focus; const today = new Date().toDateString(); if (f.day !== today) { f.day = today; f.sessions = 0; }
    const label = f.running ? 'Stay with it' : f.left < f.dur ? 'Paused' : 'Ready when you are';
    body.innerHTML = `<div class="ck-pane">${ring(1 - f.left / f.dur, fmtDuration(f.left), label)}
      <div class="ck-presets" role="group" aria-label="Session length">${[15, 25, 45, 60].map((m) => `<button class="chip" data-min="${m}" aria-pressed="${f.dur === m * 60000}">${m} min</button>`).join('')}</div>
      <div class="ck-ctl"><button class="btn primary" data-act="toggle">${ui(f.running ? 'pause' : 'play')}${f.running ? 'Pause' : f.left < f.dur ? 'Resume' : 'Start focus'}</button><button class="btn" data-act="reset" ${f.left === f.dur && !f.running ? 'disabled' : ''}>${ui('restart')}Reset</button></div>
      <label class="ck-opt"><input type="checkbox" id="${api.id}-fdnd" ${S.data.focusDnd ? 'checked' : ''}> Turn on Focus mode (do not disturb) during sessions</label>
      <div class="muted ck-note">Sessions finished today: <b>${f.sessions}</b></div></div>`;
  }
  function renderTimer() {
    const t = Clock.timer; const idle = !t.running && t.left === t.dur;
    const mm = Math.floor(t.dur / 60000), ss = Math.round((t.dur % 60000) / 1000);
    body.innerHTML = `<div class="ck-pane">${ring(1 - t.left / t.dur, fmtDuration(t.left), t.running ? esc(t.label) : idle ? 'Set a time' : 'Paused')}
      <div class="ck-set" ${idle ? '' : 'hidden'}><label>Minutes <input type="number" class="field num" id="${api.id}-tm" min="0" max="600" value="${mm}"></label><label>Seconds <input type="number" class="field num" id="${api.id}-ts" min="0" max="59" value="${ss}"></label></div>
      <div class="ck-presets" role="group" aria-label="Quick times" ${idle ? '' : 'hidden'}>${[1, 5, 10, 15, 30].map((m) => `<button class="chip" data-tmin="${m}">${m} min</button>`).join('')}</div>
      <div class="ck-ctl"><button class="btn primary" data-act="ttoggle">${ui(t.running ? 'pause' : 'play')}${t.running ? 'Pause' : idle ? 'Start' : 'Resume'}</button><button class="btn" data-act="treset" ${idle ? 'disabled' : ''}>${ui('restart')}Reset</button></div></div>`;
  }
  function renderStopwatch() {
    const s = Clock.sw; const el = Clock.swElapsed();
    const fmt = (ms) => { const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10); return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };
    body.innerHTML = `<div class="ck-pane"><div class="ck-sw num">${fmt(el)}</div>
      <div class="ck-ctl"><button class="btn primary" data-act="swtoggle">${ui(s.running ? 'pause' : 'play')}${s.running ? 'Stop' : el ? 'Resume' : 'Start'}</button><button class="btn" data-act="lap" ${s.running ? '' : 'disabled'}>${ui('flag')}Lap</button><button class="btn" data-act="swreset" ${el && !s.running ? '' : 'disabled'}>${ui('restart')}Reset</button></div>
      <div class="ck-laps">${s.laps.map((l, i) => `<div class="ck-lap num"><span>Lap ${s.laps.length - i}</span><span>${fmt(l.split)}</span><span class="muted">${fmt(l.total)}</span></div>`).join('')}</div></div>`;
  }
  function renderWorld() {
    const list = S.data.worldClocks || [];
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const card = (z, isLocal) => `<div class="wc-card"><div><div class="wc-city">${esc(isLocal ? 'Your time' : zoneCity(z))}</div><div class="muted">${esc(isLocal ? zoneCity(z) : zoneOffset(z))} · ${esc(new Intl.DateTimeFormat(undefined, { timeZone: z, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date()))}</div></div><div class="wc-time num">${esc(new Intl.DateTimeFormat(undefined, { timeZone: z, hour: 'numeric', minute: '2-digit', hour12: S.data.clock24 == null ? undefined : !S.data.clock24 }).format(new Date()))}</div>${isLocal ? '' : `<button class="ibtn" data-rm="${esc(z)}" aria-label="Remove ${esc(zoneCity(z))}">${ui('x')}</button>`}</div>`;
    const avail = ZONES.filter((z) => !list.includes(z) && z !== local);
    body.innerHTML = `<div class="ck-pane wide">${card(local, true)}${list.map((z) => card(z, false)).join('')}
      <div class="wc-add"><select class="field" id="${api.id}-zone" aria-label="Add a city"><option value="">Add a city…</option>${avail.map((z) => `<option value="${esc(z)}">${esc(zoneCity(z))}</option>`).join('')}</select></div></div>`;
  }
  function render() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    const x = tab === 'focus' ? Clock.focus : tab === 'timer' ? Clock.timer : null;
    body.dataset.state = x ? `${x.running}-${x.left === x.dur}` : '';
    ({ focus: renderFocus, timer: renderTimer, stopwatch: renderStopwatch, world: renderWorld })[tab]();
  }
  function readTimer() { const m = +(root.querySelector(`#${api.id}-tm`)?.value || 0), s = +(root.querySelector(`#${api.id}-ts`)?.value || 0); return clamp(m, 0, 600) * 60000 + clamp(s, 0, 59) * 1000; }
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); return; }
    const m = e.target.closest('[data-min]'); if (m) { if (!Clock.focus.running) { Clock.focus.dur = Clock.focus.left = +m.dataset.min * 60000; render(); } return; }
    const tm = e.target.closest('[data-tmin]'); if (tm) { Clock.startTimer(+tm.dataset.tmin); render(); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { S.set('worldClocks', (S.data.worldClocks || []).filter((z) => z !== rm.dataset.rm)); render(); return; }
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    const f = Clock.focus, tt = Clock.timer, s = Clock.sw;
    if (a === 'toggle') f.running ? Clock.pause('focus') : Clock.start('focus');
    else if (a === 'reset') Clock.reset('focus');
    else if (a === 'ttoggle') { if (tt.running) Clock.pause('timer'); else if (tt.left === tt.dur) { const ms = readTimer(); if (ms >= 1000) Clock.startTimer(ms / 60000); } else Clock.start('timer'); }
    else if (a === 'treset') Clock.reset('timer');
    else if (a === 'swtoggle') { if (s.running) { s.acc += Date.now() - s.start; s.running = false; } else { s.start = Date.now(); s.running = true; Clock.tickOn(); } }
    else if (a === 'lap') { const total = Clock.swElapsed(); const prev = s.laps[0]?.total || 0; s.laps.unshift({ split: total - prev, total }); }
    else if (a === 'swreset') { s.acc = 0; s.laps = []; }
    render();
  });
  root.addEventListener('change', (e) => {
    if (e.target.id === `${api.id}-fdnd`) S.set('focusDnd', e.target.checked);
    if (e.target.id === `${api.id}-zone` && e.target.value) { S.set('worldClocks', [...(S.data.worldClocks || []), e.target.value]); render(); }
  });
  api.on('clock', () => {
    if (tab === 'stopwatch') { const el = body.querySelector('.ck-sw'); if (el) { const ms = Clock.swElapsed(); const m = Math.floor(ms / 60000), sec = Math.floor((ms % 60000) / 1000), cs = Math.floor((ms % 1000) / 10); el.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; } return; }
    if (tab === 'focus' || tab === 'timer') {
      const x = tab === 'focus' ? Clock.focus : Clock.timer;
      const big = body.querySelector('.ck-ring .big'), prg = body.querySelector('.ck-ring .prg');
      const key = `${x.running}-${x.left === x.dur}`;
      if (big && prg && x.running && body.dataset.state === key) { big.textContent = fmtDuration(x.left); const C = 2 * Math.PI * 92; prg.style.strokeDashoffset = (C * (x.left / x.dur)).toFixed(1); }
      else if (body.dataset.state !== key) render();
    }
  });
  api.every(1000, () => { if (tab === 'world' && document.activeElement?.tagName !== 'SELECT') renderWorld(); });
  api.onArgs = (a) => { if (a.tab) { tab = a.tab; render(); } };
  render();
}
