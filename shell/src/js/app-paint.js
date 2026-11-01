/* ========== Paint ========== */
function mountPaint(root, api, args) {
  const W = 1000, H = 640;
  const PALETTE = ['#1b1c22', '#6b7280', '#ffffff', '#ef4444', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#92400e', '#fde68a'];
  const TOOLS = [['brush', 'brush', 'Brush (B)'], ['eraser', 'eraser', 'Eraser (E)'], ['line', 'line', 'Line (L)'], ['rect', 'rect', 'Rectangle (R)'], ['ellipse', 'ellipse', 'Ellipse (O)'], ['fill', 'bucket', 'Fill (F)'], ['picker', 'picker', 'Pick a color (I)']];
  const st = { tool: 'brush', color: '#1b1c22', size: 6, fillShapes: false, id: null, dirty: false, undo: [], redo: [] };
  root.classList.add('app-paint');
  root.innerHTML = `
    <div class="pt-bar" role="toolbar" aria-label="Paint tools">
      <button class="mbtn" data-m="file">File</button><button class="mbtn" data-m="image">Image</button>
      <span class="vsep"></span>
      <div class="pt-tools">${TOOLS.map(([t, ic, label]) => `<button class="ibtn tool" data-tool="${t}" aria-label="${label}" data-tip="${label}" aria-pressed="false">${ui(ic)}</button>`).join('')}</div>
      <span class="vsep"></span>
      <label class="pt-size" data-tip="Brush size"><input type="range" min="1" max="60" value="6" id="${api.id}-size" aria-label="Brush size"><span class="pt-sizev num">6</span></label>
      <label class="pt-fillopt"><input type="checkbox" id="${api.id}-fill"> Fill shapes</label>
      <span class="vsep"></span>
      <span class="pt-current" aria-hidden="true"></span>
      <div class="pt-colors" role="radiogroup" aria-label="Colors">${PALETTE.map((c) => `<button class="pt-sw" data-c="${c}" style="--c:${c}" role="radio" aria-label="Color ${c}" aria-checked="false"></button>`).join('')}<label class="pt-sw custom" data-tip="Custom color"><input type="color" id="${api.id}-color" value="#1b1c22" aria-label="Custom color"></label></div>
      <span class="grow"></span>
      <button class="ibtn" data-act="undo" aria-label="Undo" data-tip="Undo (Ctrl+Z)">${ui('undo')}</button>
      <button class="ibtn" data-act="redo" aria-label="Redo" data-tip="Redo (Ctrl+Y)">${ui('redo')}</button>
    </div>
    <div class="pt-stage"><div class="pt-wrap"><canvas class="pt-canvas" width="${W}" height="${H}" aria-label="Drawing canvas"></canvas><canvas class="pt-overlay" width="${W}" height="${H}" aria-hidden="true"></canvas></div></div>
    <div class="pt-status"><span class="pt-pos num"></span><span class="grow"></span><span class="num">${W} × ${H} px</span></div>`;
  const cv = root.querySelector('.pt-canvas'), ov = root.querySelector('.pt-overlay'), wrap = root.querySelector('.pt-wrap'), stage = root.querySelector('.pt-stage');
  const ctx = cv.getContext('2d', { willReadFrequently: true }), octx = ov.getContext('2d');
  const name = () => (st.id && FS.get(st.id) ? FS.get(st.id).name : 'Untitled');
  function updTitle() { api.setTitle((st.dirty ? '• ' : '') + name() + ' – Paint'); api.setDirty(st.dirty); }
  function clearCanvas() { ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  function fit() {
    const sw = stage.clientWidth - 40, sh = stage.clientHeight - 40; if (sw <= 0 || sh <= 0) return;
    const s = Math.min(sw / W, sh / H, 1.5);
    wrap.style.width = Math.round(W * s) + 'px'; wrap.style.height = Math.round(H * s) + 'px';
  }
  function setTool(t) { st.tool = t; root.querySelectorAll('.tool').forEach((b) => { const on = b.dataset.tool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); stage.dataset.tool = t; }
  function setColor(c) { st.color = c; root.querySelector('.pt-current').style.background = c; root.querySelectorAll('.pt-sw[data-c]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.c.toLowerCase() === c.toLowerCase()))); const ci = root.querySelector('input[type=color]'); if (/^#[0-9a-f]{6}$/i.test(c)) ci.value = c; }
  function snapshot() { st.undo.push(ctx.getImageData(0, 0, W, H)); if (st.undo.length > 14) st.undo.shift(); st.redo = []; }
  function markDirty() { if (!st.dirty) { st.dirty = true; updTitle(); } }
  function undo() { if (!st.undo.length) return; st.redo.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(st.undo.pop(), 0, 0); markDirty(); }
  function redo() { if (!st.redo.length) return; st.undo.push(ctx.getImageData(0, 0, W, H)); ctx.putImageData(st.redo.pop(), 0, 0); markDirty(); }
  const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; };
  function hexRGBA(c) { const [r, g, b] = hexToRgb(c); return [r, g, b, 255]; }
  function flood(x, y, color) {
    x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= W || y >= H) return;
    const img = ctx.getImageData(0, 0, W, H); const d = img.data; const i0 = (y * W + x) * 4;
    const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3]; const [fr, fg, fb, fa] = hexRGBA(color);
    if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 6 && ta === fa) return;
    const tol = 48; const match = (i) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) + Math.abs(d[i + 3] - ta) <= tol;
    const seen = new Uint8Array(W * H); const stack = [[x, y]];
    while (stack.length) {
      let [cx, cy] = stack.pop(); let p = cy * W + cx;
      while (cx >= 0 && !seen[p] && match(p * 4)) { cx--; p--; }
      cx++; p++; let up = false, down = false;
      while (cx < W && !seen[p] && match(p * 4)) {
        seen[p] = 1; const i = p * 4; d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = fa;
        if (cy > 0) { const q = p - W; if (!seen[q] && match(q * 4)) { if (!up) { stack.push([cx, cy - 1]); up = true; } } else up = false; }
        if (cy < H - 1) { const q = p + W; if (!seen[q] && match(q * 4)) { if (!down) { stack.push([cx, cy + 1]); down = true; } } else down = false; }
        cx++; p++;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  function shape(c, a, b, shift, preview) {
    let { x: x0, y: y0 } = a, { x: x1, y: y1 } = b;
    c.save(); c.strokeStyle = st.color; c.fillStyle = st.color; c.lineWidth = st.size; c.lineCap = 'round'; c.lineJoin = 'round';
    if (st.tool === 'line') {
      if (shift) { const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * (Math.PI / 4); const len = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + Math.cos(ang) * len; y1 = y0 + Math.sin(ang) * len; }
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    } else {
      let w = x1 - x0, hh = y1 - y0;
      if (shift) { const m = Math.max(Math.abs(w), Math.abs(hh)); w = Math.sign(w || 1) * m; hh = Math.sign(hh || 1) * m; }
      c.beginPath();
      if (st.tool === 'rect') c.rect(x0, y0, w, hh);
      else c.ellipse(x0 + w / 2, y0 + hh / 2, Math.abs(w / 2), Math.abs(hh / 2), 0, 0, Math.PI * 2);
      if (st.fillShapes) c.fill(); else c.stroke();
    }
    c.restore();
  }
  let drawing = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.target.closest('.pt-wrap')) return;
    e.preventDefault(); stage.setPointerCapture(e.pointerId);
    const p = pt(e);
    if (st.tool === 'picker') { const d = ctx.getImageData(Math.floor(clamp(p.x, 0, W - 1)), Math.floor(clamp(p.y, 0, H - 1)), 1, 1).data; setColor(rgbToHex(d[0], d[1], d[2])); setTool('brush'); return; }
    if (st.tool === 'fill') { snapshot(); flood(p.x, p.y, st.color); markDirty(); return; }
    snapshot();
    drawing = { start: p, last: p, mid: p };
    if (st.tool === 'brush' || st.tool === 'eraser') {
      ctx.save(); ctx.fillStyle = st.tool === 'eraser' ? '#ffffff' : st.color;
      const r = (st.size * (e.pointerType === 'pen' ? 0.4 + (e.pressure || 0.5) * 1.2 : 1)) / 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    markDirty();
  });
  stage.addEventListener('pointermove', (e) => {
    const p = pt(e);
    root.querySelector('.pt-pos').textContent = p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H ? `${Math.round(p.x)}, ${Math.round(p.y)} px` : '';
    if (!drawing) return;
    if (st.tool === 'brush' || st.tool === 'eraser') {
      const pts = e.getCoalescedEvents ? e.getCoalescedEvents().map(pt) : [p];
      ctx.save(); ctx.strokeStyle = st.tool === 'eraser' ? '#ffffff' : st.color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = st.size * (e.pointerType === 'pen' ? 0.4 + (e.pressure || 0.5) * 1.2 : 1);
      for (const q of pts) {
        const mid = { x: (drawing.last.x + q.x) / 2, y: (drawing.last.y + q.y) / 2 };
        ctx.beginPath(); ctx.moveTo(drawing.mid.x, drawing.mid.y); ctx.quadraticCurveTo(drawing.last.x, drawing.last.y, mid.x, mid.y); ctx.stroke();
        drawing.mid = mid; drawing.last = q;
      }
      ctx.restore();
    } else { octx.clearRect(0, 0, W, H); shape(octx, drawing.start, p, e.shiftKey, true); }
  });
  const end = (e) => {
    if (!drawing) return;
    if (st.tool === 'line' || st.tool === 'rect' || st.tool === 'ellipse') { octx.clearRect(0, 0, W, H); shape(ctx, drawing.start, pt(e), e.shiftKey); }
    else { ctx.save(); ctx.strokeStyle = st.tool === 'eraser' ? '#ffffff' : st.color; ctx.lineWidth = st.size; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(drawing.mid.x, drawing.mid.y); ctx.lineTo(drawing.last.x, drawing.last.y); ctx.stroke(); ctx.restore(); }
    drawing = null;
  };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', () => { root.querySelector('.pt-pos').textContent = ''; });
  function loadImage(id) {
    const n = FS.get(id); if (!n || n.kind !== 'image') return;
    const img = new Image();
    img.onload = () => {
      clearCanvas();
      const s = Math.min(W / img.width, H / img.height, 1); const w = img.width * s, hh = img.height * s;
      ctx.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh);
      st.id = /\.png$/i.test(n.name) && img.width === W && img.height === H ? id : null;
      if (!st.id) st.sourceName = n.name.replace(/\.[^.]+$/, '') + ' (edited).png';
      st.undo = []; st.redo = []; st.dirty = !st.id; updTitle();
    };
    img.src = FS.read(id);
  }
  async function confirmDiscard() {
    if (!st.dirty) return true;
    const v = await Dialog.show({ title: 'Paint', message: `Do you want to save changes to ${name()}?`, within: api.win, cancelValue: 'cancel', buttons: [{ label: 'Save', value: 'save', primary: true }, { label: "Don't save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }] });
    if (v === 'save') return save(false);
    return v === 'discard';
  }
  async function save(as) {
    const data = cv.toDataURL('image/png');
    const n = st.id && FS.get(st.id);
    if (!as && n && !FS.inTrash(st.id)) { FS.write(st.id, data); st.dirty = false; updTitle(); return true; }
    const r = await Dialog.file({ mode: 'save', kind: 'image', folder: n ? n.parent : 'pictures', name: n ? n.name : st.sourceName || 'Drawing.png', within: api.win });
    if (!r) return false;
    if (r.id) { FS.write(r.id, data); st.id = r.id; } else st.id = FS.create(r.folder, r.name, 'file', data, 'image').id;
    st.dirty = false; updTitle(); FS.touchRecent(st.id);
    return true;
  }
  async function newCanvas() { if (!(await confirmDiscard())) return; clearCanvas(); st.id = null; st.sourceName = null; st.undo = []; st.redo = []; st.dirty = false; updTitle(); }
  async function openPick() {
    if (!(await confirmDiscard())) return;
    const r = await Dialog.file({ mode: 'open', kind: 'image', folder: 'pictures', within: api.win });
    if (r?.id) loadImage(r.id);
  }
  function transform(fn) { snapshot(); const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; tmp.getContext('2d').drawImage(cv, 0, 0); clearCanvas(); ctx.save(); fn(ctx); ctx.drawImage(tmp, 0, 0); ctx.restore(); markDirty(); }
  const MENUS = {
    file: () => [
      { label: 'New', icon: 'doc', action: newCanvas },
      { label: 'Open…', icon: 'folderOpen', kb: 'Ctrl+O', action: openPick },
      { label: 'Save', icon: 'save', kb: 'Ctrl+S', action: () => save(false) },
      { label: 'Save as…', icon: 'save', action: () => save(true) },
      'sep',
      { label: 'Set as wallpaper', icon: 'desktop', action: async () => { if (st.dirty || !st.id) { if (!(await save(false))) return; } S.set('wallpaper', 'file:' + st.id); Notif.push({ app: 'paint', title: 'Wallpaper changed', body: name(), silent: true }); } },
      caps.downloads ? { label: 'Download PNG to this computer', icon: 'download', action: () => cv.toBlob((b) => b && offerDownload(name().replace(/\.[^.]+$/, '') + '.png', b), 'image/png') } : null,
      'sep',
      { label: 'Close window', icon: 'x', action: () => api.close() },
    ],
    image: () => [
      { label: 'Flip horizontal', icon: 'arrowR', action: () => transform((c) => { c.translate(W, 0); c.scale(-1, 1); }) },
      { label: 'Flip vertical', icon: 'arrowUp', action: () => transform((c) => { c.translate(0, H); c.scale(1, -1); }) },
      { label: 'Invert colors', icon: 'contrast', action: () => { snapshot(); const img = ctx.getImageData(0, 0, W, H); for (let i = 0; i < img.data.length; i += 4) { img.data[i] = 255 - img.data[i]; img.data[i + 1] = 255 - img.data[i + 1]; img.data[i + 2] = 255 - img.data[i + 2]; } ctx.putImageData(img, 0, 0); markDirty(); } },
      'sep',
      { label: 'Clear canvas', icon: 'trash', danger: true, action: () => { snapshot(); clearCanvas(); markDirty(); } },
    ],
  };
  root.querySelector('.pt-bar').addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { m.classList.add('on'); Menu.show(MENUS[m.dataset.m](), 0, 0, { anchorEl: m, onClose: () => m.classList.remove('on') }); return; }
    const t = e.target.closest('[data-tool]'); if (t) { setTool(t.dataset.tool); return; }
    const sw = e.target.closest('.pt-sw[data-c]'); if (sw) { setColor(sw.dataset.c); return; }
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'undo') undo(); else if (a === 'redo') redo();
  });
  const sizeInp = root.querySelector('.pt-size input');
  sizeInp.addEventListener('input', () => { st.size = +sizeInp.value; root.querySelector('.pt-sizev').textContent = sizeInp.value; });
  root.querySelector('.pt-fillopt input').addEventListener('change', (e) => { st.fillShapes = e.target.checked; });
  root.querySelector('input[type=color]').addEventListener('input', (e) => setColor(e.target.value));
  root.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); redo(); }
    else if (mod && k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (mod && k === 'o') { e.preventDefault(); openPick(); }
    else if (!mod && !e.altKey) {
      const map = { b: 'brush', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse', f: 'fill', i: 'picker' };
      if (map[k]) { setTool(map[k]); e.preventDefault(); }
      else if (k === '[' || k === ']') { st.size = clamp(st.size + (k === ']' ? 2 : -2), 1, 60); sizeInp.value = st.size; root.querySelector('.pt-sizev').textContent = st.size; }
    }
  });
  const ro = new ResizeObserver(fit); ro.observe(stage); api.onClose(() => ro.disconnect());
  api.beforeClose(confirmDiscard);
  api.onArgs = async (a) => { if (a.file && (await confirmDiscard())) loadImage(a.file); };
  clearCanvas(); setTool('brush'); setColor(st.color); updTitle();
  if (args.file) loadImage(args.file);
  requestAnimationFrame(fit);
}
