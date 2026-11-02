/* ========== Window manager ========== */
const WM = (() => {
  const wins = new Map();
  let zTop = 10, seq = 0, cascade = 0, activeId = null, snapFly = null, desktopShown = null;
  const osEl = () => document.getElementById('os');
  const layer = () => document.getElementById('windows');
  const ZONES = { left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], tl: [0, 0, 0.5, 0.5], tr: [0.5, 0, 0.5, 0.5], bl: [0, 0.5, 0.5, 0.5], br: [0.5, 0.5, 0.5, 0.5] };
  const LAYOUTS = [
    [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]],
    [[0, 0, 0.66, 1], [0.66, 0, 0.34, 1]],
    [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
    [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
    [[0, 0, 0.333, 1], [0.333, 0, 0.334, 1], [0.667, 0, 0.333, 1]],
    [[0, 0, 0.25, 1], [0.25, 0, 0.5, 1], [0.75, 0, 0.25, 1]],
  ];

  function area() {
    const os = osEl(); const W = os.clientWidth, H = os.clientHeight;
    const r = Shell.tbReserve(); const top = S.data.tbPos === 'top';
    return { x: 0, y: top ? r : 0, w: W, h: H - r };
  }
  const snapRect = (f) => { const A = area(); return { x: Math.round(A.x + f[0] * A.w), y: Math.round(A.y + f[1] * A.h), w: Math.round(f[2] * A.w), h: Math.round(f[3] * A.h) }; };
  function rectFor(w) {
    if (w.native) return { x: w.x, y: w.y, w: w.w, h: w.h }; // where the window manager says it is
    if (w.state === 'max') return area(); if (w.snap) return snapRect(w.snap); return { x: w.x, y: w.y, w: w.w, h: w.h };
  }
  function place(w) {
    const r = rectFor(w); const s = w.el.style;
    s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px';
    w.el.classList.toggle('max', w.state === 'max');
    if (w.native) { w.el.classList.toggle('full', !!w.full); NativeWin.schedule(); return; }
    w.el.classList.toggle('snapped', !!w.snap && w.state !== 'max');
    const restore = w.state === 'max' || !!w.snap;
    w.bMax.innerHTML = ui(restore ? 'restore' : 'max');
    w.bMax.setAttribute('aria-label', restore ? 'Restore' : 'Maximize');
    w.bMax.setAttribute('data-tip', restore ? 'Restore' : 'Maximize');
  }
  function animGeom(w) {
    if (motionOff()) return;
    w.el.classList.add('anim'); clearTimeout(w.animT);
    w.animT = setTimeout(() => w.el.classList.remove('anim'), 240);
  }
  function setZ(w) { w.el.style.zIndex = String(w.z + (w.onTop ? 100000 : 0)); }

  function open(appId, args = {}) {
    const app = APPS[appId]; if (!app || !appAvailable(appId)) return null;
    if (app.launch) { app.launch(args || {}); return null; } // a real program: its window arrives from the window manager
    if (app.single) {
      const ex = [...wins.values()].find((w) => w.appId === appId);
      if (ex) { focus(ex); try { ex.api.onArgs?.(args || {}); } catch (e) { console.error(e); } return ex; }
    }
    const A = area();
    let [ww, hh] = typeof app.size === 'function' ? app.size(args) : (app.size || [760, 520]);
    ww = Math.min(ww, A.w - 16); hh = Math.min(hh, A.h - 16);
    const off = (cascade++ % 6) * 26 - 52;
    const x = clamp(Math.round(A.x + (A.w - ww) / 2 + off), A.x + 4, Math.max(A.x + 4, A.x + A.w - ww - 4));
    const y = clamp(Math.round(A.y + (A.h - hh) / 2 + off * 0.7), A.y + 4, Math.max(A.y + 4, A.y + A.h - hh - 4));
    const w = { id: 'w' + (++seq), appId, app, x, y, w: ww, h: hh, state: 'normal', snap: null, min: false, z: 0, onTop: false, title: app.name, cleanup: [], beforeClose: null, dirty: false, created: Date.now() };
    build(w);
    wins.set(w.id, w);
    layer().append(w.el);
    place(w);
    w.api = makeApi(w);
    try { app.mount(w.body, w.api, args || {}); }
    catch (e) { console.error(e); w.body.append(h('div', { style: 'padding:24px', text: 'This app could not start: ' + e.message })); }
    if (A.w < 640) { w.state = 'max'; place(w); }
    focus(w);
    if (!motionOff()) { w.el.classList.add('opening'); setTimeout(() => w.el.classList.remove('opening'), 220); }
    bus.emit('wm-opened', w);
    bus.emit('wm');
    return w;
  }
  function build(w) {
    const el = h('div', { class: 'win', role: 'dialog', 'aria-label': w.title, 'data-app': w.appId });
    const tb = h('div', { class: 'win-titlebar' });
    const ic = h('span', { class: 'win-icon', html: appIcon(w.app.icon) });
    const title = h('span', { class: 'win-title', text: w.title });
    const extra = h('div', { class: 'win-extra' });
    const bMin = h('button', { class: 'wc min', 'aria-label': 'Minimize', 'data-tip': 'Minimize', html: ui('min') });
    const bMax = h('button', { class: 'wc max', 'aria-label': 'Maximize', html: ui('max') });
    const bClose = h('button', { class: 'wc close', 'aria-label': 'Close', 'data-tip': 'Close', html: ui('x') });
    if (w.app.noResize) { bMax.hidden = true; el.classList.add('noresize'); }
    tb.append(ic, title, extra, h('div', { class: 'win-controls' }, bMin, bMax, bClose));
    const body = h('div', { class: 'win-body', tabindex: '-1' });
    el.append(tb, body);
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) el.append(h('div', { class: 'rz ' + d, 'data-dir': d }));
    Object.assign(w, { el, tb, titleEl: title, body, extra, bMax });
    el.addEventListener('pointerdown', () => { if (activeId !== w.id) focus(w); }, true);
    bMin.addEventListener('click', (e) => { e.stopPropagation(); minimize(w); });
    bMax.addEventListener('click', (e) => { e.stopPropagation(); hideSnapFly(); toggleMax(w); });
    bClose.addEventListener('click', (e) => { e.stopPropagation(); close(w); });
    tb.addEventListener('pointerdown', (e) => startDrag(w, e));
    tb.addEventListener('dblclick', (e) => { if (e.target.closest('button, input, select, .win-extra') || w.app.noResize) return; toggleMax(w); });
    tb.addEventListener('contextmenu', (e) => { if (e.target.closest('.win-extra')) return; e.preventDefault(); titleMenu(w, e.clientX, e.clientY); });
    el.querySelectorAll('.rz').forEach((r) => r.addEventListener('pointerdown', (e) => startResize(w, e, r.dataset.dir)));
    let hoverT = 0;
    bMax.addEventListener('pointerenter', (e) => { if (e.pointerType === 'touch') return; clearTimeout(hoverT); hoverT = setTimeout(() => showSnapFly(w), 480); });
    bMax.addEventListener('pointerleave', () => clearTimeout(hoverT));
  }
  function makeApi(w) {
    return {
      id: w.id, win: w, el: w.el, body: w.body,
      setTitle(t) { w.title = t; w.titleEl.textContent = t; w.el.setAttribute('aria-label', t); bus.emit('wm-title', w); },
      close: (force) => close(w, force),
      onClose(fn) { w.cleanup.push(fn); },
      beforeClose(fn) { w.beforeClose = fn; },
      setDirty(v) { w.dirty = !!v; },
      on(evt, fn) { const off = bus.on(evt, fn); w.cleanup.push(off); return off; },
      every(ms, fn) { const t = setInterval(fn, ms); w.cleanup.push(() => clearInterval(t)); return t; },
      titlebar(node) { w.extra.append(node); },
      titlebarLead(node) { w.tb.insertBefore(node, w.tb.firstChild); },
      isActive: () => activeId === w.id,
      focus: () => focus(w),
      resizeTo(ww, hh) {
        const A = area(); w.w = Math.min(ww, A.w - 8); w.h = Math.min(hh, A.h - 8);
        if (w.state === 'normal' && !w.snap) { w.x = clamp(w.x, A.x, Math.max(A.x, A.x + A.w - w.w)); w.y = clamp(w.y, A.y, Math.max(A.y, A.y + A.h - w.h)); place(w); }
      },
    };
  }
  function focus(w, fromWm) {
    if (!w || !wins.has(w.id)) return;
    if (w.min) unminimize(w);
    const changed = activeId !== w.id;
    w.z = ++zTop; setZ(w);
    activeId = w.id;
    for (const x of wins.values()) x.el.classList.toggle('active', x === w);
    if (w.native) { if (!fromWm) NativeWin.focus(w.nid); }
    else { if (!w.el.contains(document.activeElement)) w.body.focus({ preventScroll: true }); NativeWin.focus(0); }
    if (changed) bus.emit('wm');
    NativeWin.schedule();
  }
  function focusTop() {
    let best = null;
    for (const w of wins.values()) if (!w.min && (!best || w.z > best.z)) best = w;
    if (best) focus(best);
    else { activeId = null; for (const x of wins.values()) x.el.classList.remove('active'); bus.emit('wm'); }
  }
  function tbRect(appId) { const b = document.querySelector(`#tb-apps [data-app="${appId}"]`); return b ? b.getBoundingClientRect() : null; }
  function minimize(w) {
    if (w.min) return;
    w.min = true; const el = w.el;
    if (w.native) { NativeWin.call('show', { id: w.nid, on: 0 }); el.classList.add('ghost'); }
    const t = tbRect(tbId(w));
    if (!motionOff() && t && el.animate) {
      const r = el.getBoundingClientRect();
      const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2);
      const a = el.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(.1)`, opacity: 0 }], { duration: 230, easing: 'cubic-bezier(.4,0,.7,.2)' });
      a.onfinish = () => { el.classList.remove('ghost'); if (w.min) el.style.display = 'none'; NativeWin.schedule(); };
    } else { el.classList.remove('ghost'); el.style.display = 'none'; }
    el.classList.remove('active');
    if (activeId === w.id) { activeId = null; focusTop(); } else bus.emit('wm');
  }
  function unminimize(w) {
    if (!w.min) return;
    w.min = false; const el = w.el; el.style.display = '';
    const t = tbRect(tbId(w));
    // A program's window shows again when its stand-in has flown up from the taskbar.
    const shown = () => { if (!w.native || w.min || !wins.has(w.id)) return; el.classList.remove('ghost'); NativeWin.call('show', { id: w.nid, on: 1 }); if (activeId === w.id) NativeWin.focus(w.nid); NativeWin.schedule(); };
    if (w.native) el.classList.add('ghost');
    if (!motionOff() && t && el.animate) {
      const r = el.getBoundingClientRect();
      const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2);
      const a = el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.1)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.2,.8,.3,1)' });
      a.onfinish = shown;
    } else shown();
  }
  function toggleMax(w) {
    if (w.app.noResize) return;
    if (!w.native) animGeom(w);
    if (w.state === 'max') { w.state = 'normal'; w.snap = w.preMaxSnap || null; }
    else if (w.snap) { w.snap = null; }
    else { w.preMaxSnap = null; w.state = 'max'; }
    if (w.native) { nativeApply(w); return; }
    place(w); bus.emit('wm-resize', w);
  }
  /* Ask the window manager to put a program's window where this window manager wants it. */
  function nativeApply(w) {
    const st = w.full ? 3 : w.state === 'max' ? 1 : w.snap ? 2 : 0;
    const back = w.normal || { x: w.x, y: w.y, w: w.w, h: w.h };
    const r = st === 1 ? area() : st === 2 ? snapRect(w.snap) : back;
    NativeWin.call('geom', { id: w.nid, x: r.x, y: r.y, w: r.w, h: r.h, state: st, rw: back.w, rh: back.h });
  }
  function snapTo(w, zone) {
    if (w.app.noResize && zone !== 'restore') return;
    if (w.min) unminimize(w);
    animGeom(w);
    if (zone === 'max' || zone === 'top') { w.preMaxSnap = w.snap; w.state = 'max'; }
    else if (zone === 'restore') { w.state = 'normal'; w.snap = null; }
    else { w.state = 'normal'; w.snap = Array.isArray(zone) ? zone : ZONES[zone]; }
    if (w.native) { w.full = false; nativeApply(w); focus(w); return; }
    place(w); focus(w); bus.emit('wm-resize', w);
  }
  async function close(w, force = false) {
    if (!w || w.closing || !wins.has(w.id)) return false;
    if (w.native) { NativeWin.call('close', { id: w.nid }); return true; } // the program decides; its window goes when it closes
    if (!force && w.beforeClose) {
      focus(w);
      let ok = false;
      try { ok = await w.beforeClose(); } catch (e) { console.error(e); ok = true; }
      if (!ok) return false;
    }
    w.closing = true;
    for (const f of w.cleanup) { try { f(); } catch (e) { console.error(e); } }
    wins.delete(w.id);
    const el = w.el;
    if (!motionOff() && !w.min && el.animate) { const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 130, easing: 'ease-in' }); a.onfinish = () => el.remove(); }
    else el.remove();
    if (activeId === w.id) { activeId = null; focusTop(); } else bus.emit('wm');
    return true;
  }

  /* ---- dragging & snapping ---- */
  let preview = null;
  function showPreview(w, zone) {
    if (!zone) { if (preview) preview.classList.remove('show'); return; }
    if (!preview) { preview = h('div', { id: 'snap-preview' }); }
    if (!preview.isConnected) layer().prepend(preview);
    const target = zone === 'top' ? area() : snapRect(ZONES[zone]);
    if (!preview.classList.contains('show')) {
      const r = rectFor(w);
      Object.assign(preview.style, { transition: 'none', left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      void preview.offsetWidth; preview.style.transition = '';
    }
    preview.style.zIndex = String(w.z + (w.onTop ? 100000 : 0) - 1);
    Object.assign(preview.style, { left: target.x + 'px', top: target.y + 'px', width: target.w + 'px', height: target.h + 'px' });
    preview.classList.add('show');
  }
  function startDrag(w, e) {
    if (e.button !== 0 || e.target.closest('button, input, select, textarea, .win-extra')) return;
    if (osEl().classList.contains('tv')) return;
    const tb = w.tb; tb.setPointerCapture?.(e.pointerId);
    const osR = osEl().getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const r0 = rectFor(w);
    let ox = sx - osR.left - r0.x, oy = sy - osR.top - r0.y, started = false, zone = null;
    const move = (ev) => {
      if (!started) {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 4) return;
        started = true; w.el.classList.add('dragging'); hideSnapFly();
        if (w.state === 'max' || w.snap) {
          const frac = ox / r0.w; w.state = 'normal'; w.snap = null;
          ox = clamp(frac * w.w, 60, w.w - 60); oy = Math.min(oy, 20);
          place(w);
        }
      }
      const A = area();
      const px = ev.clientX - osR.left, py = ev.clientY - osR.top;
      w.x = Math.round(clamp(px - ox, A.x - w.w + 100, A.x + A.w - 100));
      w.y = Math.round(clamp(py - oy, A.y, A.y + A.h - 40));
      w.el.style.left = w.x + 'px'; w.el.style.top = w.y + 'px';
      if (w.app.noResize) return;
      const E = 8, C = 56;
      let z = null;
      if (px <= A.x + E) z = py < A.y + C ? 'tl' : py > A.y + A.h - C ? 'bl' : 'left';
      else if (px >= A.x + A.w - E) z = py < A.y + C ? 'tr' : py > A.y + A.h - C ? 'br' : 'right';
      else if (py <= A.y + E) z = 'top';
      if (z !== zone) { zone = z; showPreview(w, z); }
    };
    const up = () => {
      tb.removeEventListener('pointermove', move); tb.removeEventListener('pointerup', up); tb.removeEventListener('pointercancel', up);
      w.el.classList.remove('dragging'); showPreview(w, null);
      if (started && zone) snapTo(w, zone === 'top' ? 'max' : zone);
      else if (started) bus.emit('wm-move', w);
    };
    tb.addEventListener('pointermove', move); tb.addEventListener('pointerup', up); tb.addEventListener('pointercancel', up);
  }
  function startResize(w, e, dir) {
    if (e.button !== 0 || w.state === 'max' || w.app.noResize) return;
    e.preventDefault(); e.stopPropagation();
    const hd = e.currentTarget; hd.setPointerCapture?.(e.pointerId);
    if (w.snap) { const r = rectFor(w); Object.assign(w, { x: r.x, y: r.y, w: r.w, h: r.h, snap: null }); place(w); }
    const sx = e.clientX, sy = e.clientY, r0 = { x: w.x, y: w.y, w: w.w, h: w.h };
    const [minW, minH] = w.app.minSize || [340, 220];
    const A = area();
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let { x, y, w: ww, h: hh } = r0;
      if (dir.includes('e')) ww = Math.max(minW, r0.w + dx);
      if (dir.includes('s')) hh = Math.max(minH, r0.h + dy);
      if (dir.includes('w')) { ww = Math.max(minW, r0.w - dx); x = r0.x + r0.w - ww; }
      if (dir.includes('n')) { hh = Math.max(minH, r0.h - dy); y = r0.y + r0.h - hh; if (y < A.y) { hh -= A.y - y; y = A.y; } }
      Object.assign(w, { x, y, w: ww, h: hh }); place(w);
    };
    const up = () => { hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); bus.emit('wm-resize', w); };
    hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  }
  function hideSnapFly() { if (snapFly) { snapFly.remove(); snapFly = null; } }
  function showSnapFly(w) {
    if (w.app.noResize || !wins.has(w.id)) return;
    hideSnapFly();
    const fly = h('div', { class: 'snapfly acrylic', role: 'menu', 'aria-label': 'Snap layouts' });
    for (const lay of LAYOUTS) {
      const box = h('div', { class: 'lay' });
      for (const z of lay) {
        const zb = h('button', { class: 'zone', 'aria-label': 'Snap window here', style: { left: z[0] * 100 + '%', top: z[1] * 100 + '%', width: z[2] * 100 + '%', height: z[3] * 100 + '%' } });
        zb.addEventListener('click', () => { hideSnapFly(); snapTo(w, z); });
        box.append(zb);
      }
      fly.append(box);
    }
    osEl().append(fly);
    const osR = osEl().getBoundingClientRect(); const r = w.bMax.getBoundingClientRect();
    const fw = fly.offsetWidth, fh = fly.offsetHeight;
    let left = clamp(r.left + r.width / 2 - fw / 2 - osR.left, 8, osR.width - fw - 8);
    let top = r.bottom - osR.top + 4; if (top + fh > osR.height - 8) top = Math.max(8, r.top - osR.top - fh - 4);
    fly.style.left = left + 'px'; fly.style.top = top + 'px';
    snapFly = fly;
    let leaveT = 0;
    const arm = () => { clearTimeout(leaveT); leaveT = setTimeout(hideSnapFly, 320); };
    fly.addEventListener('pointerleave', arm);
    fly.addEventListener('pointerenter', () => clearTimeout(leaveT));
    w.bMax.addEventListener('pointerleave', arm, { once: true });
  }
  function titleMenu(w, x, y) {
    const restorable = w.state === 'max' || !!w.snap;
    Menu.show([
      { label: 'Restore', icon: 'restore', disabled: !restorable, action: () => toggleMax(w) },
      { label: 'Minimize', icon: 'min', action: () => minimize(w) },
      { label: 'Maximize', icon: 'max', disabled: w.state === 'max' || w.app.noResize, action: () => snapTo(w, 'max') },
      'sep',
      { label: 'Snap left', icon: 'layout', disabled: w.app.noResize, action: () => snapTo(w, 'left') },
      { label: 'Snap right', icon: 'layout', disabled: w.app.noResize, action: () => snapTo(w, 'right') },
      { label: 'Keep on top', icon: 'pin', checked: w.onTop, action: () => { w.onTop = !w.onTop; setZ(w); focus(w); NativeWin.schedule(); } },
      'sep',
      { label: 'Close', icon: 'x', action: () => close(w) },
    ], x, y);
  }

  /* ---- task view ---- */
  function taskView(on) {
    const os = osEl();
    if (on === undefined) on = !os.classList.contains('tv');
    Shell.closeFlyouts(); hideSnapFly();
    const tv = document.getElementById('taskview'); tv.innerHTML = '';
    const list = [...wins.values()].sort((a, b) => b.z - a.z);
    if (!on) {
      os.classList.remove('tv');
      for (const w of list) {
        w.el.style.transform = '';
        if (w.min) setTimeout(() => { if (w.min && !os.classList.contains('tv')) w.el.style.display = 'none'; }, 300);
      }
      bus.emit('wm');
      return;
    }
    os.classList.add('tv');
    if (!list.length) { tv.append(h('div', { class: 'tv-empty', text: 'No open windows. Press Escape or click anywhere to go back.' })); return; }
    const A = area(); const pad = 56, gap = 36, label = 30; const n = list.length;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cw = (A.w - pad * 2 - gap * (cols - 1)) / cols, ch = (A.h - pad * 2 - (gap + label) * (rows - 1) - label) / rows;
      if (cw < 80 || ch < 60) continue;
      const s = Math.min(...list.map((w) => { const r = rectFor(w); return Math.min(cw / r.w, ch / r.h, 0.8); }));
      if (!best || s > best.s) best = { cols, rows, cw, ch, s };
    }
    if (!best) best = { cols: Math.ceil(Math.sqrt(n)), rows: Math.ceil(n / Math.ceil(Math.sqrt(n))), cw: 160, ch: 100, s: 0.2 };
    list.forEach((w, i) => {
      const col = i % best.cols, row = Math.floor(i / best.cols);
      const inRow = Math.min(best.cols, n - row * best.cols);
      const rowW = inRow * best.cw + (inRow - 1) * gap;
      const x0 = A.x + (A.w - rowW) / 2 + col * (best.cw + gap);
      const gridH = best.rows * (best.ch + label) + (best.rows - 1) * gap;
      const y0 = A.y + (A.h - gridH) / 2 + row * (best.ch + label + gap) + label;
      const r = rectFor(w); const s = Math.min(best.cw / r.w, best.ch / r.h, 0.8);
      const tx = x0 + (best.cw - r.w * s) / 2, ty = y0 + (best.ch - r.h * s) / 2;
      if (w.min) { w.el.style.display = ''; }
      w.el.style.transform = `translate(${tx - r.x}px, ${ty - r.y}px) scale(${s})`;
      const lab = h('div', { class: 'tv-label', style: { left: tx + 'px', top: ty - 26 + 'px', width: Math.max(120, r.w * s) + 'px' }, html: appIcon(w.app.icon) + `<span>${esc(w.title)}</span>` });
      tv.append(lab);
    });
  }
  layer().addEventListener('pointerdown', (e) => {
    if (!osEl().classList.contains('tv')) return;
    const el = e.target.closest('.win'); if (!el) return;
    e.preventDefault(); e.stopPropagation();
    const w = [...wins.values()].find((x) => x.el === el);
    taskView(false);
    if (w) focus(w);
  }, true);
  document.getElementById('taskview').addEventListener('pointerdown', () => taskView(false));

  function showDesktop() {
    const visible = [...wins.values()].filter((w) => !w.min);
    if (visible.length) { desktopShown = visible.map((w) => w.id); visible.forEach((w) => minimize(w)); }
    else if (desktopShown) { const ids = desktopShown; desktopShown = null; ids.map((id) => wins.get(id)).filter(Boolean).forEach((w) => focus(w)); }
  }
  function keySnap(key) {
    const w = wins.get(activeId); if (!w) return;
    if (key === 'ArrowLeft') snapTo(w, w.snap === ZONES.right ? 'restore' : 'left');
    else if (key === 'ArrowRight') snapTo(w, w.snap === ZONES.left ? 'restore' : 'right');
    else if (key === 'ArrowUp') snapTo(w, 'max');
    else if (key === 'ArrowDown') { if (w.state === 'max' || w.snap) snapTo(w, 'restore'); else minimize(w); }
  }
  function relayout() {
    const A = area();
    NativeWin.area(A);
    for (const w of wins.values()) {
      if (w.native) { if (w.state === 'max' || w.snap) nativeApply(w); continue; }
      if (w.state === 'normal' && !w.snap) {
        w.w = Math.min(w.w, A.w); w.h = Math.min(w.h, A.h);
        w.x = clamp(w.x, A.x - w.w + 100, A.x + A.w - 100); w.y = clamp(w.y, A.y, Math.max(A.y, A.y + A.h - 40));
      }
      place(w);
    }
    if (osEl().classList.contains('tv')) taskView(true);
  }
  window.addEventListener('resize', debounce(relayout, 60));

  /* ---- programs' windows (drawn by nimbus-wm; see nwin.js) ---- */
  const byNid = (nid) => wins.get('n' + nid);
  function openNative(ev, appId) {
    if (byNid(ev.id)) return byNid(ev.id);
    const app = APPS[appId];
    const w = { id: 'n' + ev.id, nid: ev.id, native: true, appId, app, x: ev.x, y: ev.y, w: ev.w, h: ev.h,
      state: ev.state === 'max' ? 'max' : 'normal', snap: null, full: ev.state === 'full', min: !!ev.min, z: 0, onTop: false,
      title: ev.title || app.name, parent: ev.parent || 0, pid: ev.pid || 0, cleanup: [], beforeClose: null, dirty: false, created: Date.now() };
    if (ev.state === 'normal') w.normal = { x: ev.x, y: ev.y, w: ev.w, h: ev.h };
    const card = h('div', { class: 'nwin-card' }, h('span', { class: 'nwin-icon', html: appIcon(app.icon) }), h('span', { class: 'nwin-title', text: w.title }));
    const el = h('div', { class: 'win native', 'data-app': appId, 'aria-label': w.title }, card);
    Object.assign(w, { el, titleEl: card.querySelector('.nwin-title'), body: el });
    w.api = { id: w.id, win: w, el, body: el, close: () => close(w), onClose(fn) { w.cleanup.push(fn); }, focus: () => focus(w), isActive: () => activeId === w.id, setTitle() {}, on: () => () => {}, every: () => 0 };
    wins.set(w.id, w);
    layer().append(el);
    place(w);
    if (w.min) el.style.display = 'none';
    else focus(w, true); // new windows get the keyboard from the window manager itself
    bus.emit('wm-opened', w); bus.emit('wm');
    return w;
  }
  function nativeGone(nid) {
    const w = byNid(nid); if (!w) return;
    for (const f of w.cleanup) { try { f(); } catch (e) { console.error(e); } }
    wins.delete(w.id); w.el.remove();
    if (activeId === w.id) { activeId = null; focusTop(); } else bus.emit('wm');
    NativeWin.schedule();
  }
  function nativeTitle(nid, title) {
    const w = byNid(nid); if (!w) return;
    w.title = title || w.app.name; w.titleEl.textContent = w.title; w.el.setAttribute('aria-label', w.title);
    bus.emit('wm-title', w);
  }
  function nativeGeom(ev) {
    const w = byNid(ev.id); if (!w) return;
    Object.assign(w, { x: ev.x, y: ev.y, w: ev.w, h: ev.h });
    w.full = ev.state === 'full';
    if (ev.state === 'normal') { w.state = 'normal'; w.snap = null; w.normal = { x: ev.x, y: ev.y, w: ev.w, h: ev.h }; }
    else if (ev.state === 'max') { w.state = 'max'; w.snap = null; }
    place(w); bus.emit('wm-resize', w);
  }
  // The window manager moves a program's window while its title bar is dragged; snapping works as for ours.
  function nativeMoving(ev, done) {
    const w = byNid(ev.id); if (!w) return;
    w.x = ev.x; w.y = ev.y; place(w);
    const A = area(); const px = ev.px, py = ev.py; const E = 8, C = 56;
    let z = null;
    if (px <= A.x + E) z = py < A.y + C ? 'tl' : py > A.y + A.h - C ? 'bl' : 'left';
    else if (px >= A.x + A.w - E) z = py < A.y + C ? 'tr' : py > A.y + A.h - C ? 'br' : 'right';
    else if (py <= A.y + E) z = 'top';
    if (!done) { if (z !== w.dragZone) { w.dragZone = z; showPreview(w, z); } return; }
    showPreview(w, null); w.dragZone = null;
    if (z) snapTo(w, z === 'top' ? 'max' : z); else bus.emit('wm-move', w);
  }

  return {
    open, focus, close, minimize, snapTo, toggleMax, taskView, showDesktop, keySnap, relayout, area, hideSnapFly,
    openNative, nativeGone, nativeTitle, nativeGeom, nativeMoving, byNid, titleMenu,
    zOf: (w) => w.z + (w.onTop ? 100000 : 0),
    list: () => [...wins.values()].sort((a, b) => a.created - b.created),
    get: (id) => wins.get(id),
    activeId: () => activeId,
    active: () => wins.get(activeId) || null,
    inTaskView: () => osEl().classList.contains('tv'),
    async closeAll(force) {
      for (const w of [...wins.values()]) await close(w, force);
      // programs get a few seconds to close by themselves (Chrome saves its tabs)
      for (let i = 0; i < 40 && [...wins.values()].some((w) => w.native); i++) await sleep(100);
    },
    anyDirty: () => [...wins.values()].some((w) => w.dirty),
  };
})();
