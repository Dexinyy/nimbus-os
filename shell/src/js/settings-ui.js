/* ========== Settings building blocks, drawn like Windows 11's ==========
   Cards with an icon, a title, a description and a control on the right; groups of cards under a
   header; expanders; toggle switches with their On/Off label; combo boxes; sliders; info bars.
   Pages (settings-*.js) are made of these. A "ctx" ties live controls to the page that shows them:
   ctx.sync(fn) runs fn whenever settings or system state change, ctx.go(page) navigates. */
const WS = (() => {
  const ic = (name) => (name ? `<span class="ws-ic">${FLUENT[name] ? fi(name) : ui(name)}</span>` : '');

  /* A setting card. ctl: a control element (or a function(ctx) returning one); go: page to open; onClick */
  function card(ctx, { icon, iconHtml, title, desc, ctl, go, onClick, sid, cls, disabled, badge }) {
    const clickable = !!(go || onClick);
    // Clickable cards are divs acting as buttons: some also hold a switch, and buttons can't hold buttons
    const el = h('div', { class: 'ws-card' + (clickable ? ' ws-link' : '') + (cls ? ' ' + cls : '') + (disabled ? ' disabled' : ''), 'data-sid': sid || null,
      role: clickable ? 'button' : null, tabindex: clickable && !disabled ? '0' : null, 'aria-disabled': clickable && disabled ? 'true' : null });
    if (clickable) el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); } });
    const text = h('div', { class: 'ws-txt' }, h('div', { class: 'ws-t' }, typeof title === 'string' ? document.createTextNode(title) : title, badge ? h('span', { class: 'ws-badge', text: badge }) : null),
      desc ? h('div', { class: 'ws-d' }, typeof desc === 'string' ? document.createTextNode(desc) : desc) : null);
    el.append(frag(`<span class="ws-icw">${iconHtml || ic(icon)}</span>`) || h('span'), text);
    if (!icon && !iconHtml) el.firstChild.remove();
    const right = h('div', { class: 'ws-ctl' + (!title && !go ? ' start' : '') });
    if (ctl) right.append(typeof ctl === 'function' ? ctl(ctx) : ctl);
    if (go) right.append(frag(`<span class="ws-chev">${fi('chevronRight')}</span>`));
    if (!title && !desc) text.remove();
    if (ctl || go) el.append(right);
    const own = (e) => disabled || e.target.closest('.ws-ctl button, .ws-ctl input, .ws-combo, .ws-toggle-wrap');
    if (go) el.addEventListener('click', (e) => { if (!own(e)) ctx.go(go); });
    else if (onClick) el.addEventListener('click', (e) => { if (!own(e)) onClick(e); });
    return el;
  }
  const group = (title, ...cards) => h('section', { class: 'ws-group' }, title ? h('h3', { class: 'ws-gh', text: title }) : null, ...cards.flat().filter(Boolean));

  /* A card that opens to show more rows (Windows' expander). items: rows made with sub() or any element */
  function expander(ctx, { icon, title, desc, ctl, sid, open = false, items, onToggle }) {
    const wrap = h('div', { class: 'ws-exp' + (open ? ' open' : ''), 'data-sid': sid || null });
    const head = h('div', { class: 'ws-card ws-exp-head', role: 'button', tabindex: '0', 'aria-expanded': String(open) });
    head.append(frag(`<span class="ws-icw">${ic(icon)}</span>`), h('div', { class: 'ws-txt' }, h('div', { class: 'ws-t', text: title }), desc ? h('div', { class: 'ws-d' }, typeof desc === 'string' ? document.createTextNode(desc) : desc) : null));
    if (!icon) head.firstChild.remove();
    const right = h('div', { class: 'ws-ctl' });
    if (ctl) right.append(typeof ctl === 'function' ? ctl(ctx) : ctl);
    right.append(frag(`<span class="ws-chev ws-exp-chev">${fi('chevronDown')}</span>`));
    head.append(right);
    const body = h('div', { class: 'ws-exp-body' });
    let filled = false;
    const fill = () => { if (filled) return; filled = true; const list = typeof items === 'function' ? items() : items; body.append(...(list || []).flat().filter(Boolean)); };
    if (open) fill();
    const toggle = () => { const o = !wrap.classList.contains('open'); if (o) fill(); wrap.classList.toggle('open', o); head.setAttribute('aria-expanded', String(o)); onToggle?.(o); };
    head.addEventListener('click', (e) => { if (e.target.closest('.ws-ctl button:not(.ws-exp-chev), .ws-ctl input, .ws-combo, .ws-toggle')) return; toggle(); });
    head.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === head) { e.preventDefault(); toggle(); } });
    wrap.append(head, body);
    return wrap;
  }
  /* A row inside an expander */
  function sub({ title, desc, ctl, sid, cls }) {
    const text = title || desc ? h('div', { class: 'ws-txt' }, title ? h('div', { class: 'ws-t' }, typeof title === 'string' ? document.createTextNode(title) : title) : null, desc ? h('div', { class: 'ws-d' }, typeof desc === 'string' ? document.createTextNode(desc) : desc) : null) : null;
    // a row with only a control (a check box) starts at the left, like Windows'
    return h('div', { class: 'ws-sub' + (cls ? ' ' + cls : ''), 'data-sid': sid || null }, text, ctl ? h('div', { class: 'ws-ctl' + (text ? '' : ' start') }, ctl) : null);
  }

  /* Toggle switch with its On/Off label to the left, as in Windows */
  function toggle(ctx, get, set, label, { onText = 'On', offText = 'Off', disabled } = {}) {
    const b = h('button', { class: 'ws-toggle', role: 'switch', 'aria-label': label });
    const txt = h('span', { class: 'ws-toggle-t' });
    const wrap = h('label', { class: 'ws-toggle-wrap' }, txt, b);
    const paint = () => { const on = !!get(); b.setAttribute('aria-checked', String(on)); txt.textContent = on ? onText : offText; b.disabled = typeof disabled === 'function' ? !!disabled() : !!disabled; wrap.classList.toggle('disabled', b.disabled); };
    b.addEventListener('click', (e) => { e.stopPropagation(); if (b.disabled) return; const v = !get(); Promise.resolve(set(v)).finally(paint); paint(); });
    ctx.sync(paint); paint();
    return wrap;
  }
  const settingToggle = (ctx, key, label, opts) => toggle(ctx, () => !!S.data[key], (v) => S.set(key, v), label, opts);

  /* Combo box: a button showing the choice; its list opens over it with the chosen item where the button is */
  function combo(ctx, options, get, set, label, { width, disabled } = {}) {
    const opts = () => (typeof options === 'function' ? options() : options);
    const btn = h('button', { class: 'ws-combo', 'aria-haspopup': 'listbox', 'aria-label': label, style: width ? { minWidth: width + 'px' } : null });
    const txt = h('span', { class: 'ws-combo-t' });
    btn.append(txt, frag(`<span class="ws-combo-chev">${fi('chevronDown')}</span>`));
    const paint = () => { const v = get(); const o = opts().find((x) => String(x[0]) === String(v)); txt.textContent = o ? o[1] : (v == null ? '' : String(v)); btn.disabled = typeof disabled === 'function' ? !!disabled() : !!disabled; };
    btn.addEventListener('click', (e) => { e.stopPropagation(); openList(btn, opts(), get(), (v) => { Promise.resolve(set(v)).finally(paint); paint(); }); });
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault(); const list = opts(); const i = list.findIndex((x) => String(x[0]) === String(get()));
      const n = list[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, list.length - 1)]; if (n && !n[2]) { Promise.resolve(set(n[0])).finally(paint); paint(); }
    });
    ctx.sync(paint); paint();
    return btn;
  }
  const settingCombo = (ctx, key, options, label, o) => combo(ctx, options, () => S.data[key], (v) => S.set(key, v), label, o);
  let openPop = null;
  function closeList() { if (openPop) { openPop.remove(); openPop = null; } }
  function openList(anchor, options, value, pick) {
    closeList();
    const os = document.getElementById('os');
    const pop = h('div', { class: 'ws-pop', role: 'listbox' });
    let sel = Math.max(0, options.findIndex((x) => String(x[0]) === String(value)));
    const items = options.map(([v, l, dis], i) => {
      const it = h('div', { class: 'ws-pop-it' + (i === sel ? ' sel' : '') + (dis ? ' disabled' : ''), role: 'option', 'aria-selected': String(i === sel), text: l });
      it.addEventListener('pointerup', () => { if (dis) return; closeList(); pick(v); anchor.focus(); });
      pop.append(it); return it;
    });
    os.append(pop); openPop = pop;
    const a = anchor.getBoundingClientRect(), o = os.getBoundingClientRect();
    pop.style.minWidth = a.width + 'px';
    const itemH = items[0] ? items[0].offsetHeight : 34;
    let top = a.top - o.top - 4 - sel * (itemH + 2);
    top = clamp(top, 8, o.height - pop.offsetHeight - 8);
    pop.style.left = clamp(a.left - o.left - 4, 8, o.width - pop.offsetWidth - 8) + 'px';
    pop.style.top = top + 'px';
    if (pop.scrollHeight > pop.clientHeight) pop.scrollTop = Math.max(0, sel * (itemH + 2) - pop.clientHeight / 2);
    const mark = (i) => { items.forEach((it, j) => { it.classList.toggle('kb', j === i); }); items[i]?.scrollIntoView({ block: 'nearest' }); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeList(); anchor.focus(); cleanup(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); sel = clamp(sel + (e.key === 'ArrowDown' ? 1 : -1), 0, items.length - 1); mark(sel); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); const o2 = options[sel]; if (o2 && !o2[2]) { closeList(); pick(o2[0]); anchor.focus(); } cleanup(); }
    };
    const away = (e) => { if (!pop.contains(e.target)) { closeList(); cleanup(); } };
    const cleanup = () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', away, true); };
    document.addEventListener('keydown', key, true);
    setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  }

  /* Slider with an accent track and a round thumb; shows its value while dragging */
  function slider(ctx, { min = 0, max = 100, step = 1, get, set, onCommit, fmt = (v) => String(v), label, width = 200, live = true, disabled }) {
    const inp = h('input', { type: 'range', class: 'ws-slider', min, max, step, 'aria-label': label, style: { width: width + 'px' } });
    const tip = h('span', { class: 'ws-slider-tip' });
    const wrap = h('div', { class: 'ws-slider-wrap' }, inp, tip);
    const fill = () => { const p = ((+inp.value - min) / (max - min || 1)) * 100; inp.style.setProperty('--p', p + '%'); tip.textContent = fmt(+inp.value); tip.style.left = `calc(${p}% + ${(0.5 - p / 100) * 20}px)`; };
    const paint = () => { if (document.activeElement !== inp) inp.value = get(); inp.disabled = typeof disabled === 'function' ? !!disabled() : !!disabled; fill(); };
    inp.addEventListener('input', () => { fill(); if (live) set(+inp.value); });
    inp.addEventListener('change', () => { if (!live) set(+inp.value); onCommit?.(+inp.value); });
    inp.addEventListener('pointerdown', () => wrap.classList.add('drag'));
    inp.addEventListener('pointerup', () => wrap.classList.remove('drag'));
    ctx.sync(paint); paint();
    return wrap;
  }
  const settingSlider = (ctx, key, o) => slider(ctx, Object.assign({ get: () => S.data[key], set: (v) => S.set(key, v) }, o));

  function button(label, onClick, { accent, icon, disabled, cls } = {}) {
    const b = h('button', { class: 'ws-btn' + (accent ? ' accent' : '') + (cls ? ' ' + cls : ''), disabled: disabled || null, html: (icon ? `<span class="ws-btn-ic">${FLUENT[icon] ? fi(icon) : ui(icon)}</span>` : '') + `<span>${esc(label)}</span>` });
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick?.(e, b); });
    return b;
  }
  const link = (label, onClick) => { const a = h('button', { class: 'ws-hl', text: label }); a.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); }); return a; };

  /* InfoBar: kind info|success|warning|error */
  function info(kind, title, message, action) {
    const icon = { info: 'info', success: 'checkCircle', warning: 'warning', error: 'error' }[kind] || 'info';
    return h('div', { class: 'ws-info ' + kind, role: kind === 'error' || kind === 'warning' ? 'alert' : 'status' },
      frag(`<span class="ws-info-ic">${fi(icon)}</span>`), h('div', { class: 'ws-info-txt' }, title ? h('b', { text: title }) : null, message ? h('span', { text: message }) : null), action || null);
  }

  /* Radio buttons in a column */
  function radios(ctx, options, get, set, label) {
    const box = h('div', { class: 'ws-radios', role: 'radiogroup', 'aria-label': label });
    const btns = options.map(([v, l, d]) => {
      const b = h('button', { class: 'ws-radio', role: 'radio' }, h('span', { class: 'ws-radio-dot' }), h('span', { class: 'ws-radio-l' }, h('span', { text: l }), d ? h('span', { class: 'ws-d', text: d }) : null));
      b.addEventListener('click', (e) => { e.stopPropagation(); Promise.resolve(set(v)).finally(paint); paint(); });
      box.append(b); return [v, b];
    });
    const paint = () => btns.forEach(([v, b]) => b.setAttribute('aria-checked', String(String(get()) === String(v))));
    ctx.sync(paint); paint();
    return box;
  }
  function checkbox(ctx, label, get, set) {
    const b = h('button', { class: 'ws-check', role: 'checkbox' }, h('span', { class: 'ws-check-box', html: fi('checkmark') }), h('span', { text: label }));
    const paint = () => b.setAttribute('aria-checked', String(!!get()));
    b.addEventListener('click', (e) => { e.stopPropagation(); set(!get()); paint(); });
    ctx.sync(paint); paint();
    return b;
  }
  function textbox(ctx, { get, set, placeholder = '', width = 240, type = 'text', label, maxlength = 64, commitOnEnter = false }) {
    const inp = h('input', { class: 'ws-input', type, placeholder, 'aria-label': label || placeholder, maxlength, style: { width: width + 'px' } });
    const paint = () => { if (document.activeElement !== inp) inp.value = get() ?? ''; };
    if (commitOnEnter) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { set(inp.value); inp.blur(); } });
    else { const commit = debounce(() => set(inp.value), 350); inp.addEventListener('input', commit); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); }); }
    inp.addEventListener('click', (e) => e.stopPropagation());
    ctx.sync(paint); paint();
    return inp;
  }
  /* A bar showing how much of something is used */
  function meter(frac, kind) { const b = h('div', { class: 'ws-meter' + (kind ? ' ' + kind : '') }, h('i')); b.firstChild.style.width = clamp(frac * 100, 0, 100) + '%'; return b; }
  /* A dialog inside the Settings window, Windows style (title, body, buttons on a grey footer) */
  function dialog(title, content, buttons, { within, wide } = {}) {
    return Dialog.show({ title, content, buttons, within, wide });
  }
  /* "Keep these display settings?" with a countdown that reverts by itself */
  async function confirmRevert(within, revert, seconds = 15) {
    let left = seconds, timer = 0;
    const note = h('p', { class: 'ws-d' });
    const tick = () => { note.textContent = `Reverting to previous display settings in ${left} second${left === 1 ? '' : 's'}.`; };
    tick();
    const keep = await Dialog.show({ title: 'Keep these display settings?', content: note, within,
      buttons: [{ label: 'Keep changes', value: true, primary: true }, { label: 'Revert', value: false }], cancelValue: false,
      onOpen: (_box, finish) => { timer = setInterval(() => { left--; tick(); if (left <= 0) finish(false); }, 1000); } });
    clearInterval(timer);
    if (!keep) await revert();
    return keep;
  }
  return { ic, card, group, expander, sub, toggle, settingToggle, combo, settingCombo, closeList, slider, settingSlider, button, link, info, radios, checkbox, textbox, meter, dialog, confirmRevert };
})();

/* ========== The pages' registry ==========
   defPage(id, { title, parent, icon, nav, keywords, render(ctx) })  — render returns an array of elements
   defSettings(page, [[sid, title, keywords], ...])                  — entries for "Find a setting" */
const SPAGES = {};
const SINDEX = [];
function defPage(id, o) { SPAGES[id] = Object.assign({ id, parent: null, keywords: '' }, o); }
function defSettings(page, list) { for (const [sid, title, keywords] of list) SINDEX.push({ page, sid, title, keywords: keywords || '' }); }
const pageTrail = (id) => { const out = []; for (let p = SPAGES[id]; p; p = SPAGES[p.parent]) out.unshift(p); return out; };
