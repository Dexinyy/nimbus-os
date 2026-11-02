/* ========== Settings: Time & language, Gaming, Accessibility, Privacy & security, Nimbus Update ========== */
const curLocale = () => S.data.locale || undefined;
// The browser's language, unless it is the plain "C" locale a fresh Linux system may start in
const sysLang = () => { const l = navigator.language || ''; try { if (!/^(c|posix)([._-]|$)/i.test(l)) { new Intl.Locale(l); return l; } } catch {} return 'en-US'; };
function clockHero(ctx) {
  const t = h('div', { class: 'ws-clock-big' }), d = h('div', { class: 'ws-d' });
  const tick = () => { t.textContent = fmtTime(false); d.textContent = fmtDT(Date.now(), { dateStyle: 'full' }); };
  tick(); ctx.every(1000, tick);
  const tz = IS_NATIVE ? (Sys.time.st.timezone || (Native.info && Native.info.timezone) || 'UTC') : Intl.DateTimeFormat().resolvedOptions().timeZone;
  let langName = 'English (United States)'; try { langName = new Intl.DisplayNames([curLocale() || sysLang()], { type: 'language' }).of(curLocale() || sysLang()); } catch {}
  return h('div', { class: 'ws-hero time' }, h('div', { class: 'ws-hero-meta' }, t, d), h('div', { class: 'ws-hero-tiles' },
    h('div', { class: 'ws-tile static', html: `<span class="ws-tile-ic">${fi('globeLocation')}</span><span class="ws-tile-t"><b>Time zone</b><span class="ws-d">${esc(tz.replace(/_/g, ' '))}</span></span>` }),
    h('div', { class: 'ws-tile static', html: `<span class="ws-tile-ic">${fi('language')}</span><span class="ws-tile-t"><b>Language</b><span class="ws-d">${esc(langName)}</span></span>` })));
}
defPage('time', { title: 'Time & language', icon: 'time', keywords: 'date clock time zone language region keyboard', render: (ctx) => [
  clockHero(ctx),
  WS.group(null,
    WS.card(ctx, { icon: 'clock', title: 'Date & time', desc: 'Time zones, automatic clock settings, calendar display', go: 'datetime' }),
    WS.card(ctx, { icon: 'language', title: 'Language & region', desc: 'Regional format, date and time formats', go: 'region' }),
    WS.card(ctx, { icon: 'typing', title: 'Typing', desc: 'Keyboard layout, repeat delay and speed', go: 'typing' })),
] });

async function setTimeDialog(ctx) {
  const now = new Date();
  const d = h('input', { type: 'date', class: 'ws-input', value: now.toISOString().slice(0, 10), 'aria-label': 'Date' });
  const t = h('input', { type: 'time', class: 'ws-input', value: now.toTimeString().slice(0, 5), 'aria-label': 'Time' });
  const v = await Dialog.show({ title: 'Change date and time', within: ctx.win, cancelValue: null, content: h('div', { class: 'ws-form' }, h('label', { text: 'Date' }), d, h('label', { text: 'Time' }), t), buttons: [{ label: 'Change', primary: true, value: () => (d.value && t.value ? new Date(d.value + 'T' + t.value).getTime() : undefined) }, { label: 'Cancel', value: null }] });
  if (!v) return;
  try { await Sys.call('timeSet', { time: v }); Sys.time.refresh(); } catch (e) { Notif.push({ app: 'settings', title: 'The time didn’t change', body: e.message }); }
}
defPage('datetime', { title: 'Date & time', parent: 'time', icon: 'clock', keywords: 'time zone set time automatically ntp sync daylight', render: (ctx) => {
  const st = Sys.time.st;
  const auto = () => (IS_NATIVE ? !!Sys.time.st.ntp : true);
  const tz = IS_NATIVE ? buildTzSelect('ws-tz') : null;
  if (tz) { tz.classList.add('ws-input'); tz.style.maxWidth = '280px'; }
  const synced = h('span'); const paintSync = () => { synced.textContent = !IS_NATIVE ? 'Your browser keeps the time' : Sys.time.st.lastSync ? 'Last successful time synchronization: ' + fmtDT(Sys.time.st.lastSync, { dateStyle: 'medium', timeStyle: 'short' }) : Sys.time.st.synced ? 'The clock is synchronized' : 'Not synchronized yet'; };
  ctx.sync(paintSync); paintSync();
  return [
    clockHero(ctx),
    WS.group(null,
      WS.card(ctx, { sid: 'ntp', icon: 'clock', title: 'Set time automatically', desc: IS_NATIVE && !st.canNtp ? 'Time servers aren’t available on this PC' : '', ctl: WS.toggle(ctx, auto, async (v) => { try { await Sys.call('timeSet', { ntp: v }); } catch (e) { Notif.push({ app: 'settings', title: 'Clock', body: e.message }); } await Sys.time.refresh(); ctx.rerender(); }, 'Set time automatically', { disabled: () => !IS_NATIVE }) }),
      WS.card(ctx, { sid: 'setTime', icon: 'calendar', title: 'Set the date and time manually', ctl: WS.button('Change', () => setTimeDialog(ctx), { disabled: auto() }) }),
      WS.card(ctx, { sid: 'timezone', icon: 'globeLocation', title: 'Time zone', desc: IS_NATIVE ? 'Changing it restarts the desktop for a moment' : 'From your browser', ctl: tz || h('span', { class: 'ws-d', text: Intl.DateTimeFormat().resolvedOptions().timeZone }) }),
      WS.card(ctx, { icon: 'sync', iconHtml: WS.ic('update'), title: 'Adjust for daylight saving time automatically', desc: 'Nimbus always follows your time zone’s daylight saving rules' })),
    WS.group('Additional settings',
      WS.card(ctx, { sid: 'syncNow', icon: 'update', title: 'Sync now', desc: synced, ctl: WS.button('Sync now', async (e, b) => { b.disabled = true; try { await Sys.call('timeSync', {}, 60000); } catch (err) { Notif.push({ app: 'settings', title: 'The clock didn’t sync', body: err.message }); } b.disabled = false; Sys.time.refresh(); }, { disabled: !IS_NATIVE || !auto() }) }),
      WS.card(ctx, { sid: 'tbClock', icon: 'taskbar', title: 'Show time and date in the system tray', ctl: WS.settingToggle(ctx, 'tbClock', 'Show time and date in the system tray') }),
      WS.card(ctx, { sid: 'clockSeconds', icon: 'timer', title: 'Show seconds in system tray clock', ctl: WS.settingToggle(ctx, 'clockSeconds', 'Show seconds') }),
      WS.card(ctx, { icon: 'globe', title: 'Additional clocks', desc: 'Clocks for other time zones', ctl: WS.button('Open Clock', () => WM.open('clock', { tab: 'world' })) })),
  ];
} });
defSettings('datetime', [['ntp', 'Set time automatically', 'ntp internet time sync'], ['timezone', 'Time zone', 'zone utc gmt'], ['setTime', 'Change the date and time', 'manual clock'], ['tbClock', 'Show time and date in the system tray', 'clock taskbar']]);

const LOCALES = ['en-US', 'en-GB', 'en-CA', 'en-AU', 'en-IN', 'en-IE', 'en-NZ', 'de-DE', 'de-AT', 'de-CH', 'fr-FR', 'fr-CA', 'es-ES', 'es-MX', 'it-IT', 'nl-NL', 'pt-BR', 'pt-PT', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'pl-PL', 'cs-CZ', 'tr-TR', 'ru-RU', 'uk-UA', 'ja-JP', 'zh-CN', 'zh-TW', 'ko-KR'];
const localeName = (l) => { try { return new Intl.DisplayNames([l], { type: 'language' }).of(l); } catch { return l; } };
const DAYS = (() => { const f = new Intl.DateTimeFormat('en-US', { weekday: 'long' }); return [0, 1, 2, 3, 4, 5, 6].map((d) => f.format(new Date(2023, 0, 1 + d))); })();
defPage('region', { title: 'Language & region', parent: 'time', icon: 'language', keywords: 'language region locale format date format 24 hour first day of week country', render: (ctx) => {
  const sample = new Date(2026, 10, 2, 15, 41, 7);
  const fmts = () => { const L = curLocale(); return [['Calendar', 'Gregorian'], ['First day of week', DAYS[firstDayOfWeek()]], ['Short date', new Intl.DateTimeFormat(L, { dateStyle: 'short' }).format(sample)], ['Long date', new Intl.DateTimeFormat(L, { dateStyle: 'full' }).format(sample)], ['Short time', fmtTimeOf(sample, false)], ['Long time', fmtTimeOf(sample, true)], ['Numbers', (1234567.89).toLocaleString(L)]]; };
  const table = h('dl', { class: 'ws-specs' });
  const paint = () => table.replaceChildren(...fmts().flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
  ctx.sync(paint); paint();
  return [
    WS.group('Language',
      WS.card(ctx, { icon: 'language', title: 'Nimbus display language', desc: 'Nimbus features like Settings and Files appear in this language', ctl: WS.combo(ctx, [['en', 'English (United States)']], () => 'en', () => {}, 'Display language', { width: 220 }) })),
    WS.group('Region',
      WS.expander(ctx, { sid: 'locale', icon: 'globe', title: 'Regional format', desc: 'Nimbus formats dates and times based on your format', ctl: WS.combo(ctx, [['', 'Recommended'], ...LOCALES.map((l) => [l, localeName(l)])], () => S.data.locale || '', (v) => S.set('locale', v), 'Regional format', { width: 240 }), open: true, items: [h('div', { class: 'ws-sub' }, table),
        WS.sub({ sid: 'clock24', title: 'Time format', ctl: WS.combo(ctx, [['', 'From the regional format'], ['12', '12-hour (1:41 PM)'], ['24', '24-hour (13:41)']], () => (S.data.clock24 === true ? '24' : S.data.clock24 === false ? '12' : ''), (v) => S.set('clock24', v === '' ? null : v === '24'), 'Time format', { width: 220 }) }),
        WS.sub({ title: 'First day of week', ctl: WS.combo(ctx, [['', 'From the regional format'], ...DAYS.map((d, i) => [String(i), d])], () => (S.data.weekStart == null ? '' : String(S.data.weekStart)), (v) => S.set('weekStart', v === '' ? null : +v), 'First day of week', { width: 220 }) }),
      ] })),
  ];
} });
defSettings('region', [['locale', 'Regional format', 'date format locale country'], ['clock24', '24-hour time', 'clock format 12 hour']]);
function firstDayOfWeek() {
  if (S.data.weekStart != null) return S.data.weekStart;
  try { const l = new Intl.Locale(curLocale() || sysLang()); const wi = l.getWeekInfo?.() || l.weekInfo; return wi ? wi.firstDay % 7 : 0; } catch { return 0; }
}
function fmtTimeOf(d, withSeconds) {
  const o = { hour: 'numeric', minute: '2-digit' }; if (withSeconds) o.second = '2-digit';
  if (S.data.clock24 === true || S.data.clock24 === false) o.hour12 = !S.data.clock24;
  return new Intl.DateTimeFormat(curLocale(), o).format(d);
}

const KB_LAYOUTS = [['us', 'English (US)', [['', 'US'], ['intl', 'US international'], ['dvorak', 'Dvorak'], ['colemak', 'Colemak']]], ['gb', 'English (UK)', [['', 'UK'], ['extd', 'UK extended']]], ['ie', 'English (Ireland)'], ['ca', 'French (Canada)', [['', 'Canadian French'], ['multix', 'Canadian multilingual']]],
  ['de', 'German', [['', 'German'], ['nodeadkeys', 'German, no dead keys']]], ['ch', 'German (Switzerland)', [['', 'Swiss German'], ['fr', 'Swiss French']]], ['fr', 'French', [['', 'French'], ['oss', 'French (alternative)'], ['bepo', 'French (BÉPO)']]], ['be', 'Belgian'],
  ['es', 'Spanish'], ['latam', 'Spanish (Latin America)'], ['it', 'Italian'], ['pt', 'Portuguese'], ['br', 'Portuguese (Brazil)'], ['nl', 'Dutch'], ['se', 'Swedish'], ['no', 'Norwegian'], ['dk', 'Danish'], ['fi', 'Finnish'], ['is', 'Icelandic'],
  ['pl', 'Polish'], ['cz', 'Czech'], ['sk', 'Slovak'], ['hu', 'Hungarian'], ['ro', 'Romanian'], ['tr', 'Turkish'], ['gr', 'Greek'], ['ru', 'Russian'], ['ua', 'Ukrainian'], ['il', 'Hebrew'], ['ara', 'Arabic'], ['in', 'Indian'], ['jp', 'Japanese'], ['kr', 'Korean']];
defPage('typing', { title: 'Typing', parent: 'time', icon: 'typing', keywords: 'keyboard layout language repeat delay speed', render: (ctx) => {
  const variants = () => { const l = KB_LAYOUTS.find((x) => x[0] === (S.data.kbLayout || 'us')); return (l && l[2]) || [['', l ? l[1] : 'Standard']]; };
  const test = h('input', { class: 'ws-input', placeholder: 'Click here and hold down a key to test the repeat rate', 'aria-label': 'Test the keyboard', style: { width: '100%' } });
  test.addEventListener('click', (e) => e.stopPropagation());
  return [
    WS.group('Keyboard',
      WS.card(ctx, { sid: 'kbLayout', icon: 'keyboard', title: 'Keyboard layout', desc: IS_NATIVE ? 'Used for typing everywhere on this PC' : 'In a browser, your computer’s own layout is used', ctl: WS.combo(ctx, KB_LAYOUTS.map(([v, l]) => [v, l]), () => S.data.kbLayout || 'us', (v) => { S.set('kbVariant', ''); S.set('kbLayout', v); ctx.rerender(); }, 'Keyboard layout', { width: 230, disabled: !IS_NATIVE }) }),
      WS.card(ctx, { sid: 'kbVariant', icon: 'typing', title: 'Layout variant', ctl: WS.combo(ctx, variants, () => S.data.kbVariant || '', (v) => S.set('kbVariant', v), 'Layout variant', { width: 230, disabled: !IS_NATIVE }) })),
    WS.group('Advanced keyboard settings',
      WS.card(ctx, { sid: 'kbDelay', icon: 'timer', title: 'Repeat delay', desc: 'How long you hold a key before it repeats', ctl: WS.settingSlider(ctx, 'kbDelay', { min: 150, max: 1000, step: 50, fmt: (v) => v + ' ms', label: 'Repeat delay', disabled: !IS_NATIVE }) }),
      WS.card(ctx, { sid: 'kbRate', icon: 'gauge', title: 'Repeat rate', desc: 'How fast a held key repeats', ctl: WS.settingSlider(ctx, 'kbRate', { min: 5, max: 60, fmt: (v) => v + ' per second', label: 'Repeat rate', disabled: !IS_NATIVE }) }),
      h('div', { class: 'ws-card' }, test)),
  ];
} });
defSettings('typing', [['kbLayout', 'Keyboard layout', 'language input qwerty azerty dvorak'], ['kbDelay', 'Keyboard repeat delay', 'key repeat'], ['kbRate', 'Keyboard repeat rate', 'key repeat speed']]);

/* ---------- Gaming ---------- */
defPage('gaming', { title: 'Gaming', icon: 'gaming', keywords: 'game mode screenshots captures', render: (ctx) => [WS.group(null,
  WS.card(ctx, { icon: 'captures', title: 'Captures', desc: 'Screenshots, where they’re saved', go: 'captures' }),
  WS.card(ctx, { icon: 'gameMode', title: 'Game Mode', desc: 'Optimize your PC for play', go: 'gamemode' }))] });
defPage('captures', { title: 'Captures', parent: 'gaming', icon: 'captures', keywords: 'screenshot print screen snip', render: (ctx) => [
  WS.group(null,
    WS.card(ctx, { icon: 'folder', title: 'Captures location', desc: 'Pictures › Screenshots', ctl: WS.button('Open folder', () => { const f = Shots.folder(); WM.open('files', { folder: f }); }) })),
  WS.group('Screenshots',
    WS.card(ctx, { sid: 'printScreen', icon: 'keyboard', title: 'Use the Print screen key to take a screenshot', desc: IS_NATIVE ? 'Or press Windows key + Shift + S' : 'Works when Nimbus runs on a computer', ctl: WS.settingToggle(ctx, 'printScreen', 'Use the Print screen key') }),
    WS.card(ctx, { sid: 'shotClip', icon: 'clipboard', title: 'Copy screenshots to the clipboard too', ctl: WS.settingToggle(ctx, 'shotClip', 'Copy screenshots to the clipboard') }),
    WS.card(ctx, { icon: 'captures', title: 'Take a screenshot in 3 seconds', ctl: WS.button('Take screenshot', () => setTimeout(() => Shots.take(), 3000), { disabled: !IS_NATIVE }) })),
] });
defSettings('captures', [['printScreen', 'Print screen key', 'screenshot snip capture prtsc']]);
defPage('gamemode', { title: 'Game Mode', parent: 'gaming', icon: 'gameMode', keywords: 'performance full screen games', render: (ctx) => [
  WS.group(null, WS.card(ctx, { sid: 'gameMode', icon: 'gameMode', title: 'Game Mode', desc: 'When a program is full screen, Nimbus switches to the best performance power mode and holds back notifications', ctl: WS.settingToggle(ctx, 'gameMode', 'Game Mode') })),
  WS.group('Related settings', WS.card(ctx, { icon: 'power', title: 'Power mode', go: 'power' }), WS.card(ctx, { icon: 'graphics', title: 'Graphics', go: 'graphics' })),
] });
defSettings('gamemode', [['gameMode', 'Game Mode', 'performance games']]);

/* ---------- Accessibility ---------- */
defPage('accessibility', { title: 'Accessibility', icon: 'accessibility', keywords: 'vision hearing interaction text size contrast pointer', render: (ctx) => [
  WS.group('Vision',
    WS.card(ctx, { icon: 'textSize', title: 'Text size', desc: 'Text size that appears throughout Nimbus and your apps', go: 'textsize' }),
    WS.card(ctx, { icon: 'visualEffects', title: 'Visual effects', desc: 'Scroll bars, transparency, animations, notification timeout', go: 'visualeffects' }),
    WS.card(ctx, { icon: 'mouse', title: 'Mouse pointer', desc: 'Mouse pointer color, size', go: 'pointer' }),
    WS.card(ctx, { icon: 'contrast', title: 'Contrast themes', desc: 'Color themes for low vision, light sensitivity', go: 'contrast' })),
  WS.group('Hearing', WS.card(ctx, { icon: 'hearing', title: 'Audio', desc: 'Audio notifications, volume', go: 'audioa11y' })),
  WS.group('Interaction', WS.card(ctx, { icon: 'keyboard', title: 'Keyboard', desc: 'Keyboard shortcuts, Print screen', go: 'keyboarda11y' })),
] });
const TEXT_PCTS = [100, 110, 125, 150, 175, 200, 225];
defPage('textsize', { title: 'Text size', parent: 'accessibility', icon: 'textSize', keywords: 'bigger font zoom large text', render: (ctx) => {
  let pct = Math.round((S.data.textSize || 14) / 14 * 100);
  const prev = h('div', { class: 'ws-textprev', text: 'Drag the slider until the text here is easy to read' });
  const paint = () => { prev.style.fontSize = (14 * pct / 100) + 'px'; };
  paint();
  const apply = WS.button('Apply', () => S.set('textSize', Math.round(14 * pct / 100)), { accent: true });
  return [
    h('div', { class: 'ws-card ws-col' }, h('div', { class: 'ws-d', text: 'Text size preview' }), prev),
    WS.group(null, WS.card(ctx, { sid: 'textSize', icon: 'textSize', title: 'Text size', ctl: h('div', { class: 'ws-row' }, WS.slider(ctx, { min: 100, max: 225, step: 5, get: () => pct, set: (v) => { pct = v; paint(); }, fmt: (v) => v + '%', label: 'Text size' }), apply) })),
  ];
} });
defSettings('textsize', [['textSize', 'Text size', 'font bigger larger zoom']]);
defPage('visualeffects', { title: 'Visual effects', parent: 'accessibility', icon: 'visualEffects', keywords: 'animations scroll bars transparency motion', render: (ctx) => [WS.group(null,
  WS.card(ctx, { sid: 'alwaysScrollbars', icon: 'list', title: 'Always show scrollbars', ctl: WS.settingToggle(ctx, 'alwaysScrollbars', 'Always show scrollbars') }),
  WS.card(ctx, { icon: 'visualEffects', title: 'Transparency effects', desc: 'Make some windows and surfaces translucent', ctl: WS.settingToggle(ctx, 'transparency', 'Transparency effects') }),
  WS.card(ctx, { sid: 'reduceMotion', icon: 'sparkle', title: 'Animation effects', ctl: WS.toggle(ctx, () => !S.data.reduceMotion, (v) => S.set('reduceMotion', !v), 'Animation effects') }),
  WS.card(ctx, { icon: 'timer', title: 'Dismiss notifications after this amount of time', ctl: WS.settingCombo(ctx, 'notifTime', [[5, '5 seconds'], [7, '7 seconds'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']], 'Notification time', { width: 140 }) }))] });
defSettings('visualeffects', [['reduceMotion', 'Animation effects', 'reduce motion animations'], ['alwaysScrollbars', 'Always show scrollbars', 'scroll bars']]);
defPage('pointer', { title: 'Mouse pointer', parent: 'accessibility', icon: 'mouse', keywords: 'cursor size color', render: (ctx) => {
  const styleBtn = (v, label) => { const b = h('button', { class: 'ws-ptr ' + v, role: 'radio', 'aria-label': label, 'data-tip': label, html: `<svg viewBox="0 0 24 24"><path d="M5 2.5v17l4.4-4.1 2.9 6.6 2.6-1.1-2.9-6.5H18z"/></svg>` }); b.addEventListener('click', (e) => { e.stopPropagation(); S.set('cursorTheme', v); }); ctx.sync(() => b.setAttribute('aria-checked', String((S.data.cursorTheme || 'white') === v))); b.setAttribute('aria-checked', String((S.data.cursorTheme || 'white') === v)); return b; };
  return [WS.group(null,
    WS.card(ctx, { sid: 'cursorTheme', icon: 'mouse', title: 'Mouse pointer style', ctl: h('div', { class: 'ws-row', role: 'radiogroup', 'aria-label': 'Mouse pointer style' }, styleBtn('white', 'White'), styleBtn('black', 'Black')) }),
    WS.card(ctx, { sid: 'cursorSize', icon: 'scale', title: 'Size', desc: IS_NATIVE ? '' : 'Works when Nimbus runs on a computer', ctl: WS.slider(ctx, { min: 1, max: 10, get: () => Math.round(((S.data.cursorSize || 24) - 24) / 8) + 1, set: (v) => S.set('cursorSize', 24 + (v - 1) * 8), label: 'Pointer size', live: false, disabled: !IS_NATIVE }) })),
    WS.group('Related settings', WS.card(ctx, { icon: 'mouse', title: 'Mouse', desc: 'Pointer speed, primary button, scrolling', go: 'mouse' }))];
} });
defSettings('pointer', [['cursorSize', 'Mouse pointer size', 'cursor bigger'], ['cursorTheme', 'Mouse pointer style', 'cursor color black white']]);
const CONTRAST = [['none', 'None'], ['aquatic', 'Aquatic'], ['desert', 'Desert'], ['dusk', 'Dusk'], ['nightsky', 'Night sky']];
defPage('contrast', { title: 'Contrast themes', parent: 'accessibility', icon: 'contrast', keywords: 'high contrast colors low vision', render: (ctx) => {
  let pick = S.data.contrast || 'none';
  const prev = h('div', { class: 'ws-contrast-prev' });
  const paint = () => { prev.dataset.c = pick; prev.innerHTML = `<div class="cp-title">Title</div><div class="cp-body">Text <a>Hyperlink</a> <span class="cp-dis">Inactive text</span></div><div class="cp-btns"><span class="cp-sel">Selected text</span><span class="cp-btn">Button text</span></div>`; };
  paint();
  return [h('p', { class: 'ws-d ws-intro', text: 'Contrast themes use a small set of distinct colors that make text and apps easier to see in Nimbus.' }), h('div', { class: 'ws-card ws-col' }, prev),
    WS.group(null, WS.card(ctx, { sid: 'contrast', icon: 'contrast', title: 'Contrast themes', ctl: h('div', { class: 'ws-row' }, WS.combo(ctx, CONTRAST, () => pick, (v) => { pick = v; paint(); }, 'Contrast themes', { width: 150 }), WS.button('Apply', () => S.set('contrast', pick), { accent: true })) }))];
} });
defSettings('contrast', [['contrast', 'Contrast themes', 'high contrast aquatic desert dusk night sky']]);
defPage('audioa11y', { title: 'Audio', parent: 'accessibility', icon: 'hearing', keywords: 'flash screen notifications hearing', render: (ctx) => [
  WS.group(null,
    WS.card(ctx, { sid: 'flashNotify', icon: 'flash', title: 'Flash my screen during audio notifications', desc: 'The screen flashes when Nimbus plays a notification sound', ctl: WS.settingToggle(ctx, 'flashNotify', 'Flash my screen') }),
    WS.card(ctx, { icon: 'sound', title: 'Volume', go: 'sound' })),
] });
defSettings('audioa11y', [['flashNotify', 'Flash my screen during audio notifications', 'visual alert deaf hearing']]);
const SHORTCUTS = [['Win', 'Open or close Start'], ['Win+X', 'Open the quick link menu'], ['Win+V', 'Open clipboard history'], ['Win+Shift+S', 'Take a screenshot'], ['Print screen', 'Take a screenshot'], ['Alt+Tab', 'Switch between open windows'], ['Alt+F4', 'Close the active window'], ['Ctrl+Shift+Esc', 'Open Task Manager'], ['Ctrl+K', 'Search apps, files and settings'], ['Ctrl+Alt+T', 'Open Terminal'], ['Ctrl+Alt+D', 'Show the desktop'], ['Ctrl+Alt+L', 'Lock'], ['Alt+Shift+Arrows', 'Snap the active window'], ['F2', 'Rename the selected file'], ['Delete', 'Move to the Recycle Bin'], ['Esc', 'Close menus and flyouts']];
defPage('keyboarda11y', { title: 'Keyboard', parent: 'accessibility', icon: 'keyboard', keywords: 'shortcuts hotkeys print screen', render: (ctx) => [
  WS.group(null, WS.card(ctx, { icon: 'captures', title: 'Use the Print screen key to take a screenshot', ctl: WS.settingToggle(ctx, 'printScreen', 'Use the Print screen key') })),
  WS.group('Keyboard shortcuts', h('div', { class: 'ws-card ws-col', 'data-sid': 'shortcuts' }, h('dl', { class: 'ws-keys' }, ...SHORTCUTS.flatMap(([k, d]) => [h('dt', {}, ...k.split('+').flatMap((p, i) => (i ? ['+', h('kbd', { text: p })] : [h('kbd', { text: p })]))), h('dd', { text: d })])))),
] });
defSettings('keyboarda11y', [['shortcuts', 'Keyboard shortcuts', 'keys hotkeys']]);

/* ---------- Privacy & security ---------- */
defPage('privacy', { title: 'Privacy & security', icon: 'privacy', keywords: 'privacy permissions camera microphone location activity diagnostics', render: (ctx) => [
  WS.group('Nimbus permissions',
    WS.card(ctx, { icon: 'shieldCheck', title: 'General', desc: 'Ads, tracking, accounts', go: 'privgeneral' }),
    WS.card(ctx, { icon: 'diagnostics', title: 'Diagnostics & feedback', desc: 'Diagnostic data, feedback frequency', go: 'diagnostics' }),
    WS.card(ctx, { icon: 'history', title: 'Activity history', desc: 'Options for getting more from your activity history across files and settings', go: 'activity' }),
    WS.card(ctx, { icon: 'search', title: 'Search permissions', desc: 'What search looks through, search history', go: 'searchperms' })),
  WS.group('App permissions',
    WS.card(ctx, { icon: 'location', title: 'Location', go: 'locationperm' }),
    WS.card(ctx, { icon: 'camera', title: 'Camera', desc: S.data.camAccess === false ? 'Off' : 'On', go: 'cameraperm' }),
    WS.card(ctx, { icon: 'mic', title: 'Microphone', desc: S.data.micAccess === false ? 'Off' : 'On', go: 'micperm' }),
    WS.card(ctx, { icon: 'notifications', title: 'Notifications', go: 'notifications' })),
] });
const pvFacts = () => {
  const cloudOn = Store.status && Store.status.cloud === 'on';
  return [
    ['shieldCheck', 'No ads, anywhere', 'Start, search and the lock screen never show ads or suggested apps. There is no advertising ID to switch off.'],
    ['eyeOff', 'No tracking', 'Nimbus doesn’t collect usage data and sends nothing about you to anyone.'],
    ['person', 'No account required', 'You use a local account. There is no online account to create or sign in to.'],
    [cloudOn ? 'cloud' : 'save', 'Where your data lives', cloudOn ? 'Your files and settings are kept in a private space in your Claude account. Other people who open Nimbus get their own copy.' : IS_NATIVE ? (Native.live && !Storage.saving ? 'This is a live session started from a USB stick or disc, so nothing is kept after you shut down.' : 'Your files and settings are kept on this computer.') : 'Your files and settings are kept in this browser.'],
    caps.sample ? ['sparkle', 'The assistant', 'It runs only when you send it a message. It sees your message, your settings and the names of your files, and it uses your Claude account.'] : null,
  ].filter(Boolean);
};
defPage('privgeneral', { title: 'General', parent: 'privacy', icon: 'shieldCheck', keywords: 'ads advertising id tracking', render: (ctx) => [WS.group(null, ...pvFacts().map(([ic, t, d]) => WS.card(ctx, { icon: ic, title: t, desc: d })))] });
defPage('diagnostics', { title: 'Diagnostics & feedback', parent: 'privacy', icon: 'diagnostics', keywords: 'telemetry diagnostic data feedback', render: (ctx) => [WS.group(null,
  WS.card(ctx, { icon: 'diagnostics', title: 'Diagnostic data', desc: 'Off. Nimbus has no diagnostic data service, so nothing about this PC is sent anywhere.' }),
  WS.card(ctx, { icon: 'chat', iconHtml: WS.ic('notifications'), title: 'Feedback frequency', desc: 'Nimbus never asks for feedback' }),
  IS_NATIVE ? WS.card(ctx, { icon: 'document', title: 'View the system log', desc: 'What Nimbus writes down while it runs stays on this PC. Open it in Terminal with: journalctl -b', ctl: WS.button('Open Terminal', () => WM.open('terminal')) }) : null)] });
defPage('activity', { title: 'Activity history', parent: 'privacy', icon: 'history', keywords: 'recent files history clear', render: (ctx) => [WS.group(null,
  WS.card(ctx, { sid: 'keepRecent', icon: 'history', title: 'Store my activity history on this device', desc: 'Recent files in Start and Files, and recently used settings', ctl: WS.toggle(ctx, () => S.data.keepRecent !== false, (v) => { S.set('keepRecent', v); if (!v) { S.set('recent', []); S.set('settingsRecent', []); } }, 'Store my activity history') }),
  WS.card(ctx, { sid: 'clearActivity', icon: 'delete', title: 'Clear activity history', ctl: WS.button('Clear history', () => { S.set('recent', []); S.set('settingsRecent', []); Notif.push({ app: 'settings', title: 'Activity history cleared', silent: true }); }) }))] });
defSettings('activity', [['clearActivity', 'Clear activity history', 'recent files'], ['keepRecent', 'Store my activity history', 'recent files track']]);
defPage('searchperms', { title: 'Search permissions', parent: 'privacy', icon: 'search', keywords: 'search files cloud history', render: (ctx) => [WS.group(null,
  WS.card(ctx, { sid: 'searchFiles', icon: 'folder', title: 'Search my files', desc: 'Show files and folders when you search from Start', ctl: WS.toggle(ctx, () => S.data.searchFiles !== false, (v) => S.set('searchFiles', v), 'Search my files') }),
  WS.card(ctx, { icon: 'cloud', title: 'Cloud content search', desc: 'Off. Search in Nimbus never goes online.' }),
  WS.card(ctx, { icon: 'history', title: 'Search history', desc: 'Nimbus doesn’t keep a history of what you search for.' }))] });
defPage('locationperm', { title: 'Location', parent: 'privacy', icon: 'location', keywords: 'gps location services', render: (ctx) => [WS.group(null,
  WS.card(ctx, { icon: 'location', title: 'Location services', desc: 'Nimbus has no location service, so programs can’t find out where you are from this PC.' }),
  caps.programs ? WS.card(ctx, { icon: 'globe', title: 'Websites', desc: 'Sites in Google Chrome ask Chrome first, and Chrome can only guess an approximate location from your network.' }) : null)] });
defPage('cameraperm', { title: 'Camera', parent: 'privacy', icon: 'camera', keywords: 'webcam access block', render: (ctx) => [WS.group(null,
  WS.card(ctx, { sid: 'camAccess', icon: 'camera', title: 'Camera access', desc: 'When it’s off, no program on this PC can use a camera', ctl: WS.toggle(ctx, () => S.data.camAccess !== false, async (v) => { try { if (IS_NATIVE) await Sys.call('privacySet', { camera: v }, 30000); S.set('camAccess', v); } catch (e) { Notif.push({ app: 'settings', title: 'Camera access didn’t change', body: e.message }); } }, 'Camera access', { disabled: !IS_NATIVE }) }),
  caps.programs ? WS.card(ctx, { icon: 'globe', title: 'Google Chrome', desc: 'Chrome asks before each website uses your camera' }) : null)] });
defSettings('cameraperm', [['camAccess', 'Camera access', 'webcam privacy block']]);
defPage('micperm', { title: 'Microphone', parent: 'privacy', icon: 'mic', keywords: 'microphone access mute block', render: (ctx) => [WS.group(null,
  WS.card(ctx, { sid: 'micAccess', icon: 'mic', title: 'Microphone access', desc: 'When it’s off, Nimbus keeps every microphone muted', ctl: WS.toggle(ctx, () => S.data.micAccess !== false, (v) => S.set('micAccess', v), 'Microphone access', { disabled: !IS_NATIVE }) }),
  caps.programs ? WS.card(ctx, { icon: 'globe', title: 'Google Chrome', desc: 'Chrome asks before each website uses your microphone' }) : null)] });
defSettings('micperm', [['micAccess', 'Microphone access', 'mic privacy mute block']]);

/* ---------- Nimbus Update ---------- */
const Upd = { st: null, busy: false, error: '' };
function updateLine() {
  if (!IS_NATIVE) return 'Updates with the page';
  if (Upd.busy) return 'Checking for updates…';
  const s = Upd.st;
  if (s && (s.nimbusNew || (s.chrome && s.chrome.update))) return 'Updates available';
  const at = S.data.updChecked;
  return at ? 'Last checked: ' + relTime(at) : 'Check for updates';
}
async function checkUpdates(ctx) {
  if (!IS_NATIVE || Upd.busy) return;
  Upd.busy = true; Upd.error = ''; ctx?.rerender();
  try { Upd.st = await Sys.call('updateCheck', {}, 120000); S.set('updChecked', Date.now()); }
  catch (e) { Upd.error = e.message; }
  Upd.busy = false; bus.emit('sys', 'update'); ctx?.rerender();
}
defPage('update', { title: 'Nimbus Update', icon: 'update', keywords: 'updates check version upgrade chrome', render: (ctx) => {
  const s = Upd.st; const paused = S.data.updPause && S.data.updPause > Date.now();
  const anyNew = s && (s.nimbusNew || (s.chrome && s.chrome.update));
  const title = !IS_NATIVE ? 'Nimbus updates when the page does' : Upd.busy ? 'Checking for updates…' : Upd.error ? 'We couldn’t check for updates' : anyNew ? 'Updates available' : paused ? 'Updates are paused' : 'You’re up to date';
  const sub = !IS_NATIVE ? 'Every time you open it, you get the latest version.' : Upd.error ? Upd.error : paused ? 'Until ' + fmtDT(S.data.updPause, { dateStyle: 'medium' }) : S.data.updChecked ? 'Last checked: ' + fmtDT(S.data.updChecked, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const items = [];
  if (s && s.nimbusNew) items.push(WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon('logo')}</span>`, title: `Nimbus OS ${s.latest.name || ''}`.trim(), desc: `A new version was published ${fmtDT(s.latest.date, { dateStyle: 'medium' })}. Download it and write it to your USB stick to update.`, ctl: WS.button('Download', () => (caps.programs ? Apps.openUrl(s.latest.url) : copyText(s.latest.url)), { accent: true }) }));
  if (s && s.chrome && s.chrome.update) items.push(WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon(APPS.chrome.icon)}</span>`, title: `Google Chrome ${s.chrome.candidate}`, desc: `You have ${s.chrome.version}`, ctl: WS.button('Update now', async (e, b) => { b.disabled = true; b.textContent = 'Updating…'; try { await Sys.call('programUpdate', { app: 'chrome' }, 600000); Notif.push({ app: 'settings', title: 'Google Chrome is up to date', silent: true }); } catch (err) { Notif.push({ app: 'settings', title: 'Couldn’t update Chrome', body: err.message }); } await Apps.refresh(); checkUpdates(ctx); }, { accent: true }) }));
  if (IS_NATIVE && !Upd.st && !Upd.busy && !Upd.error && (!S.data.updChecked || Date.now() - S.data.updChecked > 3600e3)) setTimeout(() => checkUpdates(ctx), 50);
  const pauseOpts = [[0, paused ? 'Resume updates' : 'Not paused'], ...[1, 2, 3, 4, 5].map((w) => [w, `Pause for ${w} week${w === 1 ? '' : 's'}`])];
  if (paused) pauseOpts.unshift(['p', 'Paused until ' + fmtDT(S.data.updPause, { month: 'short', day: 'numeric' })]);
  return [
    h('div', { class: 'ws-hero upd' + (anyNew ? ' new' : '') }, frag(`<span class="ws-upd-ic">${fi(Upd.busy ? 'update' : anyNew ? 'download' : Upd.error ? 'warning' : 'updateCheck')}</span>`),
      h('div', { class: 'ws-hero-meta' }, h('div', { class: 'ws-hero-name', text: title }), h('div', { class: 'ws-d', text: sub })),
      IS_NATIVE ? WS.button(Upd.busy ? 'Checking…' : 'Check for updates', () => checkUpdates(ctx), { accent: true, disabled: Upd.busy }) : null),
    items.length ? WS.group(null, items) : null,
    WS.group('More options',
      IS_NATIVE ? WS.card(ctx, { sid: 'updPause', icon: 'pause', title: 'Pause updates', desc: paused ? 'Programs won’t update by themselves until then' : '', ctl: WS.combo(ctx, pauseOpts, () => (paused ? 'p' : 0), (v) => { if (v === 'p') return; S.set('updPause', +v ? Date.now() + (+v) * 7 * 86400e3 : 0); ctx.rerender(); }, 'Pause updates', { width: 200 }) }) : null,
      WS.card(ctx, { icon: 'history', title: 'Update history', go: 'updatehistory' }),
      WS.card(ctx, { icon: 'settings', title: 'Advanced options', desc: 'Updates for programs, metered connections', go: 'updateadvanced' })),
  ];
} });
defSettings('update', [['updPause', 'Pause updates', 'stop delay']]);
defPage('updatehistory', { title: 'Update history', parent: 'update', icon: 'history', keywords: 'installed updates', render: (ctx) => {
  const box = h('div', { class: 'ws-cards' });
  const info = IS_NATIVE && Native.info;
  box.append(WS.card(ctx, { iconHtml: `<span class="ws-appic">${appIcon('logo')}</span>`, title: osTitle() + ' ' + ((info && info.version) || '0.1'), desc: info && info.built ? 'Built ' + fmtDT(info.built * 1000, { dateStyle: 'medium' }) + (info.build ? ' · build ' + info.build : '') : 'This version' }));
  if (IS_NATIVE) Sys.call('updateHistory').then((list) => { for (const u of list) box.append(WS.card(ctx, { icon: u.ok ? 'checkCircle' : 'error', title: u.name, desc: (u.ok ? 'Successfully installed on ' : 'Failed to install on ') + fmtDT(u.time * 1000, { dateStyle: 'medium' }) + (u.detail ? ' · ' + u.detail : '') })); }).catch(() => {});
  return [WS.group('Updates', box)];
} });
defPage('updateadvanced', { title: 'Advanced options', parent: 'update', icon: 'settings', keywords: 'metered automatic updates chrome', render: (ctx) => [WS.group(null,
  WS.card(ctx, { sid: 'autoUpdate', icon: 'apps', title: 'Receive updates for other programs', desc: 'Keep Google Chrome up to date by itself', ctl: WS.toggle(ctx, () => S.data.autoUpdate !== false, (v) => S.set('autoUpdate', v), 'Receive updates for other programs') }),
  WS.card(ctx, { sid: 'updMetered', icon: 'dataUsage', title: 'Download updates over metered connections', ctl: WS.settingToggle(ctx, 'updMetered', 'Download updates over metered connections') }),
  WS.card(ctx, { sid: 'updNotify', icon: 'notifications', title: 'Tell me when updates are available', ctl: WS.toggle(ctx, () => S.data.updNotify !== false, (v) => S.set('updNotify', v), 'Tell me when updates are available') }))] });
defSettings('updateadvanced', [['autoUpdate', 'Automatic program updates', 'chrome update'], ['updMetered', 'Download updates over metered connections', 'data']]);
