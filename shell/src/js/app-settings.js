/* ========== Settings ========== */
const SETTINGS_PAGES = [
  ['system', 'System', 'desktop'], ...(IS_NATIVE ? [['network', 'Network & internet', 'wifi']] : []),
  ['personalization', 'Personalization', 'palette'], ['taskbar', 'Taskbar', 'layout'],
  ['apps', 'Apps', 'apps'], ['accounts', 'Accounts and sync', 'person'], ['privacy', 'Privacy and security', 'shield'],
  ['accessibility', 'Accessibility', 'access'], ['about', 'About', 'info'],
];
const SETTINGS_INDEX = [
  ['brightness', 'Brightness', 'system', 'display screen dim', 'sun'], ['nightLight', 'Night light', 'system', 'warm blue light eyes', 'sunset'],
  ['volume', 'Volume', 'system', 'sound audio loud', 'volume'], ['sounds', 'System sounds', 'system', 'audio chime beep mute', 'volume'],
  ['dnd', 'Focus (do not disturb)', 'system', 'notifications quiet dnd', 'bellOff'], ['energySaver', 'Energy saver', 'system', 'battery power performance', 'leaf'],
  ['clockSeconds', 'Show seconds in the clock', 'system', 'time taskbar', 'clock'], ['clock24', '24-hour time', 'system', 'clock format', 'clock'],
  ['lockOnStart', 'Lock screen at startup', 'system', 'boot login', 'lock'],
  ['theme', 'Dark mode and light mode', 'personalization', 'theme appearance auto', 'contrast'], ['accent', 'Accent color', 'personalization', 'color highlight', 'palette'],
  ['wallpaper', 'Wallpaper', 'personalization', 'background desktop picture photo', 'image'], ['transparency', 'Transparency effects', 'personalization', 'blur glass acrylic', 'eye'],
  ['showDesktopIcons', 'Desktop icons', 'personalization', 'show hide', 'desktop'],
  ['tbAlign', 'Taskbar alignment', 'taskbar', 'center left start button', 'layout'], ['tbPos', 'Taskbar position', 'taskbar', 'top bottom move', 'layout'],
  ['tbFloat', 'Floating taskbar', 'taskbar', 'rounded margin', 'layout'], ['pinned', 'Pinned apps', 'taskbar', 'pin unpin shortcuts', 'pin'],
  ['installed', 'Installed apps', 'apps', 'programs software', 'apps'], ['browser', 'Default web browser', 'apps', 'chrome google internet web browser default', 'globe'], ['userName', 'Your name', 'accounts', 'user profile account', 'person'],
  ['sync', 'Sync and backup', 'accounts', 'cloud save backup restore export import', 'cloud'], ['privacy', 'Privacy dashboard', 'privacy', 'ads tracking data telemetry', 'shield'],
  ['reset', 'Reset this PC', 'privacy', 'erase wipe factory', 'restart'], ['textSize', 'Text size', 'accessibility', 'font bigger larger zoom', 'textSize'],
  ['reduceMotion', 'Reduce motion', 'accessibility', 'animations', 'activity'], ['shortcuts', 'Keyboard shortcuts', 'accessibility', 'keys hotkeys', 'keyboard'],
  ['osName', 'Rename your OS', 'about', 'name os', 'pencil'], ['deviceName', 'Rename this PC', 'about', 'device computer name', 'desktop'],
  ['specs', 'Device specifications', 'about', 'cpu memory ram processor version', 'cpu'],
  ['wifi', 'Wi-Fi', 'network', 'wifi wlan wireless internet network ssid password connect', 'wifi'],
  ['airplane', 'Airplane mode', 'network', 'flight offline radio', 'airplane'], ['ethernet', 'Ethernet', 'network', 'wired cable lan internet', 'ethernet'],
  ...(IS_NATIVE ? [['saving', 'Save your work between restarts', 'system', 'persistent persistence storage keep files usb disk live session', 'hdd']] : []),
].map(([id, name, page, keywords, icon]) => ({ id, name, page, keywords, icon, pageName: (SETTINGS_PAGES.find((p) => p[0] === page) || [])[1] }))
  .filter((s) => s.pageName);
const ACCENTS = ['#4a74f5', '#2b88d8', '#0f9fa8', '#1f9d61', '#6f8f1f', '#d18f0b', '#e2671d', '#d83b45', '#d6337f', '#9b5de5', '#6a4ff0', '#5f6b7a'];
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
function mountSettings(root, api, args) {
  let page = args.page || 'system', syncs = [], nets = null, netShape = '';
  // What the network page was drawn for: when this changes the page is rebuilt, otherwise only its live parts update
  const shapeOfNet = () => `${Net.ready}|${Net.hasWifi}`;
  root.classList.add('app-settings');
  root.innerHTML = `<aside class="st-side"><div class="st-user"></div><label class="st-search searchbox">${ui('search')}<input type="search" id="${api.id}-find" placeholder="Find a setting" aria-label="Find a setting"></label><nav class="st-nav" aria-label="Settings pages"></nav></aside><main class="st-main" tabindex="-1"></main>`;
  const nav = root.querySelector('.st-nav'), main = root.querySelector('.st-main'), find = root.querySelector('.st-search input');
  const cid = (k) => `${api.id}-${k}`;
  // ---- control builders ----
  function toggle(key, label, invert = false) {
    const get = () => (invert ? !S.data[key] : !!S.data[key]);
    const b = h('button', { class: 'switch', role: 'switch', id: cid(key), 'aria-checked': String(get()), 'aria-label': label });
    b.addEventListener('click', () => S.set(key, invert ? get() : !get()));
    const lab = h('span', { class: 'switch-label' }, h('span', { text: get() ? 'On' : 'Off' }), b);
    syncs.push(() => { b.setAttribute('aria-checked', String(get())); lab.firstChild.textContent = get() ? 'On' : 'Off'; });
    return lab;
  }
  function slider(key, min, max, step, fmt, label, onChange) {
    const inp = h('input', { type: 'range', min, max, step, value: S.data[key], id: cid(key), 'aria-label': label });
    const v = h('span', { class: 'sv num', text: fmt(S.data[key]) });
    inp.addEventListener('input', () => { S.set(key, +inp.value); v.textContent = fmt(+inp.value); });
    if (onChange) inp.addEventListener('change', onChange);
    syncs.push(() => { if (document.activeElement !== inp) inp.value = S.data[key]; v.textContent = fmt(S.data[key]); });
    return h('div', { class: 'sslider' }, inp, v);
  }
  function seg(key, options, label) {
    const box = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const btns = options.map(([v, l]) => { const b = h('button', { text: l, 'aria-pressed': String(S.data[key] === v) }); b.addEventListener('click', () => S.set(key, v)); box.append(b); return [v, b]; });
    syncs.push(() => btns.forEach(([v, b]) => b.setAttribute('aria-pressed', String(S.data[key] === v))));
    return box;
  }
  function textField(key, label, placeholder, fallback) {
    const inp = h('input', { class: 'field', id: cid(key), value: S.data[key] || '', placeholder, 'aria-label': label, maxlength: 32, style: 'width:220px' });
    const commit = debounce(() => S.set(key, inp.value.trim() || fallback || ''), 350);
    inp.addEventListener('input', commit);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    syncs.push(() => { if (document.activeElement !== inp) inp.value = S.data[key] || ''; });
    return inp;
  }
  function row({ id, icon, title, desc, ctl, cls }) {
    const r = h('div', { class: 'srow' + (cls ? ' ' + cls : ''), 'data-sid': id || '' });
    r.append(h('span', { class: 'srow-ic', html: icon ? ui(icon) : '' }), h('div', { class: 'srow-txt' }, h('div', { class: 'srow-t', text: title }), desc ? h('div', { class: 'srow-d', text: desc }) : null));
    if (ctl) r.append(h('div', { class: 'srow-ctl' }, ctl));
    return r;
  }
  const section = (title, ...rows) => h('section', { class: 'st-sec' }, title ? h('h2', { text: title }) : null, ...rows);
  const tzSelect = () => buildTzSelect(cid('tz'));
  const pct = (v) => v + '%';
  function netSwitch(get, label, set) {
    const b = h('button', { class: 'switch', role: 'switch', 'aria-label': label });
    const lab = h('span', { class: 'switch-label' }, h('span'), b);
    const sync = () => { const on = get(); b.setAttribute('aria-checked', String(on)); lab.firstChild.textContent = on ? 'On' : 'Off'; b.disabled = !!Net.busy; };
    b.addEventListener('click', () => set(!get()));
    syncs.push(sync); sync();
    return lab;
  }
  function networkPage() {
    netShape = shapeOfNet();
    if (!Net.ready) return [section('', h('p', { class: 'muted', text: 'The network service isn’t running, so networks can’t be shown.' }))];
    const st = () => Net.status;
    const hero = h('div', { class: 'net-hero' });
    const paintHero = () => {
      const s = st(); const c = s.connectivity;
      const sub = s.airplane ? 'Wi-Fi is off while airplane mode is on.' : (s.wifi.ssid || s.wired.connected)
        ? (c === 'full' ? 'Connected to the internet' : c === 'portal' ? 'This network needs you to sign in on a web page' : c === 'limited' || c === 'none' ? 'Connected, but there’s no internet' : 'Connected')
        : (s.wifi.present ? 'Choose a Wi-Fi network below.' : 'Plug in a network cable to get online.');
      hero.innerHTML = `<span class="net-hero-ic">${Net.icon()}</span><div><div class="net-hero-t">${esc(Net.label().replace(/ \((no internet|sign-in needed)\)$/, ''))}</div><div class="muted">${esc(sub)}</div></div>`;
    };
    syncs.push(paintHero); paintHero();
    const out = [section('', hero)];
    if (st().wifi.present) {
      nets = nets || netList();
      out.push(section('Wi-Fi',
        row({ id: 'wifi', icon: 'wifi', title: 'Wi-Fi', desc: 'Find and join wireless networks. Saved networks join by themselves.', ctl: netSwitch(() => st().wifi.enabled && !st().airplane, 'Wi-Fi', (v) => Net.setWifi(v)) }),
        h('div', { class: 'srow net-wrap' }, nets.el)));
    }
    const wired = h('div', { class: 'srow-d' });
    const paintWired = () => { const s = st(); wired.textContent = !s.wired.present ? 'This PC has no Ethernet port.' : s.wired.connected ? `Connected (${s.wired.name})` : 'No cable plugged in'; };
    syncs.push(paintWired); paintWired();
    const wiredRow = row({ id: 'ethernet', icon: 'ethernet', title: 'Ethernet' });
    wiredRow.querySelector('.srow-txt').append(wired);
    out.push(section('More',
      row({ id: 'airplane', icon: 'airplane', title: 'Airplane mode', desc: 'Turns off Wi-Fi and mobile broadband.', ctl: netSwitch(() => st().airplane, 'Airplane mode', (v) => Net.setAirplane(v)) }),
      wiredRow));
    return out;
  }
  // ---- pages ----
  function savingSection() {
    if (!IS_NATIVE || !Native.live) return null;
    const on = Storage.saving;
    return section('Saving your work',
      row({ id: 'saving', icon: 'hdd', title: on ? 'Saving is on' : 'Your work isn’t saved yet',
        desc: on ? 'Files, settings and Wi-Fi passwords are kept between restarts.' : 'This is a live session: files and settings are lost when you shut down.',
        ctl: h('button', { class: on ? 'btn' : 'btn primary', text: on ? 'Details' : 'Set up saving', disabled: Storage.busy, onclick: () => Storage.open() }) }));
  }
  const PAGES = {
    network: networkPage,
    system: () => [
      savingSection(),
      section('Display',
        row({ id: 'brightness', icon: 'sun', title: 'Brightness', desc: 'Dims the whole screen of this OS.', ctl: slider('brightness', 30, 100, 1, pct, 'Brightness') }),
        row({ id: 'nightLight', icon: 'sunset', title: 'Night light', desc: 'Warmer colors that are easier on your eyes at night.', ctl: toggle('nightLight', 'Night light') }),
        row({ id: 'nightStrength', icon: 'sunset', title: 'Night light strength', ctl: slider('nightStrength', 0, 100, 1, pct, 'Night light strength') })),
      section('Sound',
        row({ id: 'volume', icon: 'volume', title: 'Volume', ctl: slider('volume', 0, 100, 1, pct, 'Volume', () => Sound.play('notify')) }),
        row({ id: 'sounds', icon: 'volume', title: 'System sounds', desc: 'Chimes for startup, notifications and timers.', ctl: toggle('sounds', 'System sounds') })),
      section('Notifications',
        row({ id: 'dnd', icon: 'bellOff', title: 'Focus (do not disturb)', desc: 'Notifications go straight to the notification center without popping up.', ctl: toggle('dnd', 'Focus') }),
        row({ icon: 'bell', title: 'Test notifications', desc: 'See how notifications look right now.', ctl: h('button', { class: 'btn', text: 'Send a test', onclick: () => Notif.push({ app: 'settings', title: 'This is a notification', body: 'Notifications from apps, timers and the system show up like this.' }) }) })),
      section('Power and performance',
        row({ id: 'energySaver', icon: 'leaf', title: 'Energy saver', desc: 'Turns off transparency and animations so this OS uses less power.', ctl: toggle('energySaver', 'Energy saver') })),
      section('Date and time',
        row({ id: 'clockSeconds', icon: 'clock', title: 'Show seconds in the taskbar clock', ctl: toggle('clockSeconds', 'Show seconds') }),
        IS_NATIVE ? row({ id: 'timezone', icon: 'globe', title: 'Time zone', desc: 'Changing it restarts the desktop for a moment.', ctl: tzSelect() }) : null,
        row({ id: 'clock24', icon: 'clock', title: '24-hour time', desc: IS_NATIVE ? '' : 'Time zone: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + ', from your browser.', ctl: (() => { const b = h('button', { class: 'switch', role: 'switch', id: cid('clock24'), 'aria-label': '24-hour time' }); const is24 = () => S.data.clock24 === true || (S.data.clock24 == null && new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle?.startsWith('h2')); b.setAttribute('aria-checked', String(!!is24())); b.onclick = () => S.set('clock24', !is24()); syncs.push(() => b.setAttribute('aria-checked', String(!!is24()))); return b; })() }),
        row({ id: 'lockOnStart', icon: 'lock', title: 'Show the lock screen at startup', desc: 'Off by default, so you go straight to your desktop.', ctl: toggle('lockOnStart', 'Lock screen at startup') })),
    ],
    personalization: () => {
      const preview = h('div', { class: 'pz-preview', 'aria-hidden': 'true' }, h('div', { class: 'pz-wall' }), h('div', { class: 'pz-win' }, h('i'), h('i'), h('i')), h('div', { class: 'pz-bar' }, h('b'), h('b'), h('b'), h('b')));
      const setPrev = () => { preview.querySelector('.pz-wall').style.backgroundImage = `url("${currentWallURL}")`; };
      setPrev(); syncs.push(setPrev);
      const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent color' });
      for (const c of ACCENTS) { const b = h('button', { class: 'swatch', style: { '--c': c }, role: 'radio', 'aria-label': 'Accent ' + c, 'aria-pressed': String(S.data.accent.toLowerCase() === c) }); b.style.setProperty('--c', c); b.onclick = () => S.set('accent', c); sw.append(b); }
      const custom = h('label', { class: 'swatch custom', 'data-tip': 'Custom color' }, h('input', { type: 'color', id: cid('accentCustom'), value: S.data.accent, 'aria-label': 'Custom accent color' }));
      custom.querySelector('input').addEventListener('input', debounce((e) => S.set('accent', e.target.value), 60));
      sw.append(custom);
      syncs.push(() => sw.querySelectorAll('.swatch:not(.custom)').forEach((b, i) => b.setAttribute('aria-pressed', String(S.data.accent.toLowerCase() === ACCENTS[i]))));
      const gal = h('div', { class: 'wall-gal' });
      const tiles = [];
      const addTile = (id, label, src) => { const b = h('button', { class: 'wall-tile', 'aria-label': 'Wallpaper ' + label, 'aria-pressed': String(S.data.wallpaper === id), html: `<img src="${src}" alt="" loading="lazy"><span>${esc(label)}</span>` }); b.onclick = () => S.set('wallpaper', id); gal.append(b); tiles.push([id, b]); };
      for (const w of WALLS) addTile(w.id, w.name, wallThumb(w.id));
      for (const n of Object.values(FS.nodes).filter((x) => x.kind === 'image' && !FS.inTrash(x.id)).sort((a, b) => b.modified - a.modified).slice(0, 8)) addTile('file:' + n.id, n.name, FS.read(n.id));
      syncs.push(() => tiles.forEach(([id, b]) => b.setAttribute('aria-pressed', String(S.data.wallpaper === id))));
      const browse = h('button', { class: 'btn', html: ui('upload') + 'Use a photo from this computer', onclick: async () => { const f = await pickFiles('image/*', false); if (!f.length) return; const made = await importFiles(f, 'pictures'); if (made[0]) { S.set('wallpaper', 'file:' + made[0].id); render(); } } });
      return [
        preview,
        section('Theme',
          row({ id: 'theme', icon: 'contrast', title: 'Mode', desc: 'Auto follows your device, or Claude when this OS is open there.', ctl: seg('theme', [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']], 'Theme mode') }),
          row({ id: 'accent', icon: 'palette', title: 'Accent color', desc: 'Used for highlights, buttons and your logo.', cls: 'tall' }),
          h('div', { class: 'srow sub' }, sw),
          row({ id: 'transparency', icon: 'eye', title: 'Transparency effects', desc: IS_NATIVE && Native.info && Native.info.software ? 'Frosted glass behind the taskbar, Start and menus. It needs graphics acceleration, so panels stay solid on this computer.' : 'Frosted glass behind the taskbar, Start and menus.', ctl: toggle('transparency', 'Transparency effects') })),
        section('Wallpaper', h('div', { class: 'srow sub', 'data-sid': 'wallpaper' }, gal), h('div', { class: 'srow sub end' }, browse)),
        section('Desktop', row({ id: 'showDesktopIcons', icon: 'desktop', title: 'Show desktop icons', ctl: toggle('showDesktopIcons', 'Show desktop icons') })),
      ];
    },
    taskbar: () => {
      const pins = h('div', { class: 'pin-list' });
      for (const id of Object.keys(APPS).filter(appListed)) {
        const a = APPS[id];
        const b = h('button', { class: 'switch', role: 'switch', 'aria-label': 'Pin ' + a.name, 'aria-checked': String(S.data.pinned.includes(id)) });
        b.onclick = () => S.set('pinned', S.data.pinned.includes(id) ? S.data.pinned.filter((x) => x !== id) : [...S.data.pinned, id]);
        syncs.push(() => b.setAttribute('aria-checked', String(S.data.pinned.includes(id))));
        pins.append(h('div', { class: 'pin-row' }, h('span', { class: 'ic', html: appIcon(a.icon) }), h('span', { class: 'grow', text: a.name }), b));
      }
      return [
        section('Layout',
          row({ id: 'tbAlign', icon: 'layout', title: 'Alignment', desc: 'Where the Start button and apps sit.', ctl: seg('tbAlign', [['center', 'Center'], ['left', 'Left']], 'Taskbar alignment') }),
          row({ id: 'tbPos', icon: 'layout', title: 'Position', desc: 'Put the taskbar at the bottom or top of the screen.', ctl: seg('tbPos', [['bottom', 'Bottom'], ['top', 'Top']], 'Taskbar position') }),
          row({ id: 'tbFloat', icon: 'layout', title: 'Floating taskbar', desc: 'Rounded corners with a small gap from the screen edge.', ctl: toggle('tbFloat', 'Floating taskbar') })),
        section('Buttons',
          row({ icon: 'search', title: 'Search', ctl: toggle('tbSearch', 'Search button') }),
          row({ icon: 'taskview', title: 'Task view', ctl: toggle('tbTaskView', 'Task view button') })),
        section('Pinned apps', h('div', { class: 'srow sub', 'data-sid': 'pinned' }, pins)),
      ];
    },
    apps: () => [
      section('Installed apps', h('div', { class: 'srow sub', 'data-sid': 'installed' }, h('div', { class: 'app-list' }, ...Object.keys(APPS).filter(appListed).map((id) => {
        const a = APPS[id];
        return h('div', { class: 'app-row' }, h('span', { class: 'ic', html: appIcon(a.icon) }), h('div', { class: 'grow' }, h('div', { class: 'srow-t', text: a.name }), h('div', { class: 'srow-d', text: a.desc })), h('button', { class: 'btn sm', text: 'Open', onclick: () => WM.open(id) }));
      })))),
      section('Default apps',
        caps.programs ? row({ id: 'browser', icon: 'globe', title: 'Web browser: Google Chrome',
          desc: Apps.installed('chrome') ? ('Opens web links.' + (Apps.status.chrome.version ? ' Version ' + Apps.status.chrome.version + '.' : '')) : 'Nimbus downloads it from Google the first time you open it.',
          ctl: h('button', { class: 'btn sm', text: Apps.installed('chrome') ? 'Open' : 'Install', onclick: () => WM.open('chrome') }) }) : null,
        row({ icon: 'doc', title: 'Text files', desc: '.txt, .md, .csv, .json and other text open in Notes.' }),
        row({ icon: 'image', title: 'Pictures', desc: '.png, .jpg, .webp and .gif open in Photos.' })),
    ],
    accounts: () => {
      const st = Store.cloudLabel();
      const syncRow = row({ id: 'sync', icon: st.icon, title: st.title, desc: st.desc });
      const backupBtns = h('div', { class: 'btn-row' });
      if (caps.downloads) backupBtns.append(h('button', { class: 'btn', html: ui('download') + 'Download a backup', onclick: () => offerDownload(osName() + ' backup.json', JSON.stringify({ app: 'nimbus-os', v: 1, settings: S.data, nodes: FS.nodes, contents: FS.contents })) }));
      else backupBtns.append(h('button', { class: 'btn', html: ui('copy') + 'Copy a backup', onclick: async () => { const ok = await copyText(JSON.stringify({ app: 'nimbus-os', v: 1, settings: S.data, nodes: FS.nodes, contents: FS.contents })); Notif.push({ app: 'settings', title: ok ? 'Backup copied' : 'Could not copy the backup', body: ok ? 'Paste it into a text file to keep it.' : 'Your browser blocked the clipboard.', silent: true }); } }));
      backupBtns.append(h('button', { class: 'btn', html: ui('upload') + 'Restore from a backup', onclick: restoreBackup }));
      return [
        h('div', { class: 'acct-card' }, h('div', { class: 'avatar' }, frag(`<span>${avatarHTML()}</span>`)), h('div', {}, h('div', { class: 'acct-name', text: userName() || 'You' }), h('div', { class: 'muted', text: 'Local account. There is nothing to sign in to.' }))),
        section('Your info', row({ id: 'userName', icon: 'person', title: 'Your name', desc: 'Shown in Start and on the lock screen.', ctl: textField('userName', 'Your name', 'Your name') })),
        section('Sync', syncRow),
        section('Backup', row({ icon: 'save', title: 'Back up everything', desc: 'One file with all your settings, files and pictures. Restoring replaces what is here now.' }), h('div', { class: 'srow sub end' }, backupBtns)),
      ];
    },
    privacy: () => {
      const cloudOn = Store.status.cloud === 'on';
      const facts = [
        ['shield', 'No ads, anywhere', 'Start, search and the lock screen never show ads or suggested apps. There is no ad system to switch off.'],
        ['eye', 'No tracking', 'This OS does not collect usage data or diagnostics, and it sends nothing to anyone.'],
        ['person', 'No account required', 'There is no sign-in and no account to create.'],
        [cloudOn ? 'cloud' : 'hdd', 'Where your data lives', cloudOn ? 'Your files and settings are kept in a private space in your Claude account. Other people who open this OS get their own separate copy.'
          : IS_NATIVE ? (Native.live ? 'This is a live session started from a USB stick or disc, so nothing you do is kept after you shut down.' : 'Your files and settings are kept on this computer.') : 'Your files and settings are kept in this browser.'],
        IS_NATIVE ? ['lock', 'No background reporting', 'There is no telemetry service in Nimbus OS, and nothing collects how you use your computer.']
          : ['lock', 'Device access', 'This OS cannot use your camera, microphone or location. Files from your computer come in only when you pick or drop them.'],
      ];
      if (caps.sample) facts.push(['sparkle', 'The assistant', 'It only runs when you send a message. It sees your message, your settings and the names of your files, and it uses your Claude account.']);
      return [
        h('div', { class: 'privacy-grid', 'data-sid': 'privacy' }, ...facts.map(([ic, t, d]) => h('div', { class: 'pv-card' }, h('span', { class: 'pv-ic', html: ui(ic) }), h('div', {}, h('div', { class: 'srow-t', text: t }), h('div', { class: 'srow-d', text: d }))))),
        section('Reset', row({ id: 'reset', icon: 'restart', title: 'Reset this PC', desc: 'Erase all files and settings and start fresh. This cannot be undone.', ctl: h('button', { class: 'btn danger', text: 'Reset', onclick: resetPC }) })),
      ];
    },
    accessibility: () => {
      const keys = [['Ctrl+K', 'Search apps, files and settings'], ['Ctrl+Alt+T', 'Open Terminal'], ['Ctrl+Alt+D', 'Show the desktop'], ['Ctrl+Alt+L', 'Lock'], ['Alt+Shift+Arrows', 'Snap the active window'], ['Ctrl+S', 'Save in Notes and Paint'], ['F2', 'Rename the selected file'], ['Delete', 'Move to the Recycle Bin'], ['Esc', 'Close menus and flyouts']];
      return [
        section('Vision',
          row({ id: 'textSize', icon: 'textSize', title: 'Text size', desc: 'Makes text bigger across the OS.', ctl: slider('textSize', 12, 18, 1, (v) => v + ' px', 'Text size') }),
          h('div', { class: 'srow sub' }, h('div', { class: 'text-preview', text: 'The quick brown fox jumps over the lazy dog.' }))),
        section('Motion', row({ id: 'reduceMotion', icon: 'activity', title: 'Reduce motion', desc: 'Turns off window animations and transitions.', ctl: toggle('reduceMotion', 'Reduce motion') })),
        section('Keyboard shortcuts', h('div', { class: 'srow sub', 'data-sid': 'shortcuts' }, h('dl', { class: 'keys' }, ...keys.flatMap(([k, d]) => [h('dt', {}, ...k.split('+').flatMap((p, i) => (i ? ['+', h('span', { class: 'kbd', text: p })] : [h('span', { class: 'kbd', text: p })]))), h('dd', { text: d })])))),
      ];
    },
    about: () => {
      const u = FS.usage();
      const ni = IS_NATIVE && Native.info;
      const specs = ni ? [
        ['Device', ni.device],
        ['Processor', `${ni.cpu} (${ni.cores} thread${ni.cores === 1 ? '' : 's'})`],
        ['Memory', fmtBytes(ni.memory)],
        ['Disk', `${fmtBytes(ni.disk.free)} free of ${fmtBytes(ni.disk.total)}`],
        ['Graphics', ((ni.gpus || []).map((g) => g.name + (g.driver ? ` (${g.driver})` : '')).join(', ') || 'Basic display') + (ni.software ? ', drawn by the processor' : '')],
        ['System', 'Linux ' + ni.kernel],
        ['Based on', ni.base],
        ['Session', ni.live ? 'Live, started from a USB stick or disc' : 'Installed'],
        ['Your files', `${fmtBytes(u.bytes)} in ${u.files} file${u.files === 1 ? '' : 's'} and ${u.folders} folder${u.folders === 1 ? '' : 's'}`],
      ] : [
        ['Processor', navigator.hardwareConcurrency ? navigator.hardwareConcurrency + ' logical cores' : 'Not reported'],
        ['Memory', navigator.deviceMemory ? 'About ' + navigator.deviceMemory + ' GB' : 'Not reported by this browser'],
        ['Display', `${screen.width} × ${screen.height} at ${(window.devicePixelRatio || 1).toFixed(2).replace(/\.?0+$/, '')}x`],
        ['Window', `${innerWidth} × ${innerHeight}`],
        ['Platform', navigator.userAgentData?.platform || navigator.platform || 'Unknown'],
        ['Runs on', browserName()],
        ['Language', navigator.language || 'en'],
        ['Storage used', `${fmtBytes(u.bytes)} in ${u.files} file${u.files === 1 ? '' : 's'} and ${u.folders} folder${u.folders === 1 ? '' : 's'}`],
      ];
      return [
        h('div', { class: 'about-card' }, h('span', { class: 'about-logo', html: appIcon('logo') }), h('div', {}, h('div', { class: 'about-name', text: osTitle() }), h('div', { class: 'muted', text: ni ? `Version ${ni.version} · ${ni.live ? 'Live session' : 'Installed'}` : 'Version 1.0 · Build 26.11 · Personal edition' }))),
        section('Names',
          row({ id: 'osName', icon: 'pencil', title: 'OS name', desc: IS_NATIVE ? 'Shown at startup, on the lock screen and in Welcome.' : 'Shown at startup, on the lock screen and in the title bar of your browser.', ctl: textField('osName', 'OS name', 'Nimbus', 'Nimbus') }),
          row({ id: 'deviceName', icon: 'desktop', title: 'PC name', desc: 'Used by Terminal.', ctl: textField('deviceName', 'PC name', 'My PC', 'My PC') })),
        section('Device specifications', h('div', { class: 'srow sub', 'data-sid': 'specs' }, h('dl', { class: 'specs' }, ...specs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])))),
      ];
    },
  };
  async function restoreBackup() {
    const f = await pickFiles('.json,application/json', false); if (!f.length) return;
    let data;
    try { data = JSON.parse(await f[0].text()); } catch { Dialog.alert('That file is not a backup', 'Choose a .json file made with "Download a backup".', api.win); return; }
    if (!data || data.app !== 'nimbus-os' || typeof data.nodes !== 'object') { Dialog.alert('That file is not a backup', 'Choose a .json file made with "Download a backup".', api.win); return; }
    const ok = await Dialog.confirm('Restore this backup?', 'Your current files and settings will be replaced by the ones in the backup.', { ok: 'Restore', danger: true, within: api.win });
    if (!ok) return;
    S.load(data.settings); FS.init(data.nodes, data.contents || {});
    for (const id in FS.nodes) { delete FS.nodes[id].chunks; if (FS.nodes[id].type === 'file') Store.saveContent(id); }
    S.data.updatedAt = Date.now(); FS.updatedAt = Date.now();
    Store.saveSettings(); Store.saveFs();
    Shell.reloadAll();
    Notif.push({ app: 'settings', title: 'Backup restored', body: `${FS.usage().files} files are back.` });
  }
  async function resetPC() {
    const ok = await Dialog.confirm('Reset this PC?', 'All your files, pictures and settings will be erased. This cannot be undone.', { ok: 'Erase everything', danger: true, within: api.win });
    if (!ok) return;
    await WM.closeAll(true);
    await Store.wipe();
    Store.quietly(() => { S.load({}); seedFS(); });
    S.data.updatedAt = Date.now();
    Store.saveSettings(); Store.saveFs();
    for (const id in FS.nodes) if (FS.nodes[id].type === 'file') Store.saveContent(id);
    Shell.reloadAll();
    Power.restart();
    setTimeout(() => WM.open('welcome'), 3200);
  }
  function renderNav() {
    nav.innerHTML = '';
    for (const [id, name, icon] of SETTINGS_PAGES) {
      const b = h('button', { 'aria-current': page === id ? 'page' : null, html: ui(icon) + `<span>${esc(name)}</span>` });
      b.addEventListener('click', () => { find.value = ''; go(id); });
      nav.append(b);
    }
    const u = root.querySelector('.st-user');
    u.innerHTML = `<span class="avatar">${avatarHTML()}</span><span class="meta"><b>${esc(userName() || 'You')}</b><span class="muted">Local account</span></span>`;
  }
  function render(focusId) {
    syncs = [];
    if (nets && page !== 'network') { nets.destroy(); nets = null; }
    renderNav();
    main.innerHTML = '';
    if (find.value.trim()) {
      const q = find.value.trim().toLowerCase();
      const hits = SETTINGS_INDEX.filter((s) => (s.name + ' ' + s.keywords + ' ' + s.pageName).toLowerCase().includes(q));
      main.append(h('h1', { text: 'Search results' }));
      if (!hits.length) main.append(h('p', { class: 'muted', text: 'No settings match. Try a different word.' }));
      for (const s of hits) { const b = h('button', { class: 'srow link', html: `<span class="srow-ic">${ui(s.icon)}</span><div class="srow-txt"><div class="srow-t">${esc(s.name)}</div><div class="srow-d">${esc(s.pageName)}</div></div><span class="srow-ctl">${ui('chevR')}</span>` }); b.onclick = () => { find.value = ''; go(s.page, s.id); }; main.append(b); }
      return;
    }
    const title = (SETTINGS_PAGES.find((p) => p[0] === page) || SETTINGS_PAGES[0])[1];
    api.setTitle(title + ' – Settings');
    main.append(h('h1', { text: title }), ...PAGES[page]());
    main.scrollTop = 0;
    if (focusId) requestAnimationFrame(() => { const el = main.querySelector(`[data-sid="${focusId}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); } });
  }
  function go(p, focusId) { if (PAGES[p]) page = p; render(focusId); }
  find.addEventListener('input', () => render());
  api.on('settings', (keys) => {
    if (keys.some((k) => ['userName', 'osName'].includes(k))) renderNav();
    if (keys.includes('wallpaper') && page === 'personalization') requestAnimationFrame(() => syncs.forEach((f) => f()));
    syncs.forEach((f) => { try { f(); } catch {} });
  });
  api.on('store', () => { if (page === 'accounts' || page === 'privacy') render(); });
  api.on('caps', () => render());
  api.on('native-info', () => { if (['about', 'system', 'privacy', 'accounts'].includes(page)) render(); });
  api.on('fs', () => { if (page === 'about') render(); });
  api.on('net', () => {
    if (page !== 'network' || find.value.trim()) return;
    if (shapeOfNet() !== netShape) render();
    else syncs.forEach((f) => { try { f(); } catch {} });
  });
  api.onClose(() => { if (nets) nets.destroy(); });
  api.onArgs = (a) => { if (a.page) { find.value = ''; go(a.page, a.focus); } };
  go(page, args.focus);
}
