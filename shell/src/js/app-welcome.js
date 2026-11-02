/* ========== Welcome ========== */
function mountWelcome(root, api) {
  root.classList.add('app-welcome');
  let touched = false;
  api.win.untouched = () => !touched;
  function features() {
    const f = [
      ['shield', 'No ads or suggested apps', 'Start and search show your apps and files only.'],
      ['person', 'No account to create', 'There is nothing to sign in to.'],
      ['layout', 'Snap layouts', 'Drag a window to a screen edge, or hover its maximize button.'],
      ['more', 'Full right-click menus', 'Every option shows at once, with no second menu to open.'],
      ['desktop', 'A taskbar that moves', 'Put it at the top, align it left, or let it float.'],
      ['search', 'Search that stays on your PC', 'Ctrl+K finds apps, files and settings, and does quick math.'],
    ];
    if (caps.sample) f.splice(2, 0, ['sparkle', 'An assistant that can act', 'Ask it to open apps, change settings or write files for you.']);
    if (Store.status.cloud === 'on') f.splice(3, 0, ['cloud', 'Follows you to any device', 'Your files and settings sync to your Claude account.']);
    return f.slice(0, 7);
  }
  function render() {
    root.innerHTML = '';
    const wrap = h('div', { class: 'wl' });
    const hero = h('div', { class: 'wl-hero' }, h('span', { class: 'wl-logo', html: appIcon('logo') }), h('div', {}, h('h1', { class: 'wl-title' }, 'Welcome to ', h('span', { class: 'wl-os', text: osName() })), h('p', { class: 'wl-sub', text: IS_NATIVE ? 'Your own operating system, running on this computer. Make it yours in a few seconds, then get to work.' : 'Your own desktop, running right in this tab. Make it yours in a few seconds, then get to work.' })));
    const osInp = h('input', { class: 'field', id: api.id + '-os', value: S.data.osName, maxlength: 24, 'aria-label': 'Name your OS' });
    const nameInp = h('input', { class: 'field', id: api.id + '-user', value: S.data.userName, maxlength: 32, placeholder: 'Your name', 'aria-label': 'Your name' });
    osInp.addEventListener('input', debounce(() => { touched = true; S.set('osName', osInp.value.trim() || 'Nimbus'); hero.querySelector('.wl-os').textContent = osName(); go.textContent = 'Start using ' + osName(); }, 200));
    nameInp.addEventListener('input', debounce(() => { touched = true; S.set('userName', nameInp.value.trim()); }, 300));
    const theme = h('div', { class: 'seg', role: 'group', 'aria-label': 'Theme' });
    for (const [v, l] of [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']]) { const b = h('button', { text: l, 'aria-pressed': String(S.data.theme === v) }); b.onclick = () => { touched = true; S.set('theme', v); theme.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; theme.append(b); }
    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent color' });
    for (const c of ACCENTS.slice(0, 10)) { const b = h('button', { class: 'swatch', role: 'radio', 'aria-label': 'Accent ' + c, 'aria-pressed': String(S.data.accent === c) }); b.style.setProperty('--c', c); b.onclick = () => { touched = true; S.set('accent', c); sw.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; sw.append(b); }
    const walls = h('div', { class: 'wl-walls', role: 'radiogroup', 'aria-label': 'Wallpaper' });
    for (const w of WALLS.slice(0, 6)) { const b = h('button', { class: 'wall-tile', 'aria-label': 'Wallpaper ' + w.name, 'aria-pressed': String(S.data.wallpaper === w.id), html: `<img src="${wallThumb(w.id)}" alt="">` }); b.onclick = () => { touched = true; S.set('wallpaper', w.id); walls.querySelectorAll('.wall-tile').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }; walls.append(b); }
    const field = (label, el, forId) => h('div', { class: 'wl-field' }, forId ? h('label', { for: forId, text: label }) : h('span', { class: 'lbl', text: label }), el);
    const left = h('section', { class: 'wl-card' }, h('h2', { text: 'Make it yours' }),
      field('Name your OS', osInp, osInp.id), field('What should we call you?', nameInp, nameInp.id),
      IS_NATIVE ? h('div', { class: 'wl-row' }, field('Time zone', buildTzSelect(api.id + '-tz'), api.id + '-tz'), field('Theme', theme)) : field('Theme', theme),
      field('Accent color', sw), field('Wallpaper', walls));
    const list = h('ul', { class: 'wl-list' });
    for (const [ic, t, d] of features()) list.append(h('li', {}, h('span', { class: 'wl-ic', html: ui(ic) }), h('div', {}, h('b', { text: t }), h('span', { class: 'muted', text: d }))));
    const right = h('section', { class: 'wl-card' }, h('h2', { text: 'What is better here' }), list);
    const sync = Store.cloudLabel();
    const go = h('button', { class: 'btn primary', text: 'Start using ' + osName() });
    go.addEventListener('click', () => { S.set('setupDone', true); api.close(); Sound.play('startup'); });
    const saveLink = IS_NATIVE && Native.live && !Storage.saving ? h('button', { class: 'linkbtn', text: 'Set up saving', onclick: () => Storage.open() }) : null;
    const foot = h('div', { class: 'wl-foot' }, h('span', { class: 'wl-sync muted', html: ui(sync.icon) + `<span>${esc(sync.title)}</span>` }), saveLink, h('span', { class: 'grow' }), go);
    wrap.append(hero, h('div', { class: 'wl-grid' }, left, right), foot);
    root.append(wrap);
  }
  api.on('caps', () => { if (!touched) render(); });
  api.on('store', () => { if (!touched) render(); else { const s = root.querySelector('.wl-sync'); const l = Store.cloudLabel(); if (s) s.innerHTML = ui(l.icon) + `<span>${esc(l.title)}</span>`; } });
  root.addEventListener('pointerdown', () => { touched = true; });
  render();
}
