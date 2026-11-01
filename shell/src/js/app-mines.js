/* ========== Mines ========== */
function mountMines(root, api) {
  const LEVELS = { easy: [9, 9, 10, 'Easy'], medium: [16, 16, 40, 'Medium'], hard: [30, 16, 99, 'Hard'] };
  const CELL = 28;
  let level = 'easy', cols, rows, mines, cells, state, flags, opened, t0, tEnd = 0, timer = 0, pressT = 0;
  root.classList.add('app-mines');
  const face = (mood) => {
    const eyes = mood === 'dead' ? '<path d="M8 9l3 3M11 9l-3 3M17 9l3 3M20 9l-3 3"/>' : mood === 'cool' ? '<path d="M6.5 9.5h15" stroke-width="1.6"/><rect x="7" y="9" width="5.5" height="3.6" rx="1.5" fill="currentColor"/><rect x="15.5" y="9" width="5.5" height="3.6" rx="1.5" fill="currentColor"/>' : '<circle cx="10" cy="11" r="1.4" fill="currentColor"/><circle cx="18" cy="11" r="1.4" fill="currentColor"/>';
    const mouth = mood === 'wow' ? '<circle cx="14" cy="18" r="2.4"/>' : mood === 'dead' ? '<path d="M10 19.5q4-3 8 0"/>' : '<path d="M9.5 16.5q4.5 4 9 0"/>';
    return `<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="14" cy="14" r="11.5" fill="#ffd54a" stroke="#c99a12"/>${eyes}${mouth}</svg>`;
  };
  root.innerHTML = `
    <div class="mn-top"><div class="mn-lcd num" aria-label="Mines left">010</div><button class="mn-face" aria-label="New game">${face('smile')}</button><div class="mn-lcd num mn-time" aria-label="Seconds">000</div></div>
    <div class="mn-board" role="grid" aria-label="Mine field"></div>
    <div class="mn-foot"><div class="seg" role="group" aria-label="Difficulty">${Object.entries(LEVELS).map(([k, v]) => `<button data-level="${k}" aria-pressed="${k === level}">${v[3]}</button>`).join('')}</div><span class="mn-best muted"></span></div>`;
  const board = root.querySelector('.mn-board'), faceBtn = root.querySelector('.mn-face');
  const lcd = (n) => String(clamp(n, -99, 999)).padStart(3, '0');
  const idx = (x, y) => y * cols + x;
  const around = (i) => { const x = i % cols, y = Math.floor(i / cols), out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out.push(idx(nx, ny)); } return out; };
  function size() { api.resizeTo(Math.max(340, cols * CELL + 40), rows * CELL + 40 + 66 + 84); }
  function newGame(lv) {
    if (lv) level = lv;
    [cols, rows, mines] = LEVELS[level];
    cells = Array.from({ length: cols * rows }, () => ({ mine: false, n: 0, open: false, flag: false }));
    state = 'ready'; flags = 0; opened = 0; clearInterval(timer); timer = 0; t0 = 0;
    board.style.gridTemplateColumns = `repeat(${cols}, ${CELL}px)`;
    board.innerHTML = '';
    for (let i = 0; i < cells.length; i++) board.append(h('button', { class: 'mc', 'data-i': i, 'aria-label': `Row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}, hidden` }));
    root.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === level)));
    const best = S.data.minesBest?.[level];
    root.querySelector('.mn-best').textContent = best ? `Best: ${best} s` : 'No best time yet';
    faceBtn.innerHTML = face('smile');
    update(); size();
  }
  function plant(safe) {
    const banned = new Set([safe, ...around(safe)]); let placed = 0;
    while (placed < mines) { const i = Math.floor(Math.random() * cells.length); if (cells[i].mine || banned.has(i)) continue; cells[i].mine = true; placed++; }
    cells.forEach((c, i) => { c.n = around(i).filter((j) => cells[j].mine).length; });
  }
  function reveal(i) {
    const c = cells[i]; if (c.open || c.flag) return;
    if (state === 'ready') { plant(i); state = 'play'; t0 = Date.now(); timer = setInterval(update, 500); }
    if (c.mine) { c.open = true; c.boom = true; lose(); return; }
    const stack = [i];
    while (stack.length) { const k = stack.pop(); const x = cells[k]; if (x.open || x.flag) continue; x.open = true; opened++; if (x.n === 0) for (const j of around(k)) if (!cells[j].open && !cells[j].mine) stack.push(j); }
    if (opened === cells.length - mines) win();
  }
  function chord(i) {
    const c = cells[i]; if (!c.open || !c.n) return;
    const nb = around(i); if (nb.filter((j) => cells[j].flag).length !== c.n) return;
    for (const j of nb) { if (state !== 'play') break; if (!cells[j].flag && !cells[j].open) reveal(j); }
  }
  function lose() { state = 'lost'; tEnd = Date.now(); clearInterval(timer); cells.forEach((c) => { if (c.mine && !c.flag) c.open = true; if (c.flag && !c.mine) c.wrong = true; }); faceBtn.innerHTML = face('dead'); Sound.play('error'); }
  function win() {
    state = 'won'; tEnd = Date.now(); clearInterval(timer); cells.forEach((c) => { if (c.mine) c.flag = true; }); flags = mines; faceBtn.innerHTML = face('cool');
    const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
    const best = S.data.minesBest?.[level]; const rec = !best || secs < best;
    if (rec) S.set('minesBest', { ...(S.data.minesBest || {}), [level]: secs });
    root.querySelector('.mn-best').textContent = `Best: ${rec ? secs : best} s`;
    Notif.push({ app: 'mines', title: rec ? 'New best time!' : 'Field cleared', body: `You cleared ${LEVELS[level][3]} in ${secs} seconds.` });
  }
  function update() {
    root.querySelector('.mn-lcd').textContent = lcd(mines - flags);
    root.querySelector('.mn-time').textContent = lcd(state === 'play' ? Math.floor((Date.now() - t0) / 1000) : over() && t0 ? Math.floor((tEnd - t0) / 1000) : 0);
    const btns = board.children;
    cells.forEach((c, i) => {
      const b = btns[i]; let cls = 'mc', txt = '', label = 'hidden';
      if (c.open) { cls += ' open'; if (c.mine) { cls += c.boom ? ' boom' : ' mine'; label = 'mine'; } else if (c.n) { cls += ' n' + c.n; txt = c.n; label = c.n + ' nearby'; } else label = 'empty'; }
      else if (c.flag) { cls += c.wrong ? ' wrong' : ' flag'; label = 'flagged'; }
      if (b.className !== cls) b.className = cls;
      if (b.textContent !== String(txt)) b.textContent = txt;
      b.setAttribute('aria-label', `Row ${Math.floor(i / cols) + 1}, column ${(i % cols) + 1}, ${label}`);
    });
  }
  const over = () => state === 'won' || state === 'lost';
  board.addEventListener('click', (e) => { const b = e.target.closest('.mc'); if (!b || over() || b.dataset.long) { delete b?.dataset.long; return; } const i = +b.dataset.i; if (cells[i].open) chord(i); else reveal(i); update(); });
  board.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); const b = e.target.closest('.mc'); if (!b || over()) return; toggleFlag(+b.dataset.i); });
  board.addEventListener('auxclick', (e) => { if (e.button === 1) { const b = e.target.closest('.mc'); if (b && !over()) { chord(+b.dataset.i); update(); } } });
  function toggleFlag(i) { const c = cells[i]; if (c.open) return; c.flag = !c.flag; flags += c.flag ? 1 : -1; update(); }
  board.addEventListener('pointerdown', (e) => {
    if (over()) return;
    if (e.button === 0) faceBtn.innerHTML = face('wow');
    if (e.pointerType === 'touch') { const b = e.target.closest('.mc'); if (!b) return; clearTimeout(pressT); pressT = setTimeout(() => { b.dataset.long = '1'; toggleFlag(+b.dataset.i); }, 420); }
  });
  const relax = () => { clearTimeout(pressT); if (!over()) faceBtn.innerHTML = face('smile'); };
  board.addEventListener('pointerup', relax); board.addEventListener('pointerleave', relax); board.addEventListener('pointercancel', relax);
  faceBtn.addEventListener('click', () => newGame());
  root.querySelector('.mn-foot').addEventListener('click', (e) => { const b = e.target.closest('[data-level]'); if (b) newGame(b.dataset.level); });
  root.addEventListener('keydown', (e) => { if (e.key === 'F2' || (e.key.toLowerCase() === 'n' && !e.ctrlKey)) { e.preventDefault(); newGame(); } });
  api.onClose(() => clearInterval(timer));
  newGame();
}
