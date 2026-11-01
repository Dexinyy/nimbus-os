/* ========== Task Manager ========== */
function mountTaskmgr(root, api) {
  let tab = 'processes', selId = null;
  const N = 60;
  const series = { fps: [], lag: [], mem: [], dom: [] };
  root.classList.add('app-taskmgr');
  root.innerHTML = `
    <div class="tm-tabs" role="tablist"><button role="tab" data-tab="processes">${ui('apps')}<span>Processes</span></button><button role="tab" data-tab="performance">${ui('activity')}<span>Performance</span></button><span class="grow"></span><button class="btn sm" data-act="end" disabled>End task</button></div>
    <div class="tm-body"></div>`;
  const body = root.querySelector('.tm-body'), endBtn = root.querySelector('[data-act="end"]');
  const hasMem = !!(performance && performance.memory);
  // live measurements: frame rate and how late timers fire (main-thread responsiveness)
  let frames = 0, raf = 0, lagMax = 0, lastTick = performance.now();
  const loop = () => { frames++; raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  const lagT = setInterval(() => { const now = performance.now(); lagMax = Math.max(lagMax, now - lastTick - 100); lastTick = now; }, 100);
  api.onClose(() => { cancelAnimationFrame(raf); clearInterval(lagT); });
  function sample() {
    const push = (k, v) => { series[k].push(v); if (series[k].length > N) series[k].shift(); };
    push('fps', frames); frames = 0;
    push('lag', Math.max(0, Math.round(lagMax))); lagMax = 0;
    push('mem', hasMem ? performance.memory.usedJSHeapSize / 1048576 : 0);
    push('dom', document.getElementsByTagName('*').length);
  }
  function procRows() {
    const rows = WM.list().map((w) => ({ id: w.id, icon: w.app.icon, name: w.title, status: w.min ? 'Minimized' : w.id === WM.activeId() ? 'Active' : 'Running', els: w.el.getElementsByTagName('*').length, up: Date.now() - w.created, app: true }));
    const shell = document.getElementById('taskbar').getElementsByTagName('*').length + document.getElementById('desktop').getElementsByTagName('*').length;
    const bg = [{ id: 'shell', icon: 'logo', name: 'Desktop and taskbar', status: 'Running', els: shell, up: Date.now() - BOOT_TIME }];
    const c = Store.cloudLabel();
    bg.push({ id: 'sync', icon: 'settings', name: 'Sync service', status: Store.status.cloud === 'on' ? 'Connected' : c.title, els: 0, up: Date.now() - BOOT_TIME });
    if (Clock.focus.running || Clock.timer.running || Clock.sw.running) bg.push({ id: 'clock', icon: 'clock', name: 'Clock timers', status: 'Running', els: 0, up: 0 });
    return { rows, bg };
  }
  function renderProcesses() {
    const { rows, bg } = procRows();
    if (selId && !rows.some((r) => r.id === selId)) selId = null;
    endBtn.disabled = !selId;
    const tr = (r) => `<div class="tm-row${r.id === selId ? ' sel' : ''}${r.app ? '' : ' bg'}" data-id="${r.id}" role="row"><span class="c-name"><span class="ic">${appIcon(r.icon)}</span><span class="nm">${esc(r.name)}</span></span><span class="c-st">${esc(r.status)}</span><span class="c-num num">${r.els ? r.els.toLocaleString() : '–'}</span><span class="c-num num">${r.up ? fmtDuration(r.up) : '–'}</span></div>`;
    body.innerHTML = `<div class="tm-table" role="table"><div class="tm-row head" role="row"><span class="c-name">Name</span><span class="c-st">Status</span><span class="c-num">Elements</span><span class="c-num">Uptime</span></div>
      <div class="tm-group">Apps (${rows.length})</div>${rows.map(tr).join('') || '<div class="tm-empty muted">No apps are open.</div>'}
      <div class="tm-group">Background (${bg.length})</div>${bg.map(tr).join('')}</div>`;
  }
  function spark(canvas, data, max, color) {
    const dpr = Math.min(2, window.devicePixelRatio || 1); const w = canvas.clientWidth, hh = canvas.clientHeight; if (!w || !hh) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); }
    const c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hh);
    const css = getComputedStyle(root); const line = css.getPropertyValue('--line').trim() || 'rgba(0,0,0,.1)';
    c.strokeStyle = line; c.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = Math.round((hh * i) / 4) + 0.5; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    if (data.length < 2) return;
    const step = w / (N - 1); const off = N - data.length;
    const pts = data.map((v, i) => [(off + i) * step, hh - 2 - (clamp(v, 0, max) / max) * (hh - 6)]);
    const g = c.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, color + '55'); g.addColorStop(1, color + '05');
    c.beginPath(); c.moveTo(pts[0][0], hh); pts.forEach(([x, y]) => c.lineTo(x, y)); c.lineTo(pts[pts.length - 1][0], hh); c.closePath(); c.fillStyle = g; c.fill();
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.strokeStyle = color; c.lineWidth = 2; c.lineJoin = 'round'; c.stroke();
    const [lx, ly] = pts[pts.length - 1]; c.beginPath(); c.arc(lx - 1, ly, 3.5, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  }
  const CARDS = () => [
    { k: 'fps', t: 'Frame rate', unit: 'fps', fmt: (v) => Math.round(v), max: () => 75, desc: 'How smoothly the screen updates' },
    { k: 'lag', t: 'Responsiveness', unit: 'ms delay', fmt: (v) => Math.round(v), max: () => Math.max(50, ...series.lag) , desc: 'Longest wait for the main thread in the last second' },
    hasMem ? { k: 'mem', t: 'JavaScript memory', unit: 'MB', fmt: (v) => v.toFixed(1), max: () => Math.max(32, ...series.mem) * 1.2, desc: 'Memory used by this page' } : null,
    { k: 'dom', t: 'Page elements', unit: 'elements', fmt: (v) => Math.round(v).toLocaleString(), max: () => Math.max(500, ...series.dom) * 1.2, desc: 'Everything drawn on screen right now' },
  ].filter(Boolean);
  function renderPerformance() {
    endBtn.disabled = true;
    const u = FS.usage();
    body.innerHTML = `<div class="tm-perf">${CARDS().map((c) => `<div class="tm-card" data-k="${c.k}"><div class="tm-ct">${esc(c.t)}</div><div class="tm-big"><span class="v num">–</span> <span class="u">${esc(c.unit)}</span></div><canvas aria-hidden="true"></canvas><div class="tm-cd muted">${esc(c.desc)}</div></div>`).join('')}
      <div class="tm-card stat"><div class="tm-ct">Storage</div><div class="tm-big"><span class="num">${fmtBytes(u.bytes)}</span></div><div class="tm-cd muted">${u.files} files, ${u.folders} folders · ${esc(Store.cloudLabel().title)}</div></div>
      <div class="tm-card stat"><div class="tm-ct">Up time</div><div class="tm-big"><span class="num tm-up">${fmtDuration(Date.now() - BOOT_TIME)}</span></div><div class="tm-cd muted">${navigator.hardwareConcurrency || '?'} logical cores · ${esc(browserName())}</div></div></div>`;
    updatePerf();
  }
  function updatePerf() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4a74f5';
    const colors = { fps: accent, lag: '#e2671d', mem: '#14a3a3', dom: '#9b5de5' };
    for (const c of CARDS()) {
      const card = body.querySelector(`.tm-card[data-k="${c.k}"]`); if (!card) continue;
      const d = series[c.k]; card.querySelector('.v').textContent = d.length ? c.fmt(d[d.length - 1]) : '–';
      spark(card.querySelector('canvas'), d, c.max(), /^#[0-9a-f]{6}$/i.test(colors[c.k]) ? colors[c.k] : '#4a74f5');
    }
    const up = body.querySelector('.tm-up'); if (up) up.textContent = fmtDuration(Date.now() - BOOT_TIME);
  }
  function render() {
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    endBtn.hidden = tab !== 'processes';
    if (tab === 'processes') renderProcesses(); else renderPerformance();
  }
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); return; }
    if (e.target.closest('[data-act="end"]')) { const w = WM.get(selId); if (w && w.id !== api.id) WM.close(w, true); else if (w) api.close(true); selId = null; render(); return; }
    const r = e.target.closest('.tm-row[data-id]'); if (r && !r.classList.contains('bg')) { selId = r.dataset.id; render(); }
  });
  root.addEventListener('dblclick', (e) => { const r = e.target.closest('.tm-row[data-id]'); if (r && !r.classList.contains('bg')) { const w = WM.get(r.dataset.id); if (w) WM.focus(w); } });
  root.addEventListener('keydown', (e) => { if (e.key === 'Delete' && selId) { const w = WM.get(selId); if (w) WM.close(w, true); } });
  api.every(1000, () => { sample(); if (tab === 'processes') renderProcesses(); else updatePerf(); });
  api.on('wm', () => { if (tab === 'processes') renderProcesses(); });
  render();
}
