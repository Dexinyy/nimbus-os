/* ========== Settings: Personalization, Apps, Accounts ========== */
// Windows 11's accent palette, six rows of eight
const WIN_COLORS = ['#ffb900', '#ff8c00', '#f7630c', '#ca5010', '#da3b01', '#ef6950', '#d13438', '#ff4343', '#e74856', '#e81123', '#ea005e', '#c30052', '#e3008c', '#bf0077', '#c239b3', '#9a0089',
  '#0078d4', '#0063b1', '#8e8cd8', '#6b69d6', '#8764b8', '#744da9', '#b146c2', '#881798', '#0099bc', '#2d7d9a', '#00b7c3', '#038387', '#00b294', '#018574', '#00cc6a', '#10893e',
  '#7a7574', '#5d5a58', '#68768a', '#515c6b', '#567c73', '#486860', '#498205', '#107c10', '#767676', '#4c4a48', '#69797e', '#4a5459', '#647c64', '#525e54', '#847545', '#7e735f'];
const ACCENTS = ['#0078d4', '#0099bc', '#038387', '#10893e', '#498205', '#ffb900', '#ca5010', '#d13438', '#e3008c', '#8764b8', '#6b69d6', '#68768a'];
const BG_COLORS = ['#ff8c00', '#e81123', '#d13438', '#c30052', '#bf0077', '#9a0089', '#881798', '#744da9', '#10893e', '#107c10', '#018574', '#2d7d9a', '#0063b1', '#6b69d6', '#8e8cd8', '#8764b8', '#038387', '#486860', '#525e54', '#7e735f', '#4c4a48', '#515c6b', '#4a5459', '#000000'];
function browserName() {
  const brands = (navigator.userAgentData?.brands || []).filter((x) => !/Not.?A.?Brand|Chromium/i.test(x.brand));
  if (brands.length) return brands[0].brand + ' ' + brands[0].version;
  const ua = navigator.userAgent; let m;
  if ((m = ua.match(/Edg\/(\d+)/))) return 'Edge ' + m[1];
  if ((m = ua.match(/Firefox\/(\d+)/))) return 'Firefox ' + m[1];
  if ((m = ua.match(/Chrome\/(\d+)/))) return 'Chrome ' + m[1];
  if ((m = ua.match(/Version\/(\d+).*Safari/))) return 'Safari ' + m[1];
  return 'Your browser';
}
function setAccent(c) { S.set('accentAuto', false); S.set('accent', c); S.set('recentAccents', [c, ...(S.data.recentAccents || []).filter((x) => x !== c)].slice(0, 5)); }
function swatchGrid(ctx, colors, get, set, label) {
  const box = h('div', { class: 'ws-swatches', role: 'radiogroup', 'aria-label': label });
  const btns = colors.map((c) => { const b = h('button', { class: 'ws-swatch', role: 'radio', 'aria-label': c, 'data-tip': c }); b.style.setProperty('--c', c); b.addEventListener('click', (e) => { e.stopPropagation(); set(c); }); box.append(b); return [c, b]; });
  const paint = () => btns.forEach(([c, b]) => b.setAttribute('aria-checked', String(String(get()).toLowerCase() === c)));
  ctx.sync(paint); paint();
  return box;
}
function colorPicker(get, set, label = 'View colors') {
  const inp = h('input', { type: 'color', class: 'ws-colorinp', value: get(), 'aria-label': label });
  inp.addEventListener('input', debounce(() => set(inp.value), 80));
  inp.addEventListener('click', (e) => e.stopPropagation());
  const b = WS.button(label, () => inp.click());
  return h('span', { class: 'ws-colorpick' }, b, inp);
}
/* The little desktop in Personalization's pages */
function desktopPreview(ctx, { lock } = {}) {
  const el = h('div', { class: 'ws-preview' + (lock ? ' lock' : ''), 'aria-hidden': 'true' });
  const paint = () => {
    el.dataset.theme = effectiveTheme();
    const url = lock && S.data.lockWall ? wallThumb(S.data.lockWall) : currentWallURL;
    el.style.backgroundImage = S.data.wallMode === 'solid' && !lock ? 'none' : `url("${url}")`;
    el.style.backgroundColor = S.data.wallColor || '#0063b1';
    el.style.backgroundSize = { fit: 'contain', stretch: '100% 100%', tile: 'auto', center: 'auto' }[S.data.wallFit] || 'cover';
    el.style.backgroundRepeat = S.data.wallFit === 'tile' ? 'repeat' : 'no-repeat';
    el.innerHTML = lock ? `<div class="ws-pv-lock"><b>${esc(fmtTime(false, true))}</b><span>${esc(fmtDT(Date.now(), { weekday: 'long', month: 'long', day: 'numeric' }))}</span></div>`
      : `<div class="ws-pv-win"><i></i><span></span><span></span></div><div class="ws-pv-bar"><i></i><i></i><i></i><i></i></div>`;
  };
  ctx.sync(paint); paint();
  return el;
}

/* ---------- Personalization ---------- */
defPage('personalization', { title: 'Personalization', icon: 'personalization', keywords: 'theme wallpaper colors lock screen start taskbar fonts', render: (ctx) => [
  h('div', { class: 'ws-pz-head' }, desktopPreview(ctx), h('div', { class: 'ws-pz-themes' }, h('div', { class: 'ws-t', text: 'Select a theme to apply' }), h('div', { class: 'ws-theme-grid' }, ...THEMES.slice(0, 6).map((t) => themeThumb(ctx, t))))),
  WS.group(null,
    WS.card(ctx, { icon: 'background', title: 'Background', desc: 'Background image, color, slideshow', go: 'background' }),
    WS.card(ctx, { icon: 'colors', title: 'Colors', desc: 'Accent color, transparency effects, color theme', go: 'colors' }),
    WS.card(ctx, { icon: 'themes', title: 'Themes', desc: 'Install, create, manage', go: 'themes' }),
    WS.card(ctx, { icon: 'lockScreen', title: 'Lock screen', desc: 'Lock screen images, startup', go: 'lockscreen' }),
    WS.card(ctx, { icon: 'start', title: 'Start', desc: 'Recent apps and items, folders', go: 'start' }),
    WS.card(ctx, { icon: 'taskbar', title: 'Taskbar', desc: 'Taskbar behaviors, pinned apps', go: 'taskbar' }),
    WS.card(ctx, { icon: 'fonts', title: 'Fonts', desc: 'Install, manage', go: 'fonts' })),
] });

defPage('background', { title: 'Background', parent: 'personalization', icon: 'background', keywords: 'wallpaper desktop picture photo slideshow solid color fit', render: (ctx) => {
  const mode = S.data.wallMode || 'picture';
  const recent = h('div', { class: 'ws-wallrow' });
  const tiles = [];
  const addTile = (id, label, src) => { const b = h('button', { class: 'ws-wall', 'aria-label': 'Background ' + label, 'data-tip': label, html: `<img src="${src}" alt="" loading="lazy">` }); b.addEventListener('click', (e) => { e.stopPropagation(); S.set('wallMode', 'picture'); S.set('wallpaper', id); }); recent.append(b); tiles.push([id, b]); };
  const pics = Object.values(FS.nodes).filter((x) => x.kind === 'image' && !FS.inTrash(x.id)).sort((a, b) => b.modified - a.modified).slice(0, 6);
  if (String(S.data.wallpaper).startsWith('file:') && !pics.some((n) => 'file:' + n.id === S.data.wallpaper)) { const n = FS.get(S.data.wallpaper.slice(5)); if (n) pics.unshift(n); }
  for (const n of pics) addTile('file:' + n.id, n.name, FS.read(n.id));
  for (const w of WALLS) addTile(w.id, w.name, wallThumb(w.id));
  ctx.sync(() => tiles.forEach(([id, b]) => b.setAttribute('aria-pressed', String(S.data.wallpaper === id))));
  tiles.forEach(([id, b]) => b.setAttribute('aria-pressed', String(S.data.wallpaper === id)));
  const browse = WS.button('Browse photos', async () => { const f = await pickFiles('image/*', false); if (!f.length) return; const made = await importFiles(f, 'pictures'); if (made[0]) { S.set('wallMode', 'picture'); S.set('wallpaper', 'file:' + made[0].id); ctx.rerender(); } });
  const modeCombo = WS.combo(ctx, [['picture', 'Picture'], ['solid', 'Solid color'], ['slideshow', 'Slideshow']], () => S.data.wallMode || 'picture', (v) => { S.set('wallMode', v); ctx.rerender(); }, 'Personalize your background', { width: 160 });
  const out = [h('div', { class: 'ws-pz-head single' }, desktopPreview(ctx)),
    WS.group(null, WS.expander(ctx, { sid: 'wallMode', icon: 'background', title: 'Personalize your background', desc: mode === 'slideshow' ? 'A picture album changes the background on a schedule' : '', ctl: modeCombo, open: true, items: () => mode === 'solid'
      ? [WS.sub({ title: 'Choose your background color' }), h('div', { class: 'ws-sub' }, swatchGrid(ctx, BG_COLORS, () => S.data.wallColor, (c) => S.set('wallColor', c), 'Background color')), WS.sub({ title: 'Custom colors', ctl: colorPicker(() => S.data.wallColor || '#0063b1', (c) => S.set('wallColor', c)) })]
      : mode === 'slideshow'
        ? [WS.sub({ title: 'Choose a picture album for a slideshow', ctl: WS.settingCombo(ctx, 'slideSource', [['builtin', 'Nimbus backgrounds'], ['pictures', 'Pictures folder']], 'Picture album', { width: 190 }) }),
          WS.sub({ title: 'Change picture every', ctl: WS.settingCombo(ctx, 'slideEvery', [[1, '1 minute'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [360, '6 hours'], [1440, '1 day']], 'Change picture every', { width: 150 }) }),
          WS.sub({ title: 'Shuffle the picture order', ctl: WS.settingToggle(ctx, 'slideShuffle', 'Shuffle') })]
        : [WS.sub({ title: 'Recent images' }), h('div', { class: 'ws-sub' }, recent), WS.sub({ title: 'Choose a photo', ctl: browse })] })),
  ];
  if (mode !== 'solid') out.push(WS.group(null, WS.card(ctx, { sid: 'wallFit', icon: 'scale', title: 'Choose a fit for your desktop image', ctl: WS.settingCombo(ctx, 'wallFit', [['fill', 'Fill'], ['fit', 'Fit'], ['stretch', 'Stretch'], ['tile', 'Tile'], ['center', 'Center']], 'Fit', { width: 120 }) })));
  out.push(WS.group('Related settings', WS.card(ctx, { icon: 'contrast', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', go: 'contrast' })));
  return out;
} });
defSettings('background', [['wallMode', 'Personalize your background', 'wallpaper slideshow solid color picture'], ['wallFit', 'Choose a fit for your desktop image', 'fill fit stretch tile center']]);

defPage('colors', { title: 'Colors', parent: 'personalization', icon: 'colors', keywords: 'dark mode light mode accent color transparency', render: (ctx) => [
  h('div', { class: 'ws-pz-head single' }, desktopPreview(ctx)),
  WS.group(null,
    WS.card(ctx, { sid: 'theme', icon: 'contrast', title: 'Choose your mode', desc: 'Change the colors that appear in Nimbus and your apps', ctl: WS.settingCombo(ctx, 'theme', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Automatic']], 'Choose your mode', { width: 140 }) }),
    WS.card(ctx, { sid: 'transparency', icon: 'visualEffects', title: 'Transparency effects', desc: IS_NATIVE && Native.info && Native.info.software ? 'Windows and surfaces look frosted. It needs graphics acceleration, which this PC doesn’t have.' : 'Windows and surfaces appear translucent', ctl: WS.settingToggle(ctx, 'transparency', 'Transparency effects') }),
    WS.expander(ctx, { sid: 'accent', icon: 'colors', title: 'Accent color', ctl: WS.combo(ctx, [['manual', 'Manual'], ['auto', 'Automatic']], () => (S.data.accentAuto ? 'auto' : 'manual'), (v) => S.set('accentAuto', v === 'auto'), 'Accent color', { width: 130 }), open: true, items: [
      (S.data.recentAccents || []).length ? WS.sub({ title: 'Recent colors' }) : null,
      (S.data.recentAccents || []).length ? h('div', { class: 'ws-sub' }, swatchGrid(ctx, S.data.recentAccents, () => S.data.accent, setAccent, 'Recent colors')) : null,
      WS.sub({ title: 'Accent colors' }), h('div', { class: 'ws-sub' }, swatchGrid(ctx, WIN_COLORS, () => S.data.accent, setAccent, 'Accent colors')),
      WS.sub({ title: 'Custom colors', ctl: colorPicker(() => S.data.accent, setAccent) }),
    ] }),
    WS.card(ctx, { sid: 'accentBar', icon: 'taskbar', title: 'Show accent color on Start and taskbar', desc: effectiveTheme() === 'dark' ? '' : 'Works in dark mode', ctl: WS.toggle(ctx, () => !!S.data.accentBar && effectiveTheme() === 'dark', (v) => S.set('accentBar', v), 'Show accent color on Start and taskbar', { disabled: () => effectiveTheme() !== 'dark' }) }),
    WS.card(ctx, { sid: 'accentTitle', icon: 'window', title: 'Show accent color on title bars and window borders', ctl: WS.settingToggle(ctx, 'accentTitle', 'Show accent color on title bars') })),
  WS.group('Related settings', WS.card(ctx, { icon: 'contrast', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', go: 'contrast' })),
] });
defSettings('colors', [['theme', 'Dark mode and light mode', 'theme appearance night'], ['transparency', 'Transparency effects', 'blur glass acrylic mica'], ['accent', 'Accent color', 'highlight color'], ['accentBar', 'Show accent color on Start and taskbar', 'color taskbar'], ['accentTitle', 'Show accent color on title bars and window borders', 'title bar color']]);

defPage('themes', { title: 'Themes', parent: 'personalization', icon: 'themes', keywords: 'theme save custom desktop icons', render: (ctx) => {
  const wallName = () => { const id = S.data.wallpaper; if (S.data.wallMode === 'solid') return 'Solid color'; if (S.data.wallMode === 'slideshow') return 'Slideshow'; if (String(id).startsWith('file:')) return FS.get(id.slice(5))?.name || 'Picture'; return (WALLS.find((w) => w.id === id) || {}).name || id; };
  const cur = THEMES.find((t) => S.data.wallpaper === t.wallpaper && S.data.accent === t.accent && S.data.theme === t.theme);
  const mine = (S.data.myThemes || []);
  const grid = h('div', { class: 'ws-theme-grid big' }, ...THEMES.map((t) => themeThumb(ctx, t, 'lg')), ...mine.map((t) => {
    const b = themeThumb(ctx, t, 'lg');
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); Menu.show([{ label: 'Delete', icon: 'trash', action: () => { S.set('myThemes', mine.filter((x) => x.id !== t.id)); ctx.rerender(); } }], e.clientX, e.clientY); });
    return b;
  }));
  return [
    h('div', { class: 'ws-pz-head' }, desktopPreview(ctx), h('div', { class: 'ws-theme-cur' }, h('div', { class: 'ws-d', text: 'Current theme' }), h('div', { class: 'ws-hero-name', text: cur ? cur.name : 'Custom' }),
      h('div', { class: 'ws-theme-parts' }, ...[['background', 'Background', wallName()], ['colors', 'Color', S.data.accent.toUpperCase()], ['sound', 'Sounds', 'Nimbus default'], ['mouse', 'Mouse cursor', 'Nimbus default']].map(([ic, t, v]) => h('div', { class: 'ws-theme-part', html: `${fi(ic)}<span><b>${esc(t)}</b><span class="ws-d">${esc(v)}</span></span>` }))))),
    WS.group(null, WS.card(ctx, { icon: 'themes', title: 'Current theme: ' + (cur ? cur.name : 'Custom'), ctl: WS.button('Save', async () => {
      const name = await Dialog.prompt('Save your theme', { label: 'Name your theme', value: 'My theme', ok: 'Save', within: ctx.win });
      if (!name) return;
      S.set('myThemes', [...mine, { id: 'my-' + uid(), name: name.trim().slice(0, 30), wallpaper: S.data.wallpaper, theme: S.data.theme, accent: S.data.accent }]); ctx.rerender();
    }) })),
    WS.group('Change theme', h('div', { class: 'ws-card ws-gridcard', 'data-sid': 'themeList' }, grid)),
    WS.group('Related settings',
      WS.card(ctx, { sid: 'showDesktopIcons', icon: 'grid', title: 'Desktop icons', desc: 'Show the icons and files on your desktop', ctl: WS.settingToggle(ctx, 'showDesktopIcons', 'Desktop icons') }),
      WS.card(ctx, { icon: 'contrast', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', go: 'contrast' })),
  ];
} });
defSettings('themes', [['showDesktopIcons', 'Desktop icons', 'show hide icons desktop']]);

defPage('lockscreen', { title: 'Lock screen', parent: 'personalization', icon: 'lockScreen', keywords: 'lock screen picture startup', render: (ctx) => {
  const row = h('div', { class: 'ws-wallrow' });
  for (const w of WALLS) { const b = h('button', { class: 'ws-wall', 'aria-label': 'Lock screen ' + w.name, 'data-tip': w.name, html: `<img src="${wallThumb(w.id)}" alt="" loading="lazy">` }); b.addEventListener('click', (e) => { e.stopPropagation(); S.set('lockWall', w.id); }); ctx.sync(() => b.setAttribute('aria-pressed', String(S.data.lockWall === w.id))); b.setAttribute('aria-pressed', String(S.data.lockWall === w.id)); row.append(b); }
  return [
    h('div', { class: 'ws-pz-head single' }, desktopPreview(ctx, { lock: true })),
    WS.group(null,
      WS.expander(ctx, { sid: 'lockWall', icon: 'background', title: 'Personalize your lock screen', ctl: WS.combo(ctx, [['same', 'Same as desktop'], ['picture', 'Picture']], () => (S.data.lockWall ? 'picture' : 'same'), (v) => { S.set('lockWall', v === 'picture' ? (S.data.lockWall || WALLS[1].id) : ''); ctx.rerender(); }, 'Personalize your lock screen', { width: 170 }), open: !!S.data.lockWall, items: [h('div', { class: 'ws-sub' }, row)] }),
      WS.card(ctx, { sid: 'lockOnStart', icon: 'lock', title: 'Show the lock screen at startup', ctl: WS.settingToggle(ctx, 'lockOnStart', 'Show the lock screen at startup') })),
    WS.group('Related settings',
      WS.card(ctx, { icon: 'screenOff', title: 'Screen timeout', go: 'power' }),
      WS.card(ctx, { icon: 'signIn', title: 'Sign-in options', desc: 'PIN for the lock screen', go: 'signin' }),
      WS.card(ctx, { icon: 'lock', title: 'Lock now', ctl: WS.button('Lock', () => Power.lock()) })),
  ];
} });
defSettings('lockscreen', [['lockWall', 'Lock screen picture', 'lock background'], ['lockOnStart', 'Show the lock screen at startup', 'boot login']]);

const START_FOLDERS = [['settings', 'Settings', 'settings'], ['files', 'Files', 'folder'], ['documents', 'Documents', 'document'], ['downloads', 'Downloads', 'download'], ['music', 'Music', 'music'], ['pictures', 'Pictures', 'background'], ['videos', 'Videos', 'video'], ['home', 'Personal folder', 'personCircle']];
defPage('start', { title: 'Start', parent: 'personalization', icon: 'start', keywords: 'start menu layout pins recommended recent folders', render: (ctx) => {
  const layout = (v, label) => { const b = h('button', { class: 'ws-layoutpick', role: 'radio', html: `<span class="ws-lp-art ${v}"><i></i><i></i><i></i></span><span>${esc(label)}</span>` }); b.addEventListener('click', (e) => { e.stopPropagation(); S.set('startLayout', v); }); ctx.sync(() => b.setAttribute('aria-checked', String((S.data.startLayout || 'default') === v))); b.setAttribute('aria-checked', String((S.data.startLayout || 'default') === v)); return b; };
  return [
    WS.group(null,
      WS.card(ctx, { sid: 'startLayout', icon: 'start', title: 'Layout', ctl: h('div', { class: 'ws-layoutpicks', role: 'radiogroup', 'aria-label': 'Start layout' }, layout('pins', 'More pins'), layout('default', 'Default'), layout('recs', 'More recommendations')) }),
      WS.card(ctx, { sid: 'startAdded', icon: 'add', title: 'Show recently added apps', ctl: WS.settingToggle(ctx, 'startAdded', 'Show recently added apps') }),
      WS.card(ctx, { sid: 'startMostUsed', icon: 'star', title: 'Show most used apps', ctl: WS.settingToggle(ctx, 'startMostUsed', 'Show most used apps') }),
      WS.card(ctx, { sid: 'startRecent', icon: 'history', title: 'Show recommended files in Start and recent files in Files', ctl: WS.settingToggle(ctx, 'startRecent', 'Show recommended files') }),
      WS.card(ctx, { icon: 'info', title: 'Tips, ads and suggested apps', desc: 'Nimbus never shows any, so there’s nothing to turn off' }),
      WS.card(ctx, { sid: 'startFolders', icon: 'folder', title: 'Folders', desc: 'These folders appear on Start next to the Power button', go: 'startfolders' })),
  ];
} });
defSettings('start', [['startLayout', 'Start layout', 'pins recommendations'], ['startRecent', 'Show recommended files in Start', 'recent'], ['startMostUsed', 'Show most used apps', 'frequent'], ['startFolders', 'Start folders', 'power button']]);
defPage('startfolders', { title: 'Folders', parent: 'start', icon: 'folder', noRecent: true, keywords: '', render: (ctx) => [WS.group(null, ...START_FOLDERS.map(([id, label, icon]) => WS.card(ctx, { icon, title: label, ctl: WS.toggle(ctx, () => (S.data.startFolders || []).includes(id), (v) => S.set('startFolders', v ? [...(S.data.startFolders || []), id] : (S.data.startFolders || []).filter((x) => x !== id)), label) })))] });

defPage('taskbar', { title: 'Taskbar', parent: 'personalization', icon: 'taskbar', keywords: 'taskbar alignment hide search task view pins', render: (ctx) => [
  WS.group(null, WS.expander(ctx, { sid: 'tbItems', icon: 'taskbar', title: 'Taskbar items', desc: 'Show or hide buttons that appear on the taskbar', open: true, items: [
    WS.sub({ title: 'Search', sid: 'tbSearch', ctl: WS.combo(ctx, [['hide', 'Hide'], ['icon', 'Search icon only'], ['label', 'Search icon and label'], ['box', 'Search box']], () => (S.data.tbSearch === false ? 'hide' : S.data.tbSearch === true ? 'icon' : S.data.tbSearch), (v) => S.set('tbSearch', v === 'hide' ? false : v), 'Search', { width: 200 }) }),
    WS.sub({ title: 'Task view', ctl: WS.settingToggle(ctx, 'tbTaskView', 'Task view') }),
    caps.sample ? WS.sub({ title: 'Assistant', ctl: WS.settingToggle(ctx, 'tbAssist', 'Assistant') }) : null,
  ] })),
  WS.group(null, WS.expander(ctx, { sid: 'tbPins', icon: 'pin', title: 'Pinned apps', desc: 'Apps pinned to the taskbar', items: () => Object.keys(APPS).filter(appListed).map((id) => WS.sub({ title: h('span', { class: 'ws-appname', html: `<span class="ws-appic sm">${appIcon(APPS[id].icon)}</span>${esc(APPS[id].name)}` }), ctl: WS.toggle(ctx, () => S.data.pinned.includes(id), (v) => S.set('pinned', v ? [...S.data.pinned, id] : S.data.pinned.filter((x) => x !== id)), 'Pin ' + APPS[id].name) })) })),
  WS.group(null, WS.expander(ctx, { sid: 'tbBehaviors', icon: 'options', title: 'Taskbar behaviors', desc: 'Taskbar alignment, badging, automatically hide', open: true, items: [
    WS.sub({ title: 'Taskbar alignment', sid: 'tbAlign', ctl: WS.settingCombo(ctx, 'tbAlign', [['center', 'Center'], ['left', 'Left']], 'Taskbar alignment', { width: 120 }) }),
    WS.sub({ title: 'Taskbar position on screen', sid: 'tbPos', ctl: WS.settingCombo(ctx, 'tbPos', [['bottom', 'Bottom'], ['top', 'Top']], 'Taskbar position', { width: 120 }) }),
    WS.sub({ sid: 'tbAutoHide', ctl: WS.checkbox(ctx, 'Automatically hide the taskbar', () => S.data.tbAutoHide, (v) => S.set('tbAutoHide', v)) }),
    WS.sub({ sid: 'tbFloat', ctl: WS.checkbox(ctx, 'Floating taskbar with rounded corners', () => S.data.tbFloat, (v) => S.set('tbFloat', v)) }),
    WS.sub({ ctl: WS.checkbox(ctx, 'Show badges on taskbar apps', () => S.data.tbBadges, (v) => S.set('tbBadges', v)) }),
    WS.sub({ sid: 'clockSeconds', ctl: WS.checkbox(ctx, 'Show seconds in system tray clock', () => S.data.clockSeconds, (v) => S.set('clockSeconds', v)) }),
    WS.sub({ ctl: WS.checkbox(ctx, 'Select the far corner of the taskbar to show the desktop', () => S.data.tbDeskCorner, (v) => S.set('tbDeskCorner', v)) }),
  ] })),
] });
defSettings('taskbar', [['tbSearch', 'Taskbar search', 'search box icon'], ['tbAlign', 'Taskbar alignment', 'center left start button'], ['tbPos', 'Taskbar position', 'top bottom'], ['tbAutoHide', 'Automatically hide the taskbar', 'auto hide'], ['tbPins', 'Pinned apps', 'pin unpin taskbar shortcuts'], ['clockSeconds', 'Show seconds in the clock', 'time'], ['tbFloat', 'Floating taskbar', 'rounded margin']]);

/* ---------- Fonts ---------- */
const WEB_FONTS = [['Selawik', 'Nimbus’s interface'], ['Segoe UI', ''], ['JetBrains Mono', 'Terminal'], ['Figtree', ''], ['Sora', ''], ['Georgia', ''], ['Arial', ''], ['Times New Roman', ''], ['Courier New', ''], ['Verdana', '']];
async function fontInstall(ctx, files) {
  let n = 0;
  for (const f of files) {
    if (!/\.(ttf|otf|woff2?|ttc)$/i.test(f.name)) continue;
    const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
    try { await Sys.call('fontInstall', { name: f.name, data }, 60000); n++; } catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t install ' + f.name, body: e.message }); }
  }
  if (n) { Notif.push({ app: 'settings', title: `${n} font${n === 1 ? '' : 's'} installed`, silent: true }); ctx.rerender(); }
}
defPage('fonts', { title: 'Fonts', parent: 'personalization', icon: 'fonts', keywords: 'font install typeface', wide: true, render: (ctx) => {
  const grid = h('div', { class: 'ws-fontgrid' });
  const q = h('input', { type: 'search', class: 'ws-input', placeholder: 'Search fonts', 'aria-label': 'Search fonts', style: { width: '240px' } });
  let all = [];
  const paint = () => {
    const s = q.value.trim().toLowerCase();
    grid.replaceChildren(...all.filter((f) => !s || f.family.toLowerCase().includes(s)).slice(0, 200).map((f) => {
      const b = h('button', { class: 'ws-font' }, h('div', { class: 'ws-font-sample', text: 'The quick brown fox jumps over the lazy dog.' }), h('div', { class: 'ws-t', text: f.family }), h('div', { class: 'ws-d', text: `${f.styles} font face${f.styles === 1 ? '' : 's'}` }));
      b.querySelector('.ws-font-sample').style.fontFamily = `"${f.family}"`;
      b.addEventListener('click', () => ctx.go('fontdetail', null, { family: f.family, user: f.user }));
      return b;
    }));
  };
  q.addEventListener('input', paint);
  if (IS_NATIVE) Sys.call('fonts', {}, 30000).then((list) => { all = list; paint(); }).catch((e) => grid.replaceChildren(WS.info('error', 'Couldn’t list the fonts', e.message)));
  else { all = WEB_FONTS.map(([family]) => ({ family, styles: 1 })); paint(); }
  const drop = h('div', { class: 'ws-drop', tabindex: '0', role: 'button', html: `<span class="ws-drop-ic">${fi('fonts')}</span><span>Drag and drop to install</span>` });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); if (IS_NATIVE) fontInstall(ctx, [...(e.dataTransfer?.files || [])]); });
  return [
    WS.group('Add fonts', h('div', { class: 'ws-card ws-dropcard' }, drop, h('div', { class: 'ws-ctl' }, IS_NATIVE ? WS.button('Browse and install fonts', async () => fontInstall(ctx, await pickFiles('.ttf,.otf,.woff,.woff2,.ttc', true))) : h('span', { class: 'ws-d', text: 'Installing fonts works on Nimbus OS' })))),
    WS.group('Available fonts', h('div', { class: 'ws-row ws-between' }, q), grid),
  ];
} });
defPage('fontdetail', { title: 'Font', parent: 'fonts', icon: 'fonts', noRecent: true, hidden: () => false, render: (ctx) => {
  const fam = ctx.params.family || 'Selawik';
  const sample = h('textarea', { class: 'ws-input ws-font-big', rows: 2, 'aria-label': 'Type here to preview' }); sample.value = 'Type here to preview.';
  const size = WS.slider(ctx, { min: 12, max: 96, get: () => 40, set: (v) => { sample.style.fontSize = v + 'px'; }, label: 'Font size', fmt: (v) => v + ' px' });
  sample.style.fontFamily = `"${fam}"`; sample.style.fontSize = '40px';
  return [h('h2', { class: 'ws-h2', text: fam }), WS.group(null, h('div', { class: 'ws-card ws-col' }, sample, h('div', { class: 'ws-row' }, h('span', { class: 'ws-d', text: 'Change font size' }), size))),
    ctx.params.user ? WS.group(null, WS.card(ctx, { icon: 'delete', title: 'Uninstall', desc: 'Remove this font from your PC', ctl: WS.button('Uninstall', async () => { try { await Sys.call('fontRemove', { family: fam }); ctx.go('fonts'); } catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t remove the font', body: e.message }); } }) })) : null];
} });

/* ---------- Apps ---------- */
defPage('apps', { title: 'Apps', icon: 'apps', keywords: 'programs software install uninstall default startup', render: (ctx) => [WS.group(null,
  WS.card(ctx, { icon: 'installedApps', title: 'Installed apps', desc: 'Uninstall and manage apps on your PC', go: 'installedapps' }),
  WS.card(ctx, { icon: 'defaultApps', title: 'Default apps', desc: 'Defaults for file and link types', go: 'defaultapps' }),
  WS.card(ctx, { icon: 'startup', title: 'Startup', desc: 'Apps that start automatically when you sign in', go: 'startupapps' }))] });
function appRows() {
  const rows = Object.keys(APPS).filter((id) => appListed(id) && !APPS[id].launch).map((id) => ({ id, name: APPS[id].name, icon: APPS[id].icon, who: 'Nimbus', meta: 'Built in', size: 0, builtin: true }));
  if (caps.programs) {
    const c = Apps.status.chrome || {};
    rows.push({ id: 'chrome', name: 'Google Chrome', icon: APPS.chrome.icon, who: 'Google LLC', meta: c.installed ? [c.version, c.size ? fmtBytes(c.size) : '', c.installedAt ? fmtDT(c.installedAt * 1000, { dateStyle: 'medium' }) : ''].filter(Boolean).join(' · ') : 'Not installed yet. It downloads the first time you open it.', size: c.size || 0, program: true, installed: !!c.installed });
    // apps from the Store: one row each (some bring several Start entries)
    const seen = new Set();
    for (const p of Programs.list) {
      const key = p.kind === 'lutris' ? p.id : p.app;
      if (seen.has(key)) continue;
      seen.add(key);
      const main = (p.kind !== 'lutris' && APPS['fp:' + p.app] && APPS['fp:' + p.app].program) || p;
      rows.push({ id: main.id, name: main.name, icon: (APPS[main.id] || {}).icon || 'app', who: p.kind === 'lutris' ? 'Lutris' : 'Store (Flathub)',
        meta: [p.version ? 'Version ' + p.version : '', p.kind === 'lutris' ? 'Runs with Wine' : ''].filter(Boolean).join(' · ') || 'Installed', size: p.size || 0, program: true, installed: true, store: true, app: p.kind === 'lutris' ? p.id : p.app });
    }
  }
  return rows;
}
defPage('installedapps', { title: 'Installed apps', parent: 'apps', icon: 'installedApps', keywords: 'uninstall remove programs', render: (ctx) => {
  const list = h('div', { class: 'ws-cards' });
  const q = h('input', { type: 'search', class: 'ws-input', placeholder: 'Search apps', 'aria-label': 'Search apps', style: { width: '260px' } });
  let sort = 'name';
  const paint = () => {
    const s = q.value.trim().toLowerCase();
    const rows = appRows().filter((r) => !s || r.name.toLowerCase().includes(s)).sort((a, b) => (sort === 'size' ? b.size - a.size : a.name.localeCompare(b.name)));
    list.replaceChildren(...rows.map((r) => {
      const more = h('button', { class: 'ws-iconbtn', 'aria-label': 'More options for ' + r.name, html: fi('more') });
      more.addEventListener('click', (e) => { e.stopPropagation(); Menu.show([
        { label: 'Open', icon: 'external', action: () => WM.open(r.id) },
        r.store ? { label: 'Details in the Store', icon: 'info', action: () => WM.open('store', { app: r.app }) } : null,
        r.program && r.installed && !r.store ? { label: 'Update now', icon: 'refresh', action: async () => { try { await Sys.call('programUpdate', { app: r.id }, 600000); Notif.push({ app: 'settings', title: r.name + ' is up to date', silent: true }); } catch (err) { Notif.push({ app: 'settings', title: 'Couldn’t update ' + r.name, body: err.message }); } Apps.refresh(); } } : null,
        r.store ? { label: 'Get updates', icon: 'refresh', action: () => WM.open('store', { page: 'library' }) } : null,
        r.program && r.installed ? 'sep' : null,
        r.program && r.installed ? { label: 'Uninstall', icon: 'trash', action: () => (r.store ? Programs.uninstall(r.id, ctx.win) : uninstallProgram(ctx, r)) } : null,
      ].filter(Boolean), 0, 0, { anchorEl: more }); });
      return WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon(r.icon)}</span>`, title: r.name, desc: `${r.who} · ${r.meta}`, ctl: h('div', { class: 'ws-row' }, r.size ? h('span', { class: 'ws-d', text: fmtBytes(r.size) }) : null, more) });
    }));
  };
  q.addEventListener('input', paint);
  ctx.on('apps', paint); paint();
  if (IS_NATIVE) { Apps.refresh(); Programs.refresh(); }
  return [h('div', { class: 'ws-row ws-between' }, q, h('div', { class: 'ws-row' }, h('span', { class: 'ws-d', text: 'Sort by:' }), WS.combo(ctx, [['name', 'Name (A to Z)'], ['size', 'Size (large to small)']], () => sort, (v) => { sort = v; paint(); }, 'Sort by', { width: 180 }))), h('div', { class: 'ws-d ws-count', text: `${appRows().length} apps found` }), list];
} });
async function uninstallProgram(ctx, r) {
  const ok = await Dialog.confirm('Uninstall ' + r.name + '?', 'This app and its settings will be removed. Your bookmarks and passwords stay in your Google account if you signed in to Chrome.', { ok: 'Uninstall', danger: true, within: ctx.win });
  if (!ok) return;
  try { await Sys.call('programRemove', { app: r.id }, 300000); Notif.push({ app: 'settings', title: r.name + ' was uninstalled', silent: true }); } catch (e) { Notif.push({ app: 'settings', title: 'Couldn’t uninstall ' + r.name, body: e.message }); }
  Apps.refresh();
}
const FILE_TYPES = [['.txt', 'Text document', 'text'], ['.md', 'Markdown document', 'text'], ['.csv', 'Comma separated values', 'text'], ['.json', 'JSON file', 'text'], ['.log', 'Log file', 'text'], ['.png', 'PNG image', 'image'], ['.jpg', 'JPEG image', 'image'], ['.gif', 'GIF image', 'image'], ['.webp', 'WebP image', 'image'], ['.svg', 'SVG image', 'image']];
defPage('defaultapps', { title: 'Default apps', parent: 'apps', icon: 'defaultApps', keywords: 'default browser open with file types', render: (ctx) => {
  const opener = (kind) => (kind === 'image' ? [['photos', 'Photos'], ['paint', 'Paint']] : [['notes', 'Notes']]);
  const assoc = (kind) => (S.data.assoc || {})[kind] || (kind === 'image' ? 'photos' : 'notes');
  const q = h('input', { type: 'search', class: 'ws-input', placeholder: 'Enter a file type or link type', 'aria-label': 'Set a default for a file type or link type', style: { width: '100%' } });
  const res = h('div', { class: 'ws-cards' });
  const paint = () => {
    const s = q.value.trim().toLowerCase();
    if (!s) { res.replaceChildren(); return; }
    const hits = FILE_TYPES.filter(([ext, name]) => ext.includes(s) || name.toLowerCase().includes(s));
    if ('http'.includes(s.replace(/[:/]/g, '')) || 'https'.includes(s.replace(/[:/]/g, ''))) hits.push(['HTTPS', 'Web links', 'web']);
    res.replaceChildren(...hits.map(([ext, name, kind]) => WS.card(ctx, { icon: kind === 'image' ? 'background' : kind === 'web' ? 'globe' : 'document', title: ext, desc: name, ctl: kind === 'web' ? h('span', { class: 'ws-d', text: caps.programs ? 'Google Chrome' : 'Your browser' }) : WS.combo(ctx, opener(kind), () => assoc(kind), (v) => S.set('assoc', Object.assign({}, S.data.assoc, { [kind]: v })), 'Open ' + ext + ' with', { width: 140 }) })));
  };
  q.addEventListener('input', paint);
  return [
    WS.group('Set a default for a file type or link type', h('div', { class: 'ws-card' }, q), res),
    WS.group('Set defaults for applications',
      caps.programs ? WS.card(ctx, { sid: 'browser', iconHtml: `<span class="ws-appic">${appIcon(APPS.chrome.icon)}</span>`, title: 'Google Chrome', desc: Apps.installed('chrome') ? 'Your default web browser: web links open here' : 'Your default web browser. Nimbus downloads it from Google the first time you open it.', ctl: WS.button(Apps.installed('chrome') ? 'Open' : 'Install', () => WM.open('chrome')) }) : WS.card(ctx, { icon: 'globe', title: 'Web browser', desc: 'Links open in ' + browserName() }),
      WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon('photos')}</span>`, title: 'Pictures', desc: '.png, .jpg, .gif, .webp, .svg', ctl: WS.combo(ctx, opener('image'), () => assoc('image'), (v) => S.set('assoc', Object.assign({}, S.data.assoc, { image: v })), 'Open pictures with', { width: 140 }) }),
      WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon('notes')}</span>`, title: 'Text and documents', desc: '.txt, .md, .csv, .json and other text open in Notes' })),
  ];
} });
defSettings('defaultapps', [['browser', 'Default web browser', 'chrome google internet web browser default']]);
defPage('startupapps', { title: 'Startup', parent: 'apps', icon: 'startup', keywords: 'start automatically sign in boot', render: (ctx) => {
  const ids = Object.keys(APPS).filter((id) => appListed(id) && !['welcome', 'installer'].includes(id));
  return [h('p', { class: 'ws-d ws-intro', text: 'Apps can be set to start when you sign in. They start minimized, or as a small window.' }),
    WS.group(null, h('div', { class: 'ws-row ws-between ws-sortrow' }, h('span', { class: 'ws-d', text: 'Sort by: Name' })), ...ids.sort((a, b) => APPS[a].name.localeCompare(APPS[b].name)).map((id) => WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon(APPS[id].icon)}</span>`, title: APPS[id].name, desc: APPS[id].launch ? 'Google LLC' : 'Nimbus', ctl: WS.toggle(ctx, () => (S.data.startupApps || []).includes(id), (v) => S.set('startupApps', v ? [...(S.data.startupApps || []), id] : (S.data.startupApps || []).filter((x) => x !== id)), APPS[id].name + ' at startup') })))];
} });

/* ---------- Accounts (a local account: nothing to sign in to) ---------- */
function bigAvatar() { return h('span', { class: 'ws-avatar big', html: avatarHTML(true) }); }
defPage('accounts', { title: 'Accounts', icon: 'accounts', keywords: 'user profile account sign in backup', render: (ctx) => [
  h('div', { class: 'ws-hero acct' }, bigAvatar(), h('div', { class: 'ws-hero-meta' }, h('div', { class: 'ws-hero-name', text: userName() || 'You' }), h('div', { class: 'ws-d', text: 'Local account' }), h('div', { class: 'ws-d', text: 'Administrator' }))),
  WS.group('Account settings',
    WS.card(ctx, { icon: 'personCircle', title: 'Your info', desc: 'Profile photo, name', go: 'yourinfo' }),
    WS.card(ctx, { icon: 'signIn', title: 'Sign-in options', desc: 'PIN, lock screen at startup, when to sign in again', go: 'signin' }),
    WS.card(ctx, { icon: 'backup', title: 'Backup', desc: 'Back up your files and settings, restore them', go: 'backup' })),
] });
async function pickAvatar(ctx) {
  const f = await pickFiles('image/*', false); if (!f.length) return;
  try { S.set('avatar', await fileToImageURL(f[0], 256)); ctx.rerender(); } catch { Notif.push({ app: 'settings', title: 'That picture couldn’t be used', silent: true }); }
}
defPage('yourinfo', { title: 'Your info', parent: 'accounts', icon: 'personCircle', keywords: 'name photo picture avatar', render: (ctx) => [
  h('div', { class: 'ws-yourinfo' }, bigAvatar(), h('div', { class: 'ws-hero-name', text: userName() || 'You' }), h('div', { class: 'ws-d', text: 'Local account · Administrator' })),
  WS.group('Adjust your photo',
    WS.card(ctx, { sid: 'avatar', icon: 'background', title: 'Choose a file', ctl: h('div', { class: 'ws-row' }, WS.button('Browse files', () => pickAvatar(ctx)), S.data.avatar ? WS.button('Remove', () => { S.set('avatar', ''); ctx.rerender(); }) : null) })),
  WS.group('Account settings',
    WS.card(ctx, { sid: 'userName', icon: 'person', title: 'Your name', desc: 'Shown in Start and on the lock screen', ctl: WS.textbox(ctx, { get: () => S.data.userName, set: (v) => S.set('userName', v.trim()), placeholder: 'Your name', width: 220, maxlength: 40, label: 'Your name' }) }),
    WS.card(ctx, { icon: 'info', title: 'Local account', desc: 'Your files and settings stay with this PC. There is no online account to sign in to.' })),
] });
defSettings('yourinfo', [['avatar', 'Account picture', 'photo avatar picture'], ['userName', 'Your name', 'user profile account']]);
async function hashPin(pin, salt) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin)); return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join(''); }
async function checkPin(pin) { const p = S.data.lockPin; return !!p && (await hashPin(pin, p.salt)) === p.hash; }
async function setPinDialog(ctx) {
  const old = S.data.lockPin ? h('input', { class: 'ws-input', type: 'password', inputmode: 'numeric', placeholder: 'Current PIN', 'aria-label': 'Current PIN' }) : null;
  const a = h('input', { class: 'ws-input', type: 'password', inputmode: 'numeric', placeholder: 'New PIN', 'aria-label': 'New PIN', maxlength: 12 });
  const b = h('input', { class: 'ws-input', type: 'password', inputmode: 'numeric', placeholder: 'Confirm PIN', 'aria-label': 'Confirm PIN', maxlength: 12 });
  const err = h('p', { class: 'ws-err' });
  const v = await Dialog.show({ title: S.data.lockPin ? 'Change your PIN' : 'Set up a PIN', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('p', { class: 'ws-d', text: 'You type it to unlock this PC on the lock screen.' }), old, a, b, err),
    buttons: [{ label: 'OK', primary: true, value: () => { if (!/^\d{4,12}$/.test(a.value)) { err.textContent = 'Use 4 to 12 digits.'; return undefined; } if (a.value !== b.value) { err.textContent = 'The PINs don’t match.'; return undefined; } return { old: old ? old.value : null, pin: a.value }; } }, { label: 'Cancel', value: null }] });
  if (!v) return;
  if (S.data.lockPin && !(await checkPin(v.old || ''))) { Dialog.alert('The current PIN is incorrect', 'Your PIN wasn’t changed.', ctx.win); return; }
  const salt = uid() + uid();
  S.set('lockPin', { salt, hash: await hashPin(v.pin, salt) });
  ctx.rerender();
}
defPage('signin', { title: 'Sign-in options', parent: 'accounts', icon: 'signIn', keywords: 'pin password lock screen sign in', render: (ctx) => [
  WS.group('Ways to sign in',
    WS.expander(ctx, { sid: 'pin', icon: 'password', title: 'PIN', desc: S.data.lockPin ? 'You use a PIN to unlock this PC' : 'Ask for a PIN on the lock screen', open: true, items: [
      WS.sub({ title: S.data.lockPin ? 'Change your PIN' : 'Set up a PIN', ctl: WS.button(S.data.lockPin ? 'Change PIN' : 'Set up', () => setPinDialog(ctx)) }),
      S.data.lockPin ? WS.sub({ title: 'Remove this sign-in option', ctl: WS.button('Remove', async () => { const pin = await Dialog.prompt('Remove your PIN', { label: 'Current PIN', ok: 'Remove', within: ctx.win }); if (pin == null) return; if (!(await checkPin(pin))) { Dialog.alert('The PIN is incorrect', 'Your PIN wasn’t removed.', ctx.win); return; } S.set('lockPin', null); ctx.rerender(); }) }) : null,
    ] })),
  WS.group('Additional settings',
    WS.card(ctx, { sid: 'lockOnStart', icon: 'lock', title: 'Show the lock screen at startup', ctl: WS.settingToggle(ctx, 'lockOnStart', 'Show the lock screen at startup') }),
    WS.card(ctx, { sid: 'lockOnWake', icon: 'sleep', title: 'If you’ve been away, when should Nimbus require you to sign in again?', ctl: WS.settingCombo(ctx, 'lockOnWake', [[true, 'When PC wakes up from sleep'], [false, 'Never']], 'Require sign-in', { width: 230 }) })),
] });
defSettings('signin', [['pin', 'PIN', 'password unlock lock screen sign in'], ['lockOnWake', 'Require sign-in after sleep', 'lock wake']]);
defPage('backup', { title: 'Backup', parent: 'accounts', icon: 'backup', keywords: 'backup restore export import sync cloud', render: (ctx) => {
  const st = Store.cloudLabel();
  ctx.on('store', () => ctx.rerender());
  return [
    WS.group(null, WS.card(ctx, { sid: 'sync', icon: st.icon === 'cloud' ? 'cloud' : 'save', title: st.title, desc: st.desc })),
    WS.group('Back up everything',
      WS.card(ctx, { sid: 'backupNow', icon: 'download', title: 'Back up your files and settings', desc: 'One file with all your settings, files and pictures', ctl: caps.downloads || IS_NATIVE ? WS.button(IS_NATIVE ? 'Save a backup' : 'Download a backup', async () => {
        if (IS_NATIVE) { try { const r = await Sys.call('saveBackup', { name: osName() + ' backup ' + new Date().toISOString().slice(0, 10) + '.json', data: backupJSON() }, 60000); Notif.push({ app: 'settings', title: 'Backup saved', body: r.path }); } catch (e) { Notif.push({ app: 'settings', title: 'The backup wasn’t saved', body: e.message }); } }
        else offerDownload(osName() + ' backup.json', backupJSON());
      }, { accent: true }) : WS.button('Copy a backup', async () => { const ok = await copyText(backupJSON()); Notif.push({ app: 'settings', title: ok ? 'Backup copied' : 'Couldn’t copy the backup', body: ok ? 'Paste it into a text file to keep it.' : 'Your browser blocked the clipboard.', silent: true }); }) }),
      WS.card(ctx, { sid: 'restore', icon: 'restart', title: 'Restore from a backup', desc: 'Replaces what is here now', ctl: WS.button('Restore', () => restoreBackup(ctx.win)) })),
  ];
} });
defSettings('backup', [['sync', 'Sync status', 'cloud save'], ['backupNow', 'Back up', 'export save copy'], ['restore', 'Restore from a backup', 'import']]);
