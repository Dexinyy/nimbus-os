/* ========== Photos ========== */
function mountPhotos(root, api, args) {
  const st = { mode: 'gallery', id: null, zoom: 1, fit: true, rot: 0, px: 0, py: 0, info: false };
  root.classList.add('app-photos');
  const allImages = () => Object.values(FS.nodes).filter((n) => n.type === 'file' && n.kind === 'image' && !FS.inTrash(n.id)).sort((a, b) => b.modified - a.modified);
  const siblings = () => { const n = FS.get(st.id); if (!n) return []; return FS.children(n.parent).filter((x) => x.kind === 'image'); };
  function gallery() {
    st.mode = 'gallery'; st.id = null; api.setTitle('Gallery – Photos');
    const imgs = allImages();
    root.innerHTML = '';
    const head = h('div', { class: 'ph-head' },
      h('div', {}, h('h2', { text: 'Gallery' }), h('div', { class: 'muted', text: `${imgs.length} picture${imgs.length === 1 ? '' : 's'}` })),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', html: ui('upload') + 'Import', onclick: async () => { const f = await pickFiles('image/*'); if (f.length) await importFiles(f, 'pictures'); } }),
      h('button', { class: 'btn', html: ui('brush') + 'New drawing', onclick: () => WM.open('paint') }));
    const grid = h('div', { class: 'ph-grid' });
    if (!imgs.length) grid.append(h('div', { class: 'ph-empty' }, h('div', { html: appIcon('photos') }), h('p', { text: 'No pictures yet.' }), h('p', { class: 'muted', text: 'Import photos from your computer or draw something in Paint.' })));
    for (const n of imgs) {
      const b = h('button', { class: 'ph-thumb', 'aria-label': n.name, html: `<img src="${FS.read(n.id)}" alt="" loading="lazy" decoding="async"><span>${esc(n.name)}</span>` });
      b.addEventListener('click', () => view(n.id));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); Menu.show(fileMenuItems(n.id, { within: api.win, onOpen: view }), e.clientX, e.clientY); });
      grid.append(b);
    }
    root.append(head, grid);
  }
  function view(id) {
    const n = FS.get(id); if (!n) { gallery(); return; }
    Object.assign(st, { mode: 'view', id, zoom: 1, fit: true, rot: 0, px: 0, py: 0 });
    api.setTitle(n.name + ' – Photos');
    root.innerHTML = `
      <div class="ph-bar">
        <button class="ibtn" data-act="gallery" aria-label="Back to gallery" data-tip="Gallery">${ui('arrowL')}</button>
        <span class="ph-name">${esc(n.name)}</span><span class="grow"></span>
        <button class="ibtn" data-act="zoomout" aria-label="Zoom out" data-tip="Zoom out">${ui('zoomOut')}</button>
        <span class="ph-zoom num">100%</span>
        <button class="ibtn" data-act="zoomin" aria-label="Zoom in" data-tip="Zoom in">${ui('zoomIn')}</button>
        <button class="ibtn" data-act="fit" aria-label="Fit to window" data-tip="Fit to window">${ui('fit')}</button>
        <button class="ibtn" data-act="rotate" aria-label="Rotate" data-tip="Rotate">${ui('rotate')}</button>
        <span class="vsep"></span>
        <button class="cbtn" data-act="wall">${ui('desktop')}<span>Set as wallpaper</span></button>
        <button class="ibtn" data-act="edit" aria-label="Edit in Paint" data-tip="Edit in Paint">${ui('brush')}</button>
        <button class="ibtn" data-act="info" aria-label="File info" data-tip="File info">${ui('info')}</button>
        <button class="ibtn" data-act="delete" aria-label="Delete" data-tip="Delete">${ui('trash')}</button>
      </div>
      <div class="ph-stage" tabindex="0" aria-label="${esc(n.name)}"><img class="ph-img" alt="${esc(n.name)}" draggable="false">
        <button class="ph-nav prev" data-act="prev" aria-label="Previous picture">${ui('chevL')}</button>
        <button class="ph-nav next" data-act="next" aria-label="Next picture">${ui('chevR')}</button>
        <aside class="ph-info" hidden></aside>
      </div>`;
    const img = root.querySelector('.ph-img'); const stage = root.querySelector('.ph-stage');
    img.onload = () => layout();
    img.src = FS.read(id);
    const sib = siblings();
    root.querySelector('.prev').hidden = sib.length < 2; root.querySelector('.next').hidden = sib.length < 2;
    renderInfo();
    stage.focus({ preventScroll: true });
    let drag = null;
    stage.addEventListener('pointerdown', (e) => { if (e.target.closest('button, aside')) return; drag = { x: e.clientX, y: e.clientY, px: st.px, py: st.py }; stage.setPointerCapture(e.pointerId); stage.classList.add('panning'); });
    stage.addEventListener('pointermove', (e) => { if (!drag) return; st.px = drag.px + e.clientX - drag.x; st.py = drag.py + e.clientY - drag.y; apply(); });
    const endDrag = () => { drag = null; stage.classList.remove('panning'); };
    stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    stage.addEventListener('dblclick', (e) => { if (e.target.closest('button')) return; if (st.fit) zoomBy(2); else { st.fit = true; st.px = st.py = 0; layout(); } });
  }
  function fitScale() {
    const img = root.querySelector('.ph-img'), stage = root.querySelector('.ph-stage'); if (!img || !img.naturalWidth) return 1;
    const rotated = st.rot % 180 !== 0; const iw = rotated ? img.naturalHeight : img.naturalWidth, ih = rotated ? img.naturalWidth : img.naturalHeight;
    return Math.min((stage.clientWidth - 48) / iw, (stage.clientHeight - 48) / ih, 1);
  }
  function layout() { if (st.fit) { st.zoom = fitScale(); st.px = st.py = 0; } apply(); }
  function apply() {
    const img = root.querySelector('.ph-img'); if (!img) return;
    img.style.transform = `translate(-50%, -50%) translate(${st.px}px, ${st.py}px) rotate(${st.rot}deg) scale(${st.zoom})`;
    const z = root.querySelector('.ph-zoom'); if (z) z.textContent = Math.round(st.zoom * 100) + '%';
  }
  function zoomBy(f) { st.fit = false; st.zoom = clamp(st.zoom * f, 0.05, 16); apply(); }
  function step(d) { const sib = siblings(); if (sib.length < 2) return; const i = sib.findIndex((x) => x.id === st.id); view(sib[(i + d + sib.length) % sib.length].id); }
  function renderInfo() {
    const box = root.querySelector('.ph-info'); const n = FS.get(st.id); if (!box || !n) return;
    box.hidden = !st.info;
    if (!st.info) return;
    const img = root.querySelector('.ph-img');
    box.innerHTML = `<h3>Info</h3><dl class="props"><dt>Name</dt><dd>${esc(n.name)}</dd><dt>Size</dt><dd>${fmtBytes(n.size || 0)}</dd><dt>Dimensions</dt><dd>${img.naturalWidth ? img.naturalWidth + ' × ' + img.naturalHeight : 'Loading'}</dd><dt>Folder</dt><dd>${esc(FS.parentName(n.id))}</dd><dt>Modified</dt><dd>${esc(fmtDate(n.modified))}</dd></dl>`;
  }
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    if (a === 'gallery') gallery();
    else if (a === 'zoomin') zoomBy(1.25);
    else if (a === 'zoomout') zoomBy(0.8);
    else if (a === 'fit') { st.fit = true; layout(); }
    else if (a === 'rotate') { st.rot = (st.rot + 90) % 360; layout(); }
    else if (a === 'prev') step(-1);
    else if (a === 'next') step(1);
    else if (a === 'wall') { S.set('wallpaper', 'file:' + st.id); Notif.push({ app: 'photos', title: 'Wallpaper changed', body: FS.get(st.id)?.name || '', silent: true }); }
    else if (a === 'edit') WM.open('paint', { file: st.id });
    else if (a === 'info') { st.info = !st.info; renderInfo(); }
    else if (a === 'delete') { const id = st.id; const sib = siblings(); const i = sib.findIndex((x) => x.id === id); deleteNodes([id], api.win).then(() => { if (!FS.get(id) || FS.inTrash(id)) { const rest = sib.filter((x) => x.id !== id); if (rest.length) view(rest[Math.min(i, rest.length - 1)].id); else gallery(); } }); }
  });
  root.addEventListener('keydown', (e) => {
    if (st.mode !== 'view' || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
    else if (e.key === '+' || e.key === '=') zoomBy(1.25); else if (e.key === '-') zoomBy(0.8);
    else if (e.key === '0') { st.fit = true; layout(); }
    else if (e.key === 'Delete') root.querySelector('[data-act="delete"]').click();
    else if (e.key === 'Escape' || e.key === 'Backspace') gallery();
    else return;
    e.preventDefault();
  });
  const ro = new ResizeObserver(() => { if (st.mode === 'view' && st.fit) layout(); });
  ro.observe(root); api.onClose(() => ro.disconnect());
  api.on('fs', () => { if (st.mode === 'gallery') gallery(); else if (!FS.get(st.id) || FS.inTrash(st.id)) gallery(); });
  api.onArgs = (a) => { if (a.file && FS.get(a.file)) view(a.file); else gallery(); };
  if (args.file && FS.get(args.file)) view(args.file); else gallery();
}
