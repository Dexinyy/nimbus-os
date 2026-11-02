/* ========== Virtual file system ========== */
const FS = {
  nodes: {}, contents: {}, updatedAt: 0,
  SPECIAL: ['root', 'desktop', 'documents', 'pictures', 'downloads', 'trash'],
  init(nodes, contents) { this.nodes = nodes || {}; this.contents = contents || {}; this.ensureBase(); },
  ensureBase() {
    const now = Date.now();
    const base = [['root', null, 'This PC'], ['desktop', 'root', 'Desktop'], ['documents', 'root', 'Documents'], ['pictures', 'root', 'Pictures'], ['downloads', 'root', 'Downloads'], ['trash', null, 'Recycle Bin']];
    for (const [id, parent, name] of base) if (!this.nodes[id]) this.nodes[id] = { id, name, type: 'folder', parent, created: now, modified: now };
  },
  get(id) { return (id && this.nodes[id]) || null; },
  children(id) {
    const out = [];
    for (const k in this.nodes) { const n = this.nodes[k]; if (n.parent === id) out.push(n); }
    return out.sort(FS.cmp);
  },
  descendants(id) { const out = []; const rec = (p) => { for (const c of this.children(p)) { out.push(c); if (c.type === 'folder') rec(c.id); } }; rec(id); return out; },
  cmp(a, b) { if (a.type !== b.type) return a.type === 'folder' ? -1 : 1; return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }); },
  isSpecial(id) { return this.SPECIAL.includes(id); },
  isFolder(id) { return this.nodes[id]?.type === 'folder'; },
  inTrash(id) { let n = this.nodes[id]; let guard = 0; while (n && guard++ < 64) { if (n.id === 'trash') return true; n = this.nodes[n.parent]; } return false; },
  isAncestor(a, b) { let n = this.nodes[b]; let guard = 0; while (n && guard++ < 64) { if (n.id === a) return true; n = this.nodes[n.parent]; } return false; },
  pathOf(id) {
    const parts = []; let n = this.nodes[id]; let guard = 0;
    while (n && n.id !== 'root' && n.id !== 'trash' && guard++ < 64) { parts.unshift(n.name); n = this.nodes[n.parent]; }
    if (n && n.id === 'trash') parts.unshift('Recycle Bin');
    return '/' + parts.join('/');
  },
  crumbs(id) { const out = []; let n = this.nodes[id]; let guard = 0; while (n && guard++ < 64) { out.unshift(n); n = this.nodes[n.parent]; } return out; },
  parentName(id) { const p = this.nodes[this.nodes[id]?.parent]; return p ? p.name : ''; },
  resolve(path, cwd = 'root') {
    if (path == null) return null;
    let p = String(path).trim().replace(/\\/g, '/');
    let cur = cwd || 'root';
    if (p === '' || p === '.') return cur;
    if (p === '~' || p.startsWith('~/')) { cur = 'root'; p = p.slice(1); }
    if (p.startsWith('/')) cur = 'root';
    for (const raw of p.split('/')) {
      const seg = raw.trim();
      if (!seg || seg === '.') continue;
      if (seg === '..') { const n = this.nodes[cur]; cur = n && n.parent ? n.parent : 'root'; continue; }
      const kids = cur === 'root' ? [...this.children('root'), this.nodes.trash] : this.children(cur);
      const m = kids.find((k) => k.name === seg) || kids.find((k) => k.name.toLowerCase() === seg.toLowerCase());
      if (!m) return null;
      cur = m.id;
    }
    return cur;
  },
  clean(name) { return String(name ?? '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120); },
  uniqueName(parent, name, exceptId) {
    const taken = new Set(this.children(parent).filter((k) => k.id !== exceptId).map((k) => k.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.'); const hasExt = dot > 0;
    const base = hasExt ? name.slice(0, dot) : name, ext = hasExt ? name.slice(dot) : '';
    for (let i = 2; i < 10000; i++) { const c = `${base} (${i})${ext}`; if (!taken.has(c.toLowerCase())) return c; }
    return name + ' ' + uid();
  },
  kindOf(name) { return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name) ? 'image' : 'text'; },
  typeLabel(n) {
    if (!n) return '';
    if (n.type === 'folder') return 'Folder';
    const ext = (n.name.match(/\.([^.]+)$/) || [])[1];
    if (n.kind === 'image') return (ext ? ext.toUpperCase() + ' ' : '') + 'image';
    return ext ? ext.toUpperCase() + ' file' : 'Text document';
  },
  create(parent, name, type = 'file', content = '', kind) {
    if (!this.nodes[parent] || this.nodes[parent].type !== 'folder') parent = 'documents';
    const now = Date.now(); const id = uid();
    const clean = FS.clean(name) || (type === 'folder' ? 'New folder' : 'Untitled.txt');
    const n = { id, name: this.uniqueName(parent, clean), type, parent, created: now, modified: now };
    if (type === 'file') { n.kind = kind || FS.kindOf(clean); n.size = content.length; this.contents[id] = content; }
    this.nodes[id] = n;
    this.commit([id], type === 'file' ? [id] : []);
    return n;
  },
  read(id) { return this.contents[id] ?? ''; },
  write(id, content) {
    const n = this.nodes[id]; if (!n || n.type !== 'file') return false;
    this.contents[id] = content; n.size = content.length; n.modified = Date.now();
    this.commit([id], [id]); return true;
  },
  rename(id, name) {
    const n = this.nodes[id]; if (!n || this.isSpecial(id)) return false;
    const clean = FS.clean(name); if (!clean) return false;
    n.name = this.uniqueName(n.parent, clean, id); n.modified = Date.now();
    this.commit([id]); return true;
  },
  move(id, parent) {
    const n = this.nodes[id];
    if (!n || this.isSpecial(id) || !this.isFolder(parent) || this.isAncestor(id, parent) || n.parent === parent) return false;
    if (parent === 'trash') return this.trash(id);
    n.parent = parent; n.name = this.uniqueName(parent, n.name, id); n.modified = Date.now();
    delete n.trashedFrom; delete n.trashedAt;
    this.commit([id]); return true;
  },
  copy(id, parent) {
    const src = this.nodes[id];
    if (!src || !this.isFolder(parent) || this.isAncestor(id, parent) || this.isSpecial(id)) return null;
    const changed = [], cchanged = [];
    const rec = (s, p, top) => {
      const nid = uid(); const now = Date.now();
      const n = { ...s, id: nid, parent: p, created: now, modified: now, name: top ? this.uniqueName(p, s.name) : s.name };
      delete n.trashedFrom; delete n.trashedAt; delete n.chunks;
      const kids = s.type === 'folder' ? this.children(s.id) : [];
      this.nodes[nid] = n; changed.push(nid);
      if (s.type === 'file') { this.contents[nid] = this.contents[s.id] ?? ''; cchanged.push(nid); }
      for (const k of kids) rec(k, nid, false);
      return n;
    };
    const r = rec(src, parent, true);
    this.commit(changed, cchanged);
    return r;
  },
  trash(id) {
    const n = this.nodes[id]; if (!n || this.isSpecial(id) || this.inTrash(id)) return false;
    n.trashedFrom = n.parent; n.trashedAt = Date.now(); n.parent = 'trash';
    n.name = this.uniqueName('trash', n.name, id);
    this.forgetRecent([id, ...this.descendants(id).map((d) => d.id)]);
    if (S.data.wallpaper === 'file:' + id) S.set('wallpaper', 'ridgeline');
    this.commit([id]); return true;
  },
  restore(id) {
    const n = this.nodes[id]; if (!n || n.parent !== 'trash') return false;
    let dest = n.trashedFrom;
    if (!this.isFolder(dest) || this.inTrash(dest)) dest = 'documents';
    n.parent = dest; n.name = this.uniqueName(dest, n.name, id);
    delete n.trashedFrom; delete n.trashedAt;
    this.commit([id]); return true;
  },
  destroy(ids) {
    const gone = [];
    for (const id of [].concat(ids)) {
      const n = this.nodes[id]; if (!n || this.isSpecial(id)) continue;
      const rec = (x) => { for (const k of this.children(x.id)) rec(k); gone.push(x); };
      rec(n);
    }
    for (const x of gone) { delete this.nodes[x.id]; delete this.contents[x.id]; }
    Store.deleteContents(gone.filter((x) => x.type === 'file'));
    this.forgetRecent(gone.map((x) => x.id));
    this.commit([]);
    return gone.length;
  },
  emptyTrash() { return this.destroy(this.children('trash').map((k) => k.id)); },
  touchRecent(id) {
    const n = this.nodes[id]; if (!n || n.type !== 'file') return;
    const list = (S.data.recent || []).filter((x) => x !== id); list.unshift(id);
    S.set('recent', list.slice(0, 12));
  },
  forgetRecent(ids) {
    const set = new Set(ids); const list = (S.data.recent || []).filter((x) => !set.has(x));
    if (list.length !== (S.data.recent || []).length) S.set('recent', list);
  },
  usage() { let bytes = 0, files = 0, folders = 0; for (const id in this.nodes) { const n = this.nodes[id]; if (n.type === 'file') { files++; bytes += (this.contents[id] || '').length; } else if (!this.isSpecial(id)) folders++; } return { bytes, files, folders }; },
  commit(ids, contentIds = []) {
    this.updatedAt = Date.now();
    Store.markUser();
    for (const id of contentIds) Store.saveContent(id);
    Store.saveFs();
    bus.emit('fs', { ids });
  },
};

/* ========== Persistence: this browser first, then the viewer's Claude account ========== */
const Store = (() => {
  const LS = 'nimbus-os:v1';
  let localOk = false, cloud = 'off', col = null;
  let ready = false, quiet = 0, userTouched = false, hadLocal = false, warnedQuota = false;
  const q = new Map();

  function readLocal() { try { const s = localStorage.getItem(LS); return s ? JSON.parse(s) : null; } catch { return null; } }
  function writeLocal() {
    const snap = { v: 1, settings: S.data, nodes: FS.nodes, contents: FS.contents, fsUpdatedAt: FS.updatedAt };
    try { localStorage.setItem(LS, JSON.stringify(snap)); localOk = true; return; } catch {}
    try {
      const text = {};
      for (const id in FS.contents) if (FS.nodes[id]?.kind !== 'image') text[id] = FS.contents[id];
      localStorage.setItem(LS, JSON.stringify({ ...snap, contents: text, partial: true }));
      localOk = true;
    } catch { localOk = false; }
  }
  const saveLocal = debounce(writeLocal, 400);

  function setCloud(s) { if (cloud !== s) { cloud = s; bus.emit('store'); } }
  function queue(key, make, delay = 800) {
    if (!col) return;
    let e = q.get(key);
    if (!e) { e = { timer: 0, busy: false, again: false, make, retried: false }; q.set(key, e); }
    e.make = make;
    clearTimeout(e.timer);
    e.timer = setTimeout(() => flush(key), delay);
  }
  async function flush(key) {
    const e = q.get(key); if (!e || !col) return;
    if (e.busy) { e.again = true; return; }
    e.busy = true;
    try {
      const body = e.make();
      const ref = col.doc(key);
      if (body === null) await ref.delete(); else await ref.set(body);
      e.retried = false;
      if (cloud !== 'on') setCloud('on');
    } catch (err) {
      const code = err && err.code;
      if ((code === 'unavailable' || code === 'resource_exhausted') && !e.retried) {
        e.retried = true; e.busy = false;
        setTimeout(() => flush(key), 1500 + Math.random() * 2500); return;
      }
      if (code === 'quota_exceeded') {
        if (!warnedQuota) { warnedQuota = true; Notif?.push({ app: 'settings', title: 'Cloud storage is full', body: 'New changes are saved in this browser only. Delete some large pictures to free space.' }); }
        setCloud('full');
      } else if (code === 'invalid_argument' || code === 'revoked' || code === 'not_granted' || code === 'capability_disabled') {
        col = null; setCloud('readonly');
      } else console.warn('Sync failed for', key, err);
    } finally {
      e.busy = false;
      if (e.again) { e.again = false; flush(key); }
    }
  }
  const CHUNK = (n) => (n && n.kind === 'image' ? 200000 : 60000);
  function saveContent(id) {
    if (!col) return;
    const n = FS.nodes[id]; if (!n || n.type !== 'file') return;
    const data = FS.contents[id] ?? '';
    const size = CHUNK(n);
    const chunks = Math.max(1, Math.ceil(data.length / size));
    const prev = n.chunks || 0;
    n.chunks = chunks;
    for (let i = 0; i < chunks; i++) queue(`c-${id}-${i}`, () => ({ d: (FS.contents[id] ?? '').slice(i * size, (i + 1) * size), i, n: chunks }), 900);
    for (let i = chunks; i < prev; i++) queue(`c-${id}-${i}`, () => null, 900);
  }
  function snapshotNodes() {
    // keep the chunk counts accurate for every file we know about
    if (col) for (const id in FS.nodes) { const n = FS.nodes[id]; if (n.type === 'file' && !n.chunks) n.chunks = Math.max(1, Math.ceil((FS.contents[id] ?? '').length / CHUNK(n))); }
    return { v: 1, updatedAt: FS.updatedAt, nodes: FS.nodes };
  }

  function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: 'timeout' }), ms))]); }

  return {
    readLocal,
    get status() { return { local: localOk, cloud }; },
    markUser() { if (ready && !quiet) userTouched = true; },
    quietly(fn) { quiet++; try { return fn(); } finally { quiet--; } },
    setHadLocal(v) { hadLocal = v; },
    ready() { ready = true; writeLocal(); },
    saveSettings() { saveLocal(); queue('settings', () => ({ v: 1, updatedAt: S.data.updatedAt, data: S.data }), 900); },
    saveFs() { saveLocal(); queue('fs', snapshotNodes, 900); },
    saveContent(id) { saveLocal(); saveContent(id); },
    deleteContents(nodes) { if (!col) return; for (const n of nodes) for (let i = 0; i < (n.chunks || 1); i++) queue(`c-${n.id}-${i}`, () => null, 900); },
    noCloud() { if (cloud === 'off' || cloud === 'connecting') setCloud('unavailable'); },
    async connect(db, user) {
      let id = null;
      try { id = await user.id(); } catch { id = null; }
      if (!id) { setCloud('unavailable'); return; }
      try { col = db.collection('data/users/' + id); } catch { col = null; setCloud('unavailable'); return; }
      setCloud('connecting');
      let snap;
      try { snap = await withTimeout(col.get(), 10000); }
      catch (e) { col = null; setCloud(e && e.code === 'timeout' ? 'unreachable' : 'unavailable'); return; }
      let cs = null, cf = null; const parts = {};
      for (const d of snap.docs) {
        const body = d.data && d.data(); if (!body) continue;
        if (d.id === 'settings') cs = body;
        else if (d.id === 'fs') cf = body;
        else { const m = /^c-(.+)-(\d+)$/.exec(d.id); if (m) (parts[m[1]] ||= [])[+m[2]] = String(body.d ?? ''); }
      }
      const cloudEmpty = !cs && !cf;
      const cloudStamp = Math.max(cs?.updatedAt || 0, cf?.updatedAt || 0);
      const localStamp = hadLocal ? Math.max(S.data.updatedAt || 0, FS.updatedAt || 0) : 0;
      const adopt = !cloudEmpty && (!hadLocal || (!userTouched && cloudStamp >= localStamp));
      if (adopt) {
        const contents = {};
        const nodes = cf?.nodes || {};
        for (const nid in nodes) {
          const n = nodes[nid]; if (n.type !== 'file') continue;
          const p = parts[nid];
          if (p && (!n.chunks || p.length >= n.chunks) && !p.some((x) => x === undefined)) contents[nid] = p.join('');
          else contents[nid] = FS.contents[nid] ?? '';
        }
        quiet++;
        try {
          if (cs?.data) S.load(cs.data);
          if (cf?.nodes) { FS.init(JSON.parse(JSON.stringify(nodes)), contents); FS.updatedAt = cf.updatedAt || Date.now(); }
        } finally { quiet--; }
        writeLocal();
        setCloud('on');
        bus.emit('store-adopted');
      } else {
        // this browser has newer state: send it up
        setCloud('on');
        queue('settings', () => ({ v: 1, updatedAt: S.data.updatedAt, data: S.data }), 300);
        for (const nid in FS.nodes) {
          const n = FS.nodes[nid]; if (n.type !== 'file') continue;
          const local = FS.contents[nid] ?? '';
          const remote = parts[nid] ? parts[nid].join('') : null;
          if (remote !== local) { delete n.chunks; saveContent(nid); }
        }
        for (const nid in parts) if (!FS.nodes[nid]) for (let i = 0; i < parts[nid].length; i++) queue(`c-${nid}-${i}`, () => null, 1200);
        queue('fs', snapshotNodes, 600);
      }
    },
    async wipe() {
      try { localStorage.removeItem(LS); } catch {}
      if (col) {
        try {
          const snap = await col.get();
          for (const d of snap.docs) { try { await col.doc(d.id).delete(); } catch {} }
        } catch {}
      }
    },
    cloudLabel() {
      switch (cloud) {
        case 'on': return { icon: 'cloud', title: 'Synced to your Claude account', desc: 'Your files and settings follow you to any device where you open this OS while signed in.' };
        case 'connecting': return { icon: 'cloud', title: 'Connecting to your Claude account', desc: 'Your changes are kept in this browser in the meantime.' };
        case 'full': return { icon: 'cloudOff', title: 'Cloud storage is full', desc: 'New changes are saved in this browser only. Delete some large pictures to free space.' };
        case 'readonly': return { icon: 'cloudOff', title: 'Saved in this browser only', desc: 'Your Claude account does not allow this page to save data, so nothing syncs between devices.' };
        case 'unreachable': return { icon: 'cloudOff', title: 'Sync is unreachable', desc: 'Changes are saved in this browser. Reopen the OS later to sync them.' };
        default:
          if (IS_NATIVE) {
            if (!Native.live) return { icon: 'hdd', title: 'Saved on this PC', desc: 'Your files and settings are stored on this computer.' };
            return Storage.saving
              ? { icon: 'hdd', title: 'Saved between restarts', desc: 'Files, settings and Wi-Fi passwords are kept on your USB stick or disk.' }
              : { icon: 'hdd', title: 'Live session', desc: 'Files and settings are lost when you shut down. Set up saving in Settings › System to keep them.' };
          }
          return localOk
            ? { icon: 'hdd', title: 'Saved in this browser only', desc: 'Open this OS in Claude while signed in to sync it across devices.' }
            : { icon: 'cloudOff', title: 'Not saved', desc: 'This browser blocks storage, so changes last until you close the tab.' };
      }
    },
    shortLabel() {
      if (cloud === 'on') return 'Synced';
      if (IS_NATIVE) return !Native.live ? 'This PC' : Storage.saving ? 'Saved' : 'Live session';
      return 'This browser';
    },
    flushLocal() { writeLocal(); },
  };
})();
