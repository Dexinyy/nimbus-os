/* ========== Store ==========
   Apps and games, like the Microsoft Store: Flathub's apps (Steam, Discord, Spotify...) installed for this user
   with flatpak, and Windows game launchers (Battle.net, EA app, Ubisoft Connect) that Lutris sets up and runs
   with Wine. The machine side is os/overlay/usr/lib/nimbus/nimbus_store.py. */

/* What's installed: Flathub apps (one entry per menu item they bring) and Lutris's games, listed in Start,
   search, the taskbar and Settings like Nimbus's own apps. */
const Programs = {
  list: [], loaded: false,
  async refresh() {
    if (!IS_NATIVE || !caps.programs) return this.list;
    let list;
    try { list = (await Native.call('programs', {}, 30000)) || []; } catch (e) { console.warn('programs:', e.message); return this.list; }
    const ids = new Set(list.map((p) => p.id));
    for (const id of Object.keys(APPS)) if (APPS[id].program && !ids.has(id)) delete APPS[id];
    for (const p of list) {
      APPS[p.id] = Object.assign(APPS[p.id] || {}, {
        name: p.name, icon: p.icon || (p.kind === 'lutris' ? 'launcher' : 'app'), desc: p.desc || '', requires: 'programs', program: p,
        keywords: [p.keywords, (p.cats || []).join(' '), p.app].filter(Boolean).join(' ').toLowerCase(),
        launch: () => Programs.launch(p.id),
      });
    }
    this.list = list; this.loaded = true;
    // windows that opened before the list was known get their app's button now
    for (const w of WM.list()) {
      if (!w.native || !w.flatpak) continue;
      const id = this.forWindow(w.cls, { flatpak: w.flatpak, title: w.title });
      if (id && id !== w.appId && APPS[id]) { w.appId = id; w.app = APPS[id]; w.el.dataset.app = id; }
    }
    bus.emit('apps'); bus.emit('wm');
    return list;
  },
  byApp(app) { return this.list.filter((p) => p.app === app); },
  installed(app) { return app.startsWith('lutris:') ? this.list.some((p) => p.id === app) : this.list.some((p) => p.app === app); },
  async launch(id) {
    try { await Native.call('programLaunch', { id }); S.set('appUse', Object.assign({}, S.data.appUse, { [id]: ((S.data.appUse || {})[id] || 0) + 1 })); }
    catch (e) { Notif.push({ app: 'store', title: (APPS[id] ? APPS[id].name : 'The app') + ' could not start', body: e.message }); }
  },
  async uninstall(id, within) {
    const p = this.list.find((x) => x.id === id); if (!p) return false;
    if (p.kind === 'lutris') { Dialog.alert('Uninstall ' + p.name, 'Lutris installed ' + p.name + ': open Lutris, right-click ' + p.name + ' and choose Uninstall.', within); return false; }
    const name = (this.byApp(p.app).length > 1 ? (APPS['fp:' + p.app] || p).name : p.name);
    const keep = h('input', { type: 'checkbox', id: 'un-data' });
    const ok = await Dialog.show({ title: 'Uninstall ' + name + '?', within, cancelValue: false,
      content: h('div', {}, h('p', { text: 'This app will be removed, with what it needed that no other app uses.' }),
        h('label', { class: 'chk', for: 'un-data' }, keep, h('span', { text: ' Also delete its data and settings' }))),
      buttons: [{ label: 'Uninstall', value: () => ({ data: keep.checked }), primary: true, danger: true }, { label: 'Cancel', value: false }] });
    if (!ok) return false;
    StoreJobs.set(p.app, { state: 'removing', progress: null, text: 'Uninstalling' });
    try {
      await Native.call('storeRemove', { id: p.app, data: ok.data }, 30 * 60 * 1000);
      Notif.push({ app: 'store', title: name + ' was uninstalled', silent: true });
    } catch (e) { Notif.push({ app: 'store', title: 'Couldn’t uninstall ' + name, body: e.message }); }
    StoreJobs.clear(p.app);
    await this.refresh();
    return true;
  },
  // A window's taskbar button: the Store app it belongs to (by its sandbox and its window class), if any
  forWindow(cls, ev) {
    const fp = ev && ev.flatpak; if (!fp || !this.loaded) return null;
    const c = String(cls || '').toLowerCase();
    const mine = this.byApp(fp);
    const exact = this.list.find((p) => p.wmclass && p.wmclass.toLowerCase() === c);
    if (exact) return exact.id;
    if (fp === 'net.lutris.Lutris') {
      const game = this.list.find((p) => p.kind === 'lutris' && p.wmclass && new RegExp(p.wmclass, 'i').test(c + ' ' + (ev.title || '')));
      if (game) return game.id;
      if (/\.exe$/.test(c)) return null; // a Windows program Lutris runs: a button of its own
    }
    if (fp === 'com.valvesoftware.Steam' && c && !/^(steam|steamwebhelper|com\.valvesoftware\.steam)$/.test(c)) return null; // a game
    if (!mine.length) return null;
    return (mine.find((p) => p.id === 'fp:' + fp) || mine[0]).id;
  },
};
if (IS_NATIVE) bus.on('native:programs-changed', () => Programs.refresh());

/* Installs, updates and removals going on, for every Store window (and the Library's badge) */
const StoreJobs = {
  jobs: {},
  set(id, j) { this.jobs[id] = Object.assign(this.jobs[id] || {}, j); bus.emit('store-job', id); },
  clear(id) { delete this.jobs[id]; bus.emit('store-job', id); },
  count() { return Object.keys(this.jobs).length; },
};
if (IS_NATIVE) bus.on('native:store-progress', (p) => {
  if (!p) return;
  if (p.state === 'catalog') { bus.emit('store-catalog', p); return; }
  if (!StoreJobs.jobs[p.id]) return; // finished already
  StoreJobs.set(p.id, { progress: p.progress, text: p.text || StoreJobs.jobs[p.id].text });
});

const STORE_CATS = [
  ['Game', 'Games', 'mines'], ['AudioVideo', 'Music & video', 'video'], ['Graphics', 'Photo & design', 'photos'], ['Office', 'Productivity', 'notes'],
  ['Network', 'Internet & chat', 'globe'], ['Development', 'Developer tools', 'terminal'], ['Education', 'Education', 'book'], ['Utility', 'Utilities', 'tools'],
];
const STORE_HEROES = [
  { id: 'com.valvesoftware.Steam', tag: 'Gaming', title: 'Steam', text: 'Thousands of games, many of them made for Windows, play here through Proton.', bg: 'linear-gradient(115deg,#0b1b33 0%,#16406e 55%,#1f6aa8 100%)' },
  { id: 'com.discordapp.Discord', tag: 'Chat with friends', title: 'Discord', text: 'Voice, video and text with your friends and communities.', bg: 'linear-gradient(115deg,#2b2d7c 0%,#5865f2 60%,#7b85ff 100%)' },
  { id: 'lutris:battlenet', tag: 'Gaming', title: 'Battle.net', text: 'Blizzard’s games, set up for you with Lutris.', bg: 'linear-gradient(115deg,#05101f 0%,#0a2e59 55%,#148eff 100%)' },
];

function mountStore(root, api, args) {
  root.classList.add('app-store');
  const live = Native.info && Native.info.live && !Native.info.persistent;
  let page = null, history = [], ready = null, heroT = 0;
  const main = h('div', { class: 'ms-main', tabindex: '-1' });
  const nav = h('nav', { class: 'ms-nav', 'aria-label': 'Store' });
  const navItem = (id, label, icon) => {
    const b = h('button', { class: 'ms-nav-i', 'data-page': id, 'aria-label': label, html: fi(icon) + `<span>${esc(label)}</span>` });
    b.addEventListener('click', () => go(id));
    return b;
  };
  const libBtn = navItem('library', 'Library', 'library');
  const badge = h('span', { class: 'ms-badge', hidden: true });
  libBtn.append(badge);
  nav.append(navItem('home', 'Home', 'home'), navItem('apps', 'Apps', 'apps'), navItem('gaming', 'Gaming', 'games'), h('div', { class: 'ms-nav-sp' }), libBtn);
  root.append(nav, main);

  // Search in the title bar, as in the Microsoft Store
  const search = h('input', { type: 'search', class: 'ms-search', placeholder: 'Search apps, games and more', 'aria-label': 'Search the Store', spellcheck: 'false' });
  const sbox = h('div', { class: 'ms-searchbox', html: fi('search') }, search);
  api.titlebar(sbox);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && search.value.trim()) go('search', { q: search.value.trim() }); });
  const back = h('button', { class: 'ws-back', 'aria-label': 'Back', html: fi('arrowLeft'), hidden: true });
  back.addEventListener('click', () => { const prev = history.pop(); if (prev) go(prev.id, prev.params, true); });
  api.titlebarLead(back);

  const offJob = bus.on('store-job', () => paintBadge());
  api.onClose(offJob);
  function paintBadge() {
    const n = StoreJobs.count();
    badge.hidden = !n; badge.textContent = n ? String(n) : '';
  }
  paintBadge();

  function go(id, params = {}, isBack) {
    if (page && !isBack) history.push(page);
    if (history.length > 30) history.shift();
    page = { id, params };
    back.hidden = !history.length;
    nav.querySelectorAll('.ms-nav-i').forEach((b) => b.classList.toggle('on', b.dataset.page === id || (id === 'search' && false)));
    clearInterval(heroT);
    if (id !== 'app') api.setTitle('Store');
    if (id !== 'search' && id !== 'app') search.value = '';
    main.replaceChildren();
    main.scrollTop = 0;
    const render = { home: renderHome, apps: renderApps, gaming: renderGaming, library: renderLibrary, search: renderSearch, app: renderApp }[id] || renderHome;
    const box = h('div', { class: 'ms-page ms-' + id });
    main.append(box);
    if (live && id !== 'app') box.append(liveNote());
    Promise.resolve(render(box, params)).catch((e) => { box.append(errorBox(e, () => go(id, params, true))); });
    if (id === 'search') search.value = params.q || '';
  }

  function liveNote() {
    const n = h('div', { class: 'ms-note', html: ui('info') + '<span>Saving isn’t on: apps you get are removed when you restart, and they use memory until then. <a href="#">Set up saving</a> to keep them.</span>' });
    n.querySelector('a').addEventListener('click', (e) => { e.preventDefault(); Storage.open(); });
    return n;
  }
  function errorBox(e, retry) {
    const msg = String(e && e.message || e || 'Something went wrong');
    return h('div', { class: 'ms-empty' }, h('div', { class: 'ms-empty-ic', html: fi('cloudOff') }), h('h2', { text: 'The Store couldn’t load this' }),
      h('p', { class: 'muted', text: msg }), h('div', { class: 'ms-row' }, h('button', { class: 'btn', text: 'Network settings', onclick: () => WM.open('settings', { page: 'network' }) }), h('button', { class: 'btn primary', text: 'Try again', onclick: retry })));
  }

  // The catalog (Flathub's list of apps) is downloaded the first time, then refreshed now and then
  function ensureReady(box) {
    if (!ready) {
      ready = (async () => {
        const st = await Native.call('storeStatus');
        if (!st.flatpak) throw new Error('Flatpak isn’t installed on this system, so apps can’t be installed.');
        if (st.catalogAge == null) {
          const wait = h('div', { class: 'ms-empty' }, h('div', { class: 'ms-spin' }), h('h2', { text: 'Getting the Store ready' }),
            h('p', { class: 'muted ms-wait-t', text: 'Downloading the list of apps from Flathub (about 30 MB, only this once)…' }));
          box.append(wait);
          const off = bus.on('store-catalog', (p) => { if (p.text) wait.querySelector('.ms-wait-t').textContent = p.text + '…'; });
          try { await Native.call('storeCatalog', {}, 30 * 60 * 1000); } finally { off(); wait.remove(); }
        } else if (st.catalogAge > 86400) {
          Native.call('storeCatalog', { refresh: true }, 30 * 60 * 1000).catch(() => {}); // fresh enough to use meanwhile
        }
        if (!Programs.loaded) await Programs.refresh();
      })();
      ready.catch(() => { ready = null; });
    }
    return ready;
  }

  /* ---- pieces ---- */
  function iconEl(item, cls = '') {
    const wrap = h('span', { class: 'ms-ic ' + cls });
    const src = item.icon || item.iconUrl;
    const local = APPS[item.id] && APPS[item.id].program ? APPS[item.id].icon : null;
    if (src) {
      const img = h('img', { src, alt: '', loading: 'lazy', draggable: 'false' });
      img.addEventListener('error', () => { wrap.innerHTML = appIcon(local || (item.id.startsWith('lutris:') ? 'launcher' : 'app')); }, { once: true });
      wrap.append(img);
    } else wrap.innerHTML = appIcon(local || (item.id.startsWith('lutris:') ? 'launcher' : 'app'));
    return wrap;
  }
  const catName = (cats) => { const c = (cats || []).map((x) => STORE_CATS.find((k) => k[0] === x)).find(Boolean); return c ? c[1] : (cats || []).includes('Game') ? 'Games' : 'App'; };
  function card(item) {
    const owned = Programs.installed(item.id);
    const c = h('button', { class: 'ms-card', 'aria-label': item.name },
      iconEl(item), h('span', { class: 'ms-card-n', text: item.name }),
      h('span', { class: 'ms-card-c', text: item.via ? 'Windows launcher · via ' + item.via : catName(item.cats) }),
      h('span', { class: 'ms-card-p' + (owned ? ' owned' : ''), text: owned ? 'Installed' : 'Free' }));
    c.addEventListener('click', () => go('app', { id: item.id }));
    return c;
  }
  function row(title, items, more) {
    const head = h('div', { class: 'ms-sec-h' }, h('h2', { text: title }));
    if (more) head.append(h('button', { class: 'ms-more', html: 'See all ' + fi('chevronRight'), onclick: more }));
    return h('section', { class: 'ms-sec' }, head, h('div', { class: 'ms-grid' }, items.map(card)));
  }
  function hero(items) {
    const box = h('div', { class: 'ms-hero' });
    const slides = items.map((x, i) => {
      const info = STORE_HEROES.find((s) => s.id === x.id) || {};
      const s = h('div', { class: 'ms-slide' + (i ? '' : ' on'), style: { background: info.bg || 'linear-gradient(115deg,#123,#345)' } },
        h('div', { class: 'ms-slide-t' }, h('span', { class: 'ms-tag', text: info.tag || catName(x.cats) }), h('h1', { text: info.title || x.name }),
          h('p', { text: info.text || x.summary }), h('button', { class: 'btn primary', text: Programs.installed(x.id) ? 'Open' : 'See details', onclick: (e) => { e.stopPropagation(); go('app', { id: x.id }); } })),
        iconEl(x, 'big'));
      s.addEventListener('click', () => go('app', { id: x.id }));
      return s;
    });
    const dots = h('div', { class: 'ms-dots' });
    let cur = 0;
    const show = (i) => { cur = (i + slides.length) % slides.length; slides.forEach((s, k) => s.classList.toggle('on', k === cur)); dots.querySelectorAll('button').forEach((d, k) => d.classList.toggle('on', k === cur)); };
    slides.forEach((_s, i) => dots.append(h('button', { class: i ? '' : 'on', 'aria-label': 'Show ' + items[i].name, onclick: () => { show(i); clearInterval(heroT); } })));
    box.append(...slides, dots);
    if (!motionOff() && slides.length > 1) heroT = setInterval(() => { if (root.isConnected) show(cur + 1); else clearInterval(heroT); }, 7000);
    return box;
  }
  function loading(box) { const l = h('div', { class: 'ms-loading' }, h('div', { class: 'ms-spin' })); box.append(l); return l; }

  /* ---- pages ---- */
  async function renderHome(box) {
    await ensureReady(box);
    const l = loading(box);
    const home = await Native.call('storeHome');
    l.remove();
    const heroes = STORE_HEROES.map((x) => [...home.gaming, ...home.essentials].find((i) => i.id === x.id)).filter(Boolean);
    box.append(h('h1', { class: 'ms-h1', text: 'Home' }));
    if (heroes.length) box.append(hero(heroes));
    box.append(row('Games and launchers', home.gaming.slice(0, 12), () => go('gaming')), row('Essential apps', home.essentials, () => go('apps')));
  }
  async function renderGaming(box) {
    await ensureReady(box);
    const l = loading(box);
    const [home, games] = await Promise.all([Native.call('storeHome'), Native.call('storeSearch', { q: '', category: 'Game', limit: 60 })]);
    l.remove();
    box.append(h('h1', { class: 'ms-h1', text: 'Gaming' }),
      h('p', { class: 'ms-intro muted', text: 'Steam plays thousands of Windows games through Proton. Battle.net, the EA app and Ubisoft Connect are Windows launchers that Lutris sets up and runs for you. Controllers (Xbox, PlayStation, Switch Pro and more) work as soon as you plug them in or pair them.' }),
      row('Launchers and stores', home.gaming), row('Games', games.filter((g) => !g.id.startsWith('lutris:'))));
  }
  async function renderApps(box, params) {
    await ensureReady(box);
    const cat = params.cat || '';
    const chips = h('div', { class: 'ms-chips' }, [['', 'Top apps'], ...STORE_CATS.filter((c) => c[0] !== 'Game')].map(([id, label]) =>
      h('button', { class: 'ms-chip' + (id === cat ? ' on' : ''), text: label, onclick: () => go('apps', { cat: id }) })));
    box.append(h('h1', { class: 'ms-h1', text: 'Apps' }), chips);
    const l = loading(box);
    const items = cat ? await Native.call('storeSearch', { q: '', category: cat, limit: 72 }) : (await Native.call('storeHome')).essentials;
    l.remove();
    box.append(h('section', { class: 'ms-sec' }, h('div', { class: 'ms-grid' }, items.map(card))));
  }
  async function renderSearch(box, params) {
    await ensureReady(box);
    const q = params.q || '';
    box.append(h('h1', { class: 'ms-h1', text: 'Results for “' + q + '”' }));
    const l = loading(box);
    const items = await Native.call('storeSearch', { q, limit: 60 });
    l.remove();
    if (!items.length) { box.append(h('div', { class: 'ms-empty' }, h('div', { class: 'ms-empty-ic', html: fi('search') }), h('h2', { text: 'No results' }), h('p', { class: 'muted', text: 'Check the spelling, or try a different word.' }))); return; }
    const games = items.filter((x) => (x.cats || []).includes('Game')), apps = items.filter((x) => !(x.cats || []).includes('Game'));
    if (apps.length) box.append(row('Apps', apps));
    if (games.length) box.append(row('Games', games));
  }

  async function renderApp(box, params) {
    const id = params.id;
    await ensureReady(box);
    const l = loading(box);
    const item = await Native.call('storeApp', { id }, 60000);
    l.remove();
    api.setTitle(item.name + ' – Store');
    const actions = h('div', { class: 'ms-act' });
    const side = h('aside', { class: 'ms-side' }, iconEl(item, 'huge'), h('h1', { text: item.name }),
      h('div', { class: 'ms-dev' }, h('span', { text: item.dev || 'Unknown developer' }), item.verified ? h('span', { class: 'ms-ver', title: 'Flathub checked that the developer publishes this app', html: fi('checkCircle') + 'Verified' }) : null),
      h('div', { class: 'ms-meta muted', text: [item.via ? 'Runs with Lutris (Wine)' : 'From Flathub', catName(item.cats)].join(' · ') }), actions);
    const body = h('div', { class: 'ms-body' });
    box.classList.add('ms-detail');
    box.append(side, body);

    const paintActions = () => {
      const job = StoreJobs.jobs[item.via ? item.id : id];
      const owned = Programs.installed(id) || (item.installed && !item.via);
      actions.replaceChildren();
      if (job) {
        const pct = typeof job.progress === 'number' ? Math.round(job.progress) : null;
        const bar = h('div', { class: 'ms-bar' + (pct == null ? ' busy' : '') }, h('i', { style: pct == null ? '' : `width:${pct}%` }));
        actions.append(h('div', { class: 'ms-prog' }, h('div', { class: 'ms-prog-t' }, h('span', { text: job.text || 'Getting ready' }), h('span', { text: pct == null ? '' : pct + '%' })), bar),
          job.state === 'removing' ? null : h('button', { class: 'btn', text: 'Cancel', onclick: () => Native.call('storeCancel', { id: item.via ? item.id : id }) }));
        return;
      }
      if (owned) {
        const progs = item.via ? Programs.list.filter((p) => p.id === id) : Programs.byApp(id);
        const main = progs.find((p) => p.id === 'fp:' + id) || progs[0];
        actions.append(h('button', { class: 'btn primary ms-get', text: 'Open', disabled: !main, onclick: () => main && Programs.launch(main.id) }));
        if (item.update) actions.append(h('button', { class: 'btn', text: 'Update', onclick: () => updateApps([id]) }));
        if (main && !item.via) {
          const more = h('button', { class: 'btn ms-more-b', 'aria-label': 'More options', html: fi('more') });
          more.addEventListener('click', () => Menu.show([{ label: 'Uninstall', icon: 'trash', action: async () => { if (await Programs.uninstall(main.id, api.win)) go('app', { id }, true); } }], 0, 0, { anchorEl: more }));
          actions.append(more);
        }
      } else {
        actions.append(h('button', { class: 'btn primary ms-get', text: item.via ? 'Get' : 'Install', onclick: () => install(item) }));
      }
      actions.append(h('div', { class: 'ms-free muted', text: owned ? (item.installedVersion ? 'Version ' + item.installedVersion + ' installed' : 'Installed') : 'Free' + (item.download ? ' · ' + fmtBytes(item.download) + ' download' : '') }));
    };
    paintActions();
    const offJob = bus.on('store-job', (jid) => { if (jid === id) paintActions(); });
    const offApps = bus.on('apps', paintActions);
    const stop = () => { offJob(); offApps(); };
    const obs = new MutationObserver(() => { if (!box.isConnected) { stop(); obs.disconnect(); } });
    obs.observe(main, { childList: true });

    if (item.shots && item.shots.length) {
      const strip = h('div', { class: 'ms-shots' }, item.shots.map((s, i) => {
        const b = h('button', { class: 'ms-shot', 'aria-label': s.caption || 'Screenshot ' + (i + 1) }, h('img', { src: s.thumb, alt: s.caption || '', loading: 'lazy', draggable: 'false' }));
        b.addEventListener('click', () => lightbox(item.shots, i));
        return b;
      }));
      body.append(h('section', { class: 'ms-sec' }, h('h2', { text: 'Screenshots' }), strip));
    }
    if (item.summary) body.append(h('p', { class: 'ms-summary', text: item.summary }));
    if (item.desc) body.append(h('section', { class: 'ms-sec' }, h('h2', { text: 'Description' }), h('div', { class: 'ms-desc', html: item.desc })));
    if (item.via) body.append(h('section', { class: 'ms-sec' }, h('h2', { text: 'How it works' }), h('ol', { class: 'ms-steps' },
      h('li', { text: 'Nimbus gets Lutris from Flathub, if you don’t have it yet.' }),
      h('li', { text: 'Lutris opens with ' + item.name + '’s install steps: choose Install, then follow ' + item.name + '’s own setup.' }),
      h('li', { text: 'When it’s done, ' + item.name + ' is in Start. Open it from there or from Lutris.' }))));
    const info = h('dl', { class: 'ms-info' });
    const add = (k, v) => { if (v) info.append(h('div', {}, h('dt', { text: k }), h('dd', {}, v))); };
    add('Published by', item.dev || 'Unknown');
    add('Version', item.version ? item.version + (item.date ? ' · ' + fmtDT(item.date * 1000, { dateStyle: 'medium' }) : '') : '');
    add('Download size', item.download ? fmtBytes(item.download) : '');
    add('Installed size', item.size ? fmtBytes(item.size) : '');
    add('License', item.license ? (/proprietary/i.test(item.license) ? 'Proprietary (free to download)' : item.license.replace(/^LicenseRef-/, '')) : '');
    add('Category', catName(item.cats));
    add('Age rating', ['Everyone', 'Everyone 10+', 'Teen', 'Mature 17+'][item.mature || 0]);
    if (item.homepage) add('Website', h('a', { href: '#', text: item.homepage.replace(/^https?:\/\//, '').replace(/\/$/, ''), onclick: (e) => { e.preventDefault(); Apps.openUrl(item.homepage); } }));
    body.append(h('section', { class: 'ms-sec' }, h('h2', { text: 'Additional information' }), info));
    if (item.permissions && item.permissions.length) body.append(h('section', { class: 'ms-sec' }, h('h2', { text: 'This app can reach' }),
      h('ul', { class: 'ms-perms' }, item.permissions.map((p) => h('li', { html: fi('shield') + esc(p) })))));
  }

  function lightbox(shots, i) {
    const img = h('img', { src: shots[i].full, alt: shots[i].caption || '' });
    const cap = h('p', { text: shots[i].caption || '' });
    const box = h('div', { class: 'ms-lightbox', tabindex: '-1' }, img, cap);
    const show = (k) => { i = (k + shots.length) % shots.length; img.src = shots[i].full; cap.textContent = shots[i].caption || ''; };
    const close = () => box.remove();
    box.append(h('button', { class: 'ms-lb-x', 'aria-label': 'Close', html: fi('dismiss'), onclick: close }),
      h('button', { class: 'ms-lb-p', 'aria-label': 'Previous', html: fi('chevronLeft'), onclick: (e) => { e.stopPropagation(); show(i - 1); } }),
      h('button', { class: 'ms-lb-n', 'aria-label': 'Next', html: fi('chevronRight'), onclick: (e) => { e.stopPropagation(); show(i + 1); } }));
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === 'ArrowRight') show(i + 1); });
    root.append(box); box.focus();
  }

  async function install(item) {
    const key = item.via ? item.id : item.id;
    if (item.via) {
      const ok = await Dialog.confirm('Get ' + item.name + '?', item.name + ' is a Windows program. Nimbus gets Lutris (if you don’t have it), then Lutris opens to install ' + item.name + ' with Wine. Follow the steps there.', { ok: 'Continue', within: api.win });
      if (!ok) return;
    }
    StoreJobs.set(key, { state: 'installing', progress: null, text: 'Getting ready', name: item.name });
    let r = null;
    try { r = await Native.call('storeInstall', { id: item.id }, 6 * 3600 * 1000); }
    catch (e) { if (!/cancel/i.test(e.message)) Notif.push({ app: 'store', title: 'Couldn’t install ' + item.name, body: e.message }); }
    StoreJobs.clear(key);
    await Programs.refresh();
    if (r && r.installed) {
      const added = Programs.byApp(item.id).map((p) => p.id);
      S.set('appAdded', Object.assign({}, S.data.appAdded, Object.fromEntries(added.map((id) => [id, Date.now()]))));
      const first = added[0];
      Notif.push({ app: 'store', title: item.name + ' is installed', body: 'Find it in Start.', action: first ? () => Programs.launch(first) : null });
    } else if (r && r.lutris) {
      Notif.push({ app: 'store', title: 'Lutris is installing ' + item.name, body: 'Follow the steps in the Lutris window. ' + item.name + ' shows up in Start when it’s done.', silent: true });
    }
  }
  async function updateApps(ids) {
    StoreJobs.set('updates', { state: 'updating', progress: null, text: 'Getting updates' });
    ids.forEach((id) => StoreJobs.set(id, { state: 'updating', progress: null, text: 'Updating' }));
    const mirror = bus.on('store-job', (jid) => { if (jid === 'updates' && StoreJobs.jobs.updates) ids.forEach((id) => { if (StoreJobs.jobs[id]) { StoreJobs.jobs[id].progress = StoreJobs.jobs.updates.progress; StoreJobs.jobs[id].text = StoreJobs.jobs.updates.text; bus.emit('store-job', id); } }); });
    try {
      const r = await Native.call('storeUpdate', { apps: ids }, 6 * 3600 * 1000);
      if (r.updated) Notif.push({ app: 'store', title: r.updated === 1 ? 'An app was updated' : r.updated + ' apps were updated', silent: true });
    } catch (e) { if (!/cancel/i.test(e.message)) Notif.push({ app: 'store', title: 'Couldn’t get updates', body: e.message }); }
    mirror(); StoreJobs.clear('updates'); ids.forEach((id) => StoreJobs.clear(id));
    await Programs.refresh();
  }

  async function renderLibrary(box) {
    box.append(h('h1', { class: 'ms-h1', text: 'Library' }));
    const head = h('div', { class: 'ms-libhead' });
    const list = h('div', { class: 'ms-lib' });
    box.append(head, list);
    const paint = async (checkUpdates) => {
      await Programs.refresh();
      const apps = new Map();
      for (const p of Programs.list) if (!apps.has(p.app) || p.id === 'fp:' + p.app) apps.set(p.kind === 'lutris' ? p.id : p.app, p);
      let ups = [];
      if (checkUpdates) { try { ups = (await Native.call('storeUpdates', {}, 120000)).filter((u) => u.kind === 'app'); } catch { ups = []; } }
      const job = StoreJobs.jobs.updates;
      head.replaceChildren(h('div', {}, h('h2', { text: 'Updates & downloads' }), h('p', { class: 'muted', text: job ? (job.text || 'Updating') : ups.length ? (ups.length === 1 ? '1 update is available' : ups.length + ' updates are available') : 'Your apps are up to date' })),
        h('button', { class: 'btn primary', text: job ? 'Updating…' : ups.length ? 'Update all' : 'Get updates', disabled: !!job, onclick: () => (ups.length ? updateApps(ups.map((u) => u.app)).then(() => paint(true)) : paint(true)) }));
      const active = Object.entries(StoreJobs.jobs).filter(([id, j]) => id !== 'updates' && j.state === 'installing');
      list.replaceChildren();
      if (active.length) list.append(h('h3', { text: 'Installing' }), ...active.map(([id, j]) => h('div', { class: 'ms-lrow' }, h('span', { class: 'ms-ic', html: appIcon('app') }),
        h('div', { class: 'ms-lt' }, h('b', { text: j.name || id }), h('span', { class: 'muted', text: (j.text || '') + (typeof j.progress === 'number' ? ' · ' + Math.round(j.progress) + '%' : '') })),
        h('button', { class: 'btn', text: 'Cancel', onclick: () => Native.call('storeCancel', { id }) }))));
      list.append(h('h3', { text: 'Installed apps' }));
      if (!apps.size) { list.append(h('p', { class: 'muted', text: 'Apps you get from the Store show up here.' })); return; }
      for (const [key, p] of [...apps.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        const up = ups.find((u) => u.app === key);
        const more = h('button', { class: 'btn ms-more-b', 'aria-label': 'More options for ' + p.name, html: fi('more') });
        more.addEventListener('click', () => Menu.show([
          { label: 'Details', icon: 'info', action: () => go('app', { id: p.kind === 'lutris' ? p.id : p.app }) },
          { label: 'Uninstall', icon: 'trash', action: async () => { if (await Programs.uninstall(p.id, api.win)) paint(false); } }], 0, 0, { anchorEl: more }));
        list.append(h('div', { class: 'ms-lrow' }, h('span', { class: 'ms-ic', html: appIcon(APPS[p.id] ? APPS[p.id].icon : 'app') }),
          h('div', { class: 'ms-lt' }, h('b', { text: (APPS['fp:' + p.app] || p).name }), h('span', { class: 'muted', text: [p.kind === 'lutris' ? 'Lutris' : p.version ? 'Version ' + p.version : '', p.size ? fmtBytes(p.size) : '', up ? 'Update available' : ''].filter(Boolean).join(' · ') })),
          up ? h('button', { class: 'btn', text: 'Update', onclick: () => updateApps([key]).then(() => paint(true)) }) : null,
          h('button', { class: 'btn', text: 'Open', onclick: () => Programs.launch(p.id) }), p.kind === 'lutris' ? null : more));
      }
    };
    await paint(true);
    const off = bus.on('store-job', debounce(() => { if (box.isConnected) paint(false); }, 300));
    const obs = new MutationObserver(() => { if (!box.isConnected) { off(); obs.disconnect(); } });
    obs.observe(main, { childList: true });
  }

  api.onArgs = (a) => { if (a && a.app) go('app', { id: a.app }); else if (a && a.page) go(a.page, a); };
  api.onClose(() => clearInterval(heroT));
  if (!IS_NATIVE || !caps.programs) {
    main.append(h('div', { class: 'ms-empty' }, h('div', { class: 'ms-empty-ic', html: fi('store') }), h('h2', { text: 'The Store works on Nimbus OS' }), h('p', { class: 'muted', text: 'Run Nimbus OS on a computer (or in a virtual machine) to get apps and games like Steam, Discord and Battle.net.' })));
    return;
  }
  if (args && args.app) go('app', { id: args.app }); else go(args && args.page ? args.page : 'home', args || {});
}

/* Boot test (nimbus.test=store): the real Flathub catalog, search, Discord's page, installing Discord with the
   Store's own button (it comes with what it runs on), opening it as a window (an X11 one, through Xwayland) that
   gets Discord's taskbar button, and checking for updates. Results go to the system log for os/qmp.py. */
async function testStore() {
  const log = (text) => Native.call('log', { text: 'test store: ' + text }).catch(() => {});
  const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(500); } };
  const ID = 'com.discordapp.Discord';
  try {
    const st = await Native.call('storeStatus');
    log(`flatpak ${st.flatpak} flathub ${st.remote} libflatpak ${st.libflatpak}`);
    const t0 = Date.now();
    WM.open('store');
    const cat = await Native.call('storeCatalog', {}, 30 * 60 * 1000);
    log(`catalog ${cat.count} apps in ${Math.round((Date.now() - t0) / 1000)} s`);
    await sleep(4000);
    log('page home');
    const hits = await Native.call('storeSearch', { q: 'discord' });
    log('search discord: ' + hits.slice(0, 3).map((x) => x.id).join(' '));
    const steam = await Native.call('storeSearch', { q: 'steam' });
    log('search steam: ' + steam.slice(0, 2).map((x) => x.id).join(' '));
    const d = await Native.call('storeApp', { id: ID }, 120000);
    log(`details ${d.name} by ${d.dev}: ${d.download ? Math.round(d.download / 1e6) + ' MB' : '?'} to download, ${(d.permissions || []).length} permissions, ${(d.shots || []).length} screenshots`);
    WM.open('store', { app: ID });
    const get = await until(() => document.querySelector('.app-store .ms-get'), 60000);
    await sleep(2500);
    log('page app');
    const t1 = Date.now();
    let mark = -25;
    const off = bus.on('native:store-progress', (p) => {
      if (!p || p.id !== ID || typeof p.progress !== 'number' || p.progress < mark + 25) return;
      mark = Math.floor(p.progress / 25) * 25;
      log(`progress ${Math.round(p.progress)}% ${p.text || ''}`);
      if (mark === 25) setTimeout(() => log('page installing'), 300);
    });
    if (!get) throw new Error('no Install button');
    get.click();
    const done = await until(() => Programs.installed(ID) || (!StoreJobs.jobs[ID] && Date.now() - t1 > 5000 ? 'stopped' : null), 45 * 60 * 1000);
    off();
    if (done !== true) throw new Error('installing stopped' + (Notif.items[0] ? ': ' + Notif.items[0].title + ' ' + Notif.items[0].body : ''));
    log(`installed in ${Math.round((Date.now() - t1) / 1000)} s; Start has ${Programs.list.map((p) => p.id).join(' ')}`);
    await sleep(2000);
    log('page installed');
    await Programs.launch('fp:' + ID);
    const w = await until(() => WM.list().find((x) => x.native && x.flatpak === ID && !x.min), 5 * 60 * 1000);
    log(w ? `window ${w.title} (${w.x11 ? 'X11' : 'Wayland'}) on the taskbar as ${w.appId}` : 'no window from Discord');
    if (w) { await sleep(25000); log('page discord'); }
    const ups = await Native.call('storeUpdates', {}, 120000);
    log(`updates waiting: ${ups.length}`);
    WM.open('store', { page: 'library' });
    await sleep(3000);
    log('page library');
    log('done');
  } catch (e) { log('failed: ' + e.message); }
}
