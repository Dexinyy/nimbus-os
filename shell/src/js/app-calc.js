/* ========== Calculator ========== */
function mountCalc(root, api) {
  const st = { cur: '0', prev: null, op: null, fresh: true, err: '', expr: '', repeat: null, history: [] };
  root.classList.add('app-calc');
  const KEYS = [
    ['%', 'pct', 'fn'], ['CE', 'ce', 'fn'], ['C', 'clear', 'fn'], ['⌫', 'back', 'fn', 'Backspace'],
    ['¹⁄ₓ', 'inv', 'fn', 'Reciprocal'], ['x²', 'sq', 'fn', 'Square'], ['√x', 'sqrt', 'fn', 'Square root'], ['÷', '/', 'op', 'Divide'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['×', '*', 'op', 'Multiply'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['−', '-', 'op', 'Subtract'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'op', 'Add'],
    ['±', 'neg', 'fn', 'Change sign'], ['0', '0'], ['.', '.', '', 'Decimal point'], ['=', 'eq', 'eq', 'Equals'],
  ];
  root.innerHTML = `
    <div class="calc-main">
      <div class="calc-mode"><b>Standard</b><span class="grow"></span><button class="ibtn calc-histbtn" aria-label="History" data-tip="History">${ui('clock')}</button></div>
      <div class="calc-disp"><div class="calc-expr num" aria-live="polite"></div><div class="calc-val num" aria-live="polite">0</div></div>
      <div class="calc-keys">${KEYS.map(([l, k, c = 'num', a]) => `<button class="ck ${c}" data-k="${k}" aria-label="${a || l}">${l}</button>`).join('')}</div>
    </div>
    <aside class="calc-hist" aria-label="History"><div class="calc-hhead"><b>History</b><button class="ibtn" data-act="clearhist" aria-label="Clear history" data-tip="Clear history">${ui('trash')}</button></div><div class="calc-hlist"></div></aside>`;
  const val = root.querySelector('.calc-val'), exprEl = root.querySelector('.calc-expr'), hist = root.querySelector('.calc-hlist');
  const OPS = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  const num = () => parseFloat(st.cur);
  const fmtIn = (s) => { if (st.err) return st.err; const neg = s.startsWith('-'); const [i, d] = (neg ? s.slice(1) : s).split('.'); const g = Number(i || '0').toLocaleString('en-US'); return (neg ? '-' : '') + g + (d !== undefined ? '.' + d : ''); };
  const out = (v) => { const r = parseFloat(Number(v).toPrecision(15)); if (!isFinite(r)) return 'Error'; if (Math.abs(r) >= 1e16 || (r !== 0 && Math.abs(r) < 1e-12)) return r.toExponential(10).replace(/\.?0+e/, 'e'); return String(r); };
  function calc(a, op, b) {
    if (op === '+') return a + b; if (op === '-') return a - b; if (op === '*') return a * b;
    if (op === '/') { if (b === 0) throw new Error(a === 0 ? 'Result is undefined' : 'Cannot divide by zero'); return a / b; }
    return b;
  }
  function render() {
    val.textContent = fmtIn(st.cur);
    const len = val.textContent.length; val.style.fontSize = len > 16 ? '26px' : len > 12 ? '34px' : len > 9 ? '40px' : '48px';
    exprEl.textContent = st.expr;
    hist.innerHTML = '';
    if (!st.history.length) hist.append(h('div', { class: 'muted calc-empty', text: 'There is no history yet.' }));
    for (const it of st.history) { const b = h('button', { class: 'calc-hitem', html: `<span class="e">${esc(it.e)}</span><span class="r">${esc(fmtIn(it.r))}</span>` }); b.onclick = () => { st.cur = it.r; st.fresh = true; st.err = ''; render(); }; hist.append(b); }
  }
  function fail(msg) { st.err = msg; st.cur = '0'; st.prev = null; st.op = null; st.fresh = true; st.expr = ''; Sound.play('error'); }
  function press(k) {
    if (st.err && !['clear', 'ce'].includes(k) && !/^[\d.]$/.test(k)) return;
    if (st.err) { st.err = ''; if (!/^[\d.]$/.test(k)) { st.cur = '0'; render(); return; } }
    try {
      if (/^\d$/.test(k)) {
        if (st.fresh) { st.cur = k; st.fresh = false; if (!st.op) st.expr = ''; }
        else if (st.cur.replace(/[-.]/g, '').length < 16) st.cur = st.cur === '0' ? k : st.cur === '-0' ? '-' + k : st.cur + k;
      } else if (k === '.') {
        if (st.fresh) { st.cur = '0.'; st.fresh = false; if (!st.op) st.expr = ''; }
        else if (!st.cur.includes('.')) st.cur += '.';
      } else if (OPS[k]) {
        if (st.op && !st.fresh) { const r = calc(st.prev, st.op, num()); st.prev = r; st.cur = out(r); }
        else if (!st.op) st.prev = num();
        st.op = k; st.fresh = true; st.repeat = null;
        st.expr = `${fmtIn(out(st.prev))} ${OPS[k]}`;
      } else if (k === 'eq') {
        let a, b, op;
        if (st.op) { a = st.prev; b = num(); op = st.op; }
        else if (st.repeat) { a = num(); ({ op, b } = st.repeat); }
        else { st.expr = `${fmtIn(st.cur)} =`; render(); return; }
        const r = calc(a, op, b);
        const e = `${fmtIn(out(a))} ${OPS[op]} ${fmtIn(out(b))} =`;
        st.expr = e; st.cur = out(r); st.prev = null; st.op = null; st.fresh = true; st.repeat = { op, b };
        st.history.unshift({ e, r: st.cur }); st.history = st.history.slice(0, 30);
      } else if (k === 'clear') { Object.assign(st, { cur: '0', prev: null, op: null, fresh: true, expr: '', repeat: null, err: '' }); }
      else if (k === 'ce') { st.cur = '0'; st.fresh = true; }
      else if (k === 'back') { if (!st.fresh) { st.cur = st.cur.length > 1 && st.cur !== '-0' ? st.cur.slice(0, -1) : '0'; if (st.cur === '-') st.cur = '0'; } else if (!st.op) st.expr = ''; }
      else if (k === 'neg') { st.cur = st.cur.startsWith('-') ? st.cur.slice(1) : st.cur === '0' ? '0' : '-' + st.cur; }
      else if (k === 'pct') { const v = st.op === '+' || st.op === '-' ? (st.prev * num()) / 100 : num() / 100; st.cur = out(v); st.fresh = true; }
      else if (k === 'inv' || k === 'sq' || k === 'sqrt') {
        const x = num();
        if (k === 'inv' && x === 0) throw new Error('Cannot divide by zero');
        if (k === 'sqrt' && x < 0) throw new Error('Invalid input');
        const r = k === 'inv' ? 1 / x : k === 'sq' ? x * x : Math.sqrt(x);
        const label = k === 'inv' ? `1/(${fmtIn(st.cur)})` : k === 'sq' ? `sqr(${fmtIn(st.cur)})` : `√(${fmtIn(st.cur)})`;
        st.expr = st.op ? `${fmtIn(out(st.prev))} ${OPS[st.op]} ${label}` : label;
        st.cur = out(r); st.fresh = true;
      }
    } catch (e) { fail(e.message || 'Error'); }
    render();
  }
  root.querySelector('.calc-keys').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  root.querySelector('[data-act="clearhist"]').addEventListener('click', () => { st.history = []; render(); });
  root.querySelector('.calc-histbtn').addEventListener('click', () => root.classList.toggle('show-hist'));
  root.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { copyText(st.cur); } return; }
    const map = { Enter: 'eq', '=': 'eq', Backspace: 'back', Escape: 'clear', Delete: 'ce', '%': 'pct', '+': '+', '-': '-', '*': '*', x: '*', X: '*', '/': '/', '.': '.', ',': '.', r: 'inv', q: 'sq', '@': 'sqrt', F9: 'neg' };
    const k = /^\d$/.test(e.key) ? e.key : map[e.key];
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    press(k);
    const b = root.querySelector(`[data-k="${CSS.escape(k)}"]`); if (b) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120); }
  });
  const ro = new ResizeObserver(() => root.classList.toggle('wide', root.clientWidth >= 560));
  ro.observe(root); api.onClose(() => ro.disconnect());
  render();
}
