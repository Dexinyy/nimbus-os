/* ========== Terminal ========== */
const BOOT_TIME = Date.now();
function mountTerminal(root, api, args) {
  if (IS_NATIVE) return mountRealTerminal(root, api, args);
  let cwd = FS.isFolder(args.cwd) ? args.cwd : 'root';
  const hist = []; let hi = 0; let busy = null;
  root.classList.add('app-term');
  root.innerHTML = `<div class="term selectable" role="log" aria-live="polite"><div class="term-out"></div><div class="term-line"><span class="term-ps"></span><input class="term-in" id="${api.id}-in" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Command"></div></div>`;
  const term = root.querySelector('.term'), out = root.querySelector('.term-out'), inp = root.querySelector('.term-in'), ps = root.querySelector('.term-ps');
  const host = () => (S.data.deviceName || 'my-pc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pc';
  const user = () => (userName() || 'you').toLowerCase().split(/\s+/)[0].replace(/[^a-z0-9]/g, '') || 'you';
  const where = () => { const p = FS.pathOf(cwd); return p === '/' ? '~' : '~' + p; };
  const prompt = () => `<span class="t-user">${esc(user())}@${esc(host())}</span>:<span class="t-path">${esc(where())}</span>$ `;
  function setPS() { ps.innerHTML = prompt(); }
  function print(text, cls) { const d = h('div', { class: 'tl' + (cls ? ' ' + cls : '') }); d.textContent = text; out.append(d); scroll(); return d; }
  function printHTML(html) { const d = h('div', { class: 'tl', html }); out.append(d); scroll(); return d; }
  function scroll() { term.scrollTop = term.scrollHeight; }
  const q = (s) => (/[\s"']/.test(s) ? `"${s}"` : s);
  function parse(line) {
    const toks = []; let cur = '', quote = null, any = false;
    for (const ch of line) {
      if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { quote = ch; any = true; continue; }
      if (/\s/.test(ch)) { if (cur || any) { toks.push(cur); cur = ''; any = false; } continue; }
      if (ch === '>') { if (cur || any) { toks.push(cur); cur = ''; any = false; } if (toks[toks.length - 1] === '>') toks[toks.length - 1] = '>>'; else toks.push('>'); continue; }
      cur += ch;
    }
    if (cur || any) toks.push(cur);
    return toks;
  }
  const need = (p, msg) => { const id = FS.resolve(p, cwd); if (!id) throw new Error(`${msg || 'No such file or folder'}: ${p}`); return id; };
  const splitPath = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? ['', p] : [p.slice(0, i) || '/', p.slice(i + 1)]; };
  function lsLine(n, long) {
    const nm = n.type === 'folder' ? `<span class="t-dir">${esc(n.name)}/</span>` : n.kind === 'image' ? `<span class="t-img">${esc(n.name)}</span>` : esc(n.name);
    if (!long) return `<span class="t-cell">${nm}</span>`;
    return `<div><span class="t-dim">${n.type === 'folder' ? 'd' : '-'}rw-r--r--</span>  <span class="t-dim">${String(n.type === 'file' ? fmtBytes(n.size || 0) : '-').padStart(8, ' ')}</span>  <span class="t-dim">${esc(fmtDT(n.modified, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }))}</span>  ${nm}</div>`;
  }
  const CMDS = {
    help: { d: 'List the commands', run: () => { const rows = Object.entries(CMDS).filter(([k, c]) => !c.alias && (!c.need || caps[c.need])).map(([k, c]) => `<div><span class="t-cmd">${k.padEnd(10, ' ')}</span><span class="t-dim">${esc(c.d)}</span></div>`).join(''); printHTML(`<div class="t-help">${rows}</div><div class="t-dim">Tip: Tab completes names, ↑ and ↓ go through history, Ctrl+L clears.</div>`); } },
    ls: { d: 'List files, -l for details', run: (a) => { const long = a.includes('-l'); const p = a.find((x) => !x.startsWith('-')); const id = p ? need(p) : cwd; const n = FS.get(id); if (n.type === 'file') { printHTML(lsLine(n, long)); return; } let kids = FS.children(id); if (id === 'root') kids = kids.concat([FS.get('trash')]); if (!kids.length) { print('(empty)', 't-dim'); return; } printHTML(long ? kids.map((k) => lsLine(k, true)).join('') : `<div class="t-grid">${kids.map((k) => lsLine(k)).join('')}</div>`); } },
    dir: { alias: 'ls' },
    cd: { d: 'Change folder', run: (a) => { const p = a[0] || '~'; const id = need(p); if (!FS.isFolder(id)) throw new Error('Not a folder: ' + p); cwd = id; setPS(); } },
    pwd: { d: 'Show the current folder', run: () => print(FS.pathOf(cwd)) },
    cat: { d: 'Show a text file', run: (a) => { if (!a.length) throw new Error('Usage: cat <file>'); for (const p of a) { const id = need(p); const n = FS.get(id); if (n.type === 'folder') throw new Error(p + ' is a folder'); if (n.kind === 'image') { print(`${n.name} is a picture. Use: open "${n.name}"`, 't-dim'); continue; } print(FS.read(id) || '(empty file)', FS.read(id) ? '' : 't-dim'); } } },
    mkdir: { d: 'Make a folder', run: (a) => { if (!a.length) throw new Error('Usage: mkdir <name>'); for (const p of a) { const [dir, nm] = splitPath(p); const parent = dir ? need(dir) : cwd; const n = FS.create(parent, nm, 'folder'); print('Created ' + FS.pathOf(n.id), 't-ok'); } } },
    touch: { d: 'Make an empty text file', run: (a) => { if (!a.length) throw new Error('Usage: touch <name>'); for (const p of a) { const ex = FS.resolve(p, cwd); if (ex) { FS.write(ex, FS.read(ex)); continue; } const [dir, nm] = splitPath(p); const n = FS.create(dir ? need(dir) : cwd, nm, 'file', '', 'text'); print('Created ' + FS.pathOf(n.id), 't-ok'); } } },
    rm: { d: 'Move to the Recycle Bin', run: (a) => { const ps2 = a.filter((x) => !x.startsWith('-')); if (!ps2.length) throw new Error('Usage: rm <file>'); for (const p of ps2) { const id = need(p); if (FS.isSpecial(id)) throw new Error('Cannot remove ' + p); if (FS.isFolder(id) && FS.children(id).length && !a.some((x) => /^-r|^-rf$/.test(x))) throw new Error(p + ' is a folder that is not empty. Use rm -r'); FS.trash(id); print(`Moved ${FS.get(id).name} to the Recycle Bin`, 't-dim'); } Sound.play('trash'); } },
    mv: { d: 'Move or rename', run: (a) => { if (a.length < 2) throw new Error('Usage: mv <from> <to>'); const src = need(a[0]); const dst = FS.resolve(a[1], cwd); if (dst && FS.isFolder(dst)) { if (!FS.move(src, dst)) throw new Error('Cannot move there'); } else { const [dir, nm] = splitPath(a[1]); const parent = dir ? need(dir) : FS.get(src).parent; if (parent !== FS.get(src).parent) FS.move(src, parent); FS.rename(src, nm); } print('Done', 't-dim'); } },
    cp: { d: 'Copy into a folder', run: (a) => { if (a.length < 2) throw new Error('Usage: cp <file> <folder>'); const src = need(a[0]); const dst = need(a[1]); if (!FS.isFolder(dst)) throw new Error('The destination must be a folder'); const c = FS.copy(src, dst); if (!c) throw new Error('Cannot copy there'); print('Copied to ' + FS.pathOf(c.id), 't-ok'); } },
    echo: { d: 'Print text, or write it: echo hi > file.txt', run: (a) => { const k = a.findIndex((x) => x === '>' || x === '>>'); if (k < 0) { print(a.join(' ')); return; } const text = a.slice(0, k).join(' '); const p = a[k + 1]; if (!p) throw new Error('Missing file name after ' + a[k]); let id = FS.resolve(p, cwd); if (id && FS.isFolder(id)) throw new Error(p + ' is a folder'); if (!id) { const [dir, nm] = splitPath(p); id = FS.create(dir ? need(dir) : cwd, nm, 'file', '', 'text').id; } const prev = FS.read(id); FS.write(id, a[k] === '>>' ? (prev ? prev.replace(/\n?$/, '\n') : '') + text + '\n' : text + '\n'); } },
    open: { d: 'Open a file, folder or app', run: (a) => { if (!a.length) { WM.open('files', { folder: cwd }); return; } const p = a.join(' '); const app = Object.keys(APPS).find((k) => k === p.toLowerCase() || APPS[k].name.toLowerCase() === p.toLowerCase()); if (app && appAvailable(app)) { WM.open(app); return; } openNode(need(p)); } },
    edit: { d: 'Edit a text file in Notes', run: (a) => { if (!a.length) { WM.open('notes'); return; } let id = FS.resolve(a[0], cwd); if (!id) { const [dir, nm] = splitPath(a[0]); id = FS.create(dir ? need(dir) : cwd, /\./.test(nm) ? nm : nm + '.txt', 'file', '', 'text').id; } WM.open('notes', { file: id }); } },
    tree: { d: 'Show folders as a tree', run: (a) => { const id = a[0] ? need(a[0]) : cwd; const lines = []; const rec = (p, pre) => { const kids = FS.children(p); kids.forEach((k, i) => { const last = i === kids.length - 1; lines.push(pre + (last ? '└── ' : '├── ') + (k.type === 'folder' ? `<span class="t-dir">${esc(k.name)}/</span>` : esc(k.name))); if (k.type === 'folder' && lines.length < 300) rec(k.id, pre + (last ? '    ' : '│   ')); }); }; rec(id, ''); printHTML(`<div class="t-pre">${esc(FS.get(id).name)}\n${lines.join('\n')}</div>`); } },
    find: { d: 'Find files by name', run: (a) => { if (!a.length) throw new Error('Usage: find <text>'); const t = a.join(' ').toLowerCase(); const hits = FS.descendants(cwd).filter((n) => n.name.toLowerCase().includes(t)); if (!hits.length) print('No matches', 't-dim'); hits.slice(0, 100).forEach((n) => print(FS.pathOf(n.id))); } },
    apps: { d: 'List the apps you can open', run: () => printHTML(`<div class="t-grid">${Object.keys(APPS).filter(appAvailable).map((k) => `<span class="t-cell"><span class="t-cmd">${k}</span></span>`).join('')}</div>`) },
    theme: { d: 'theme light | dark | auto', run: (a) => { const v = (a[0] || '').toLowerCase(); if (!['light', 'dark', 'auto'].includes(v)) throw new Error('Usage: theme light | dark | auto'); S.set('theme', v); print('Theme set to ' + v, 't-ok'); } },
    accent: { d: 'accent #3b82f6', run: (a) => { let v = (a[0] || '').trim(); if (/^[0-9a-f]{6}$/i.test(v)) v = '#' + v; if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Usage: accent #rrggbb'); S.set('accent', v.toLowerCase()); print('Accent set to ' + v, 't-ok'); } },
    wallpaper: { d: 'wallpaper <name>, or list them', run: (a) => { if (!a.length) { print('Wallpapers: ' + WALLS.map((w) => w.id).join(', ')); return; } const w = WALLS.find((x) => x.id === a[0].toLowerCase() || x.name.toLowerCase() === a[0].toLowerCase()); if (w) { S.set('wallpaper', w.id); print('Wallpaper set to ' + w.name, 't-ok'); return; } const id = need(a.join(' ')); if (FS.get(id).kind !== 'image') throw new Error('Not a picture'); S.set('wallpaper', 'file:' + id); print('Wallpaper set', 't-ok'); } },
    calc: { d: 'Do math: calc (2+3)*4', run: (a) => print(fmtNum(evalMath(a.join(' ')))) },
    date: { d: 'Show the date and time', run: () => print(fmtDT(Date.now(), { dateStyle: 'full', timeStyle: 'long' })) },
    whoami: { d: 'Show your user name', run: () => print(user()) },
    hostname: { d: 'Show the PC name', run: () => print(host()) },
    uname: { d: 'Show system info', run: () => { const ni = IS_NATIVE && Native.info; print(ni ? `Linux ${ni.hostname} ${ni.kernel} x86_64 · ${osTitle()} ${ni.version}` : `${osTitle()} 1.0 (build 26.11) on ${browserName()}`); } },
    neofetch: { d: 'Show system info with style', run: () => {
      const art = ['        ___', '     .-\'   \'-.', ' ___/_________\\___', '(___|_________|___)', '     \\       /', '      \'-._.-\''];
      const u = FS.usage(); const up = Math.round((Date.now() - BOOT_TIME) / 60000);
      const ni = IS_NATIVE && Native.info;
      const head = [`<span class="t-user">${esc(user())}@${esc(host())}</span>`, '-'.repeat(user().length + host().length + 1)];
      const info = ni ? head.concat([`<b>OS</b>: ${esc(osTitle())} ${esc(ni.version)} (${esc(ni.base)})`, `<b>Host</b>: ${esc(ni.device)}`, `<b>Kernel</b>: Linux ${esc(ni.kernel)}`, `<b>Uptime</b>: ${Math.round((ni.uptime + (Date.now() - Native.infoAt) / 1000) / 60)} min`, `<b>Shell</b>: nsh 1.0`, `<b>Resolution</b>: ${screen.width}x${screen.height}`, `<b>Theme</b>: ${effectiveTheme()} · accent ${esc(S.data.accent)}`, `<b>CPU</b>: ${esc(ni.cpu)} (${ni.cores})`, `<b>Memory</b>: ${fmtBytes(ni.memory)}`, `<b>Disk</b>: ${fmtBytes(ni.disk.total - ni.disk.free)} / ${fmtBytes(ni.disk.total)}`])
        : head.concat([`<b>OS</b>: ${esc(osTitle())} 1.0`, `<b>Host</b>: ${esc(S.data.deviceName)}`, `<b>Runs on</b>: ${esc(browserName())}`, `<b>Uptime</b>: ${up} min`, `<b>Shell</b>: nsh 1.0`, `<b>Resolution</b>: ${screen.width}x${screen.height}`, `<b>Theme</b>: ${effectiveTheme()} · accent ${esc(S.data.accent)}`, `<b>CPU</b>: ${navigator.hardwareConcurrency || '?'} threads`, `<b>Storage</b>: ${fmtBytes(u.bytes)} in ${u.files} files`]);
      const rows = []; for (let i = 0; i < Math.max(art.length, info.length); i++) rows.push(`<span class="t-art">${esc((art[i] || '').padEnd(22, ' '))}</span>${info[i] || ''}`);
      printHTML(`<div class="t-pre">${rows.join('\n')}</div><div class="t-swatch">${['#ef4444', '#f59e0b', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', 'var(--accent)'].map((c) => `<i style="background:${c}"></i>`).join('')}</div>`);
    } },
    history: { d: 'Show recent commands', run: () => hist.forEach((c, i) => print(String(i + 1).padStart(3, ' ') + '  ' + c)) },
    ask: { d: 'Ask the assistant a question', need: 'sample', run: async (a) => {
      if (!caps.sample) throw new Error('The assistant is not available here');
      if (!a.length) throw new Error('Usage: ask <question>');
      const line = print('Thinking…', 't-dim'); const ctl = new AbortController(); busy = ctl;
      try { const r = await caps.sample(`You are answering inside a terminal app of a browser-based OS called ${osTitle()}. Reply in plain text only, no Markdown, at most 8 short lines.\n\nQuestion: ${a.join(' ')}`, { modelTier: 'quick', cache: false, signal: ctl.signal, onText: ({ text }) => { line.className = 'tl'; line.textContent = text; scroll(); } }); line.className = 'tl'; line.textContent = r.text; }
      catch (e) { if (e?.code === 'cancelled') { line.textContent = (e.text || '') + ' ^C'; } else { line.className = 'tl t-err'; line.textContent = e?.code === 'not_granted' ? 'The assistant was not allowed to run.' : e?.code === 'rate_limited' ? 'Usage limit reached. Try again later.' : 'The assistant could not answer: ' + (e?.code || 'error'); } }
      finally { busy = null; }
    } },
    clear: { d: 'Clear the screen', run: () => { out.innerHTML = ''; } },
    cls: { alias: 'clear' },
    exit: { d: 'Close Terminal', run: () => api.close() },
  };
  async function exec(line) {
    printHTML(prompt() + esc(line));
    const toks = parse(line.trim()); if (!toks.length) return;
    let name = toks[0].toLowerCase(); let c = CMDS[name];
    if (c?.alias) c = CMDS[c.alias];
    if (!c || (c.need && !caps[c.need])) { print(`${toks[0]}: command not found. Type help to see what you can run.`, 't-err'); return; }
    try { await c.run(toks.slice(1)); } catch (e) { print(e.message || String(e), 't-err'); }
  }
  function complete() {
    const v = inp.value; const toks = v.split(/\s+/);
    if (toks.length <= 1) {
      const opts = Object.keys(CMDS).filter((k) => k.startsWith(toks[0]) && (!CMDS[k].need || caps[CMDS[k].need]));
      if (opts.length === 1) inp.value = opts[0] + ' '; else if (opts.length > 1) printHTML(prompt() + esc(v) + `<div class="t-grid">${opts.map((o) => `<span class="t-cell">${o}</span>`).join('')}</div>`);
      return;
    }
    const last = toks[toks.length - 1].replace(/^"/, '');
    const [dir, part] = splitPath(last);
    const base = dir ? FS.resolve(dir, cwd) : cwd; if (!base) return;
    let kids = FS.children(base).filter((k) => k.name.toLowerCase().startsWith(part.toLowerCase()));
    if (kids.length === 1) { const k = kids[0]; toks[toks.length - 1] = q((dir ? (dir === '/' ? '/' : dir + '/') : '') + k.name + (k.type === 'folder' ? '/' : '')); inp.value = toks.join(' '); }
    else if (kids.length > 1) {
      const common = kids.map((k) => k.name).reduce((a, b) => { let i = 0; while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++; return a.slice(0, i); });
      if (common.length > part.length) { toks[toks.length - 1] = (dir ? (dir === '/' ? '/' : dir + '/') : '') + common; inp.value = toks.join(' '); }
      else printHTML(prompt() + esc(v) + `<div class="t-grid">${kids.map((k) => lsLine(k)).join('')}</div>`);
    }
  }
  inp.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const line = inp.value; inp.value = ''; if (line.trim()) { hist.push(line); hi = hist.length; } await exec(line); setPS(); scroll(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (hi > 0) { hi--; inp.value = hist[hi]; } }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (hi < hist.length - 1) { hi++; inp.value = hist[hi]; } else { hi = hist.length; inp.value = ''; } }
    else if (e.key === 'Tab') { e.preventDefault(); complete(); }
    else if (e.key.toLowerCase() === 'l' && e.ctrlKey) { e.preventDefault(); out.innerHTML = ''; }
    else if (e.key.toLowerCase() === 'c' && e.ctrlKey && !window.getSelection()?.toString()) { e.preventDefault(); if (busy) busy.abort(); else { printHTML(prompt() + esc(inp.value) + '^C'); inp.value = ''; } }
  });
  term.addEventListener('click', () => { if (!window.getSelection()?.toString()) inp.focus({ preventScroll: true }); });
  api.on('fs', () => { if (!FS.get(cwd) || FS.inTrash(cwd)) { cwd = 'root'; setPS(); } });
  api.on('settings', (keys) => { if (keys.includes('deviceName') || keys.includes('userName')) setPS(); });
  printHTML(`<span class="t-art">${esc(osTitle())} Terminal</span> <span class="t-dim">· type <span class="t-cmd">help</span> to get started</span>`);
  setPS();
  if (args.run) exec(args.run).then(setPS);
  requestAnimationFrame(() => inp.focus({ preventScroll: true }));
}


/* ========== Real terminal (installed OS) ==========
   bash runs in a pseudo-terminal on the computer (nimbus-shell, nimbus_term.py keeps the screen).
   Updates arrive as 'native:term' events with changed rows as [text, fg, bg, flags, wide?] runs. */
const TERM_COLORS = ['#1c1f2b', '#ff6b7a', '#4fdc8f', '#f5c451', '#62a8ff', '#c98bf0', '#3fd0d4', '#c9cfdb',
  '#5d6577', '#ff8f9b', '#7deaae', '#ffd97a', '#8fc1ff', '#dcaaf5', '#7ae3e6', '#ffffff'];
function termColor(c) {
  if (c === -1 || c == null) return null;
  if (typeof c === 'string') return c;
  if (c < 16) return TERM_COLORS[c];
  if (c < 232) { c -= 16; const v = (n) => (n ? n * 40 + 55 : 0); return `rgb(${v(Math.floor(c / 36))},${v(Math.floor(c / 6) % 6)},${v(c % 6)})`; }
  const l = (c - 232) * 10 + 8; return `rgb(${l},${l},${l})`;
}
const TERM_KEYS = { Enter: '\r', Tab: '\t', Escape: '\x1b', Insert: '\x1b[2~', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~',
  F1: '\x1bOP', F2: '\x1bOQ', F3: '\x1bOR', F4: '\x1bOS', F5: '\x1b[15~', F6: '\x1b[17~', F7: '\x1b[18~', F8: '\x1b[19~', F9: '\x1b[20~', F10: '\x1b[21~', F11: '\x1b[23~', F12: '\x1b[24~' };
const TERM_ARROWS = { ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F' };
function termKey(e, appCursor) {
  const k = e.key, mod = (e.shiftKey ? 1 : 0) | (e.altKey ? 2 : 0) | (e.ctrlKey ? 4 : 0);
  if (TERM_ARROWS[k]) { const l = TERM_ARROWS[k]; return mod ? `\x1b[1;${mod + 1}${l}` : (appCursor ? '\x1bO' : '\x1b[') + l; }
  if (k === 'Backspace') return e.ctrlKey ? '\x08' : (e.altKey ? '\x1b\x7f' : '\x7f');
  if (k === 'Tab' && e.shiftKey) return '\x1b[Z';
  if (TERM_KEYS[k]) return (e.altKey && k.length > 1 && k.startsWith('F') === false ? '\x1b' : '') + TERM_KEYS[k];
  if (e.ctrlKey && !e.altKey && !e.metaKey && k.length === 1) {
    const c = k.toLowerCase();
    if (c >= 'a' && c <= 'z') return String.fromCharCode(c.charCodeAt(0) - 96);
    const special = { ' ': '\x00', '@': '\x00', '2': '\x00', '[': '\x1b', '3': '\x1b', '\\': '\x1c', '4': '\x1c', ']': '\x1d', '5': '\x1d', '^': '\x1e', '6': '\x1e', '_': '\x1f', '-': '\x1f', '7': '\x1f', '/': '\x1f', '8': '\x7f' };
    if (special[c]) return special[c];
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && k.length === 1) return '\x1b' + k;
  return null; // printable text arrives through the input event instead
}
function mountRealTerminal(root, api, args) {
  root.classList.add('app-term', 'app-rterm');
  root.innerHTML = `<div class="rterm" role="application" aria-label="Terminal"><div class="rt-scroll"><div class="rt-back"></div><div class="rt-screen"><div class="rt-cursor"></div><textarea class="rt-input" aria-label="Terminal input" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"></textarea></div></div></div>`;
  const box = root.querySelector('.rterm'), scroller = root.querySelector('.rt-scroll'), back = root.querySelector('.rt-back');
  const screen = root.querySelector('.rt-screen'), cursor = root.querySelector('.rt-cursor'), input = root.querySelector('.rt-input');
  let id = null, cols = 0, rows = 0, appCursor = false, paste = false, composing = false, closed = false, cw = 8, lh = 18, title = '';
  const rowEls = [];
  const send = (data) => { if (id != null && data) Native.call('termInput', { id, data }).catch(() => {}); };

  function measure() {
    const probe = h('span', { class: 'rt-probe', text: 'MMMMMMMMMM' });
    screen.append(probe); cw = probe.getBoundingClientRect().width / 10 || 8; probe.remove();
    lh = parseFloat(getComputedStyle(screen).lineHeight) || 18;
  }
  function fit() {
    const st = getComputedStyle(scroller);
    const w = scroller.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    const hh = scroller.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
    return [Math.max(10, Math.floor(w / cw)), Math.max(3, Math.floor(hh / lh))];
  }
  function setRows(n) {
    while (rowEls.length < n) { const r = h('div', { class: 'rt-row' }); screen.insertBefore(r, cursor); rowEls.push(r); }
    while (rowEls.length > n) rowEls.pop().remove();
  }
  function paintRow(el, runs) {
    const frag = document.createDocumentFragment();
    for (const [text, fg, bg, flags, wide] of runs) {
      const span = document.createElement('span');
      let f = termColor(fg), b = termColor(bg);
      if (flags & 16) { const t = f || 'var(--rt-fg)'; f = b || 'var(--rt-bg)'; b = t; }
      if (f) span.style.color = f;
      if (b) span.style.background = b;
      if (flags & 1) span.style.fontWeight = '700';
      if (flags & 2) span.style.opacity = '.62';
      if (flags & 4) span.style.fontStyle = 'italic';
      if (flags & 40) span.style.textDecoration = [(flags & 8) && 'underline', (flags & 32) && 'line-through'].filter(Boolean).join(' ');
      if (flags & 64) span.style.visibility = 'hidden';
      if (wide === 2) span.className = 'rt-w2';
      span.textContent = text;
      frag.append(span);
    }
    el.replaceChildren(frag);
  }
  function atBottom() { return scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4; }
  function apply(u) {
    const stick = atBottom();
    if (u.rows !== rowEls.length) setRows(u.rows);
    if (u.clearBack) back.replaceChildren();
    for (const runs of u.scrolled || []) { const r = h('div', { class: 'rt-row' }); paintRow(r, runs); back.append(r); }
    while (back.childElementCount > 5000) back.firstElementChild.remove();
    for (const [y, runs] of Object.entries(u.lines || {})) { const el = rowEls[+y]; if (el) paintRow(el, runs); }
    const [x, y, visible] = u.cursor;
    cursor.style.transform = `translate(${x * cw}px, ${y * lh}px)`;
    cursor.hidden = !visible;
    input.style.transform = cursor.style.transform;
    appCursor = u.appCursor; paste = u.paste;
    box.classList.toggle('alt', !!u.alt);
    if (u.title !== title) { title = u.title; api.setTitle(title ? `${title} – Terminal` : 'Terminal'); }
    if (u.bell) { box.classList.remove('bell'); void box.offsetWidth; box.classList.add('bell'); }
    if (stick) scroller.scrollTop = scroller.scrollHeight;
  }
  const resize = debounce(() => {
    if (id == null || closed) return;
    const [c, r] = fit();
    if (c === cols && r === rows) return;
    cols = c; rows = r;
    Native.call('termResize', { id, cols, rows }).catch(() => {});
  }, 60);

  input.addEventListener('keydown', (e) => {
    if (e.isComposing || composing) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && e.shiftKey && k === 'c') { e.preventDefault(); copySel(); return; }
    if (e.ctrlKey && e.shiftKey && k === 'v') { e.preventDefault(); pasteClip(); return; }
    if (e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) { e.preventDefault(); scroller.scrollTop += (e.key === 'PageUp' ? -1 : 1) * scroller.clientHeight * 0.9; return; }
    const seq = termKey(e, appCursor);
    if (seq != null) { e.preventDefault(); e.stopPropagation(); send(seq); scroller.scrollTop = scroller.scrollHeight; }
  });
  input.addEventListener('input', () => { if (composing) return; const v = input.value; input.value = ''; if (v) { send(v.replace(/\n/g, '\r')); scroller.scrollTop = scroller.scrollHeight; } });
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', (e) => { composing = false; input.value = ''; send(e.data); });
  input.addEventListener('paste', (e) => { e.preventDefault(); typeText(e.clipboardData?.getData('text/plain') || ''); });
  function typeText(t) { if (!t) return; t = t.replace(/\r?\n/g, '\r'); send(paste ? `\x1b[200~${t}\x1b[201~` : t); }
  function copySel() { const t = window.getSelection()?.toString(); if (t) navigator.clipboard?.writeText(t).catch(() => {}); }
  async function pasteClip() { try { typeText(await navigator.clipboard.readText()); } catch { Notif.push({ app: 'terminal', title: 'Could not paste', body: 'Use Ctrl+Shift+V or the right-click menu.', silent: true }); } }
  box.addEventListener('mouseup', () => { if (!window.getSelection()?.toString()) input.focus({ preventScroll: true }); });
  api.body.addEventListener('focus', () => input.focus({ preventScroll: true }));
  box.addEventListener('focusin', () => box.classList.add('focused'));
  box.addEventListener('focusout', () => box.classList.remove('focused'));
  box.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const sel = window.getSelection()?.toString();
    Menu.show([
      { label: 'Copy', icon: 'copy', disabled: !sel, action: copySel },
      { label: 'Paste', icon: 'paste', action: pasteClip },
      'sep',
      { label: 'Clear scrollback', icon: 'trash', action: () => back.replaceChildren() },
    ], e.clientX, e.clientY);
  });
  api.on('native:term', (u) => { if (u.id === id) apply(u); });
  api.on('native:term-exit', (u) => { if (u.id !== id) return; closed = true; api.close(true); });
  api.onClose(() => { if (id != null && !closed) Native.call('termClose', { id }).catch(() => {}); closed = true; });
  new ResizeObserver(resize).observe(scroller);

  requestAnimationFrame(async () => {
    try { await document.fonts.load(`14px ${getComputedStyle(screen).fontFamily}`); } catch {}
    measure();
    [cols, rows] = fit();
    setRows(rows);
    try {
      ({ id } = await Native.call('termOpen', { cols, rows }));
      if (closed) { Native.call('termClose', { id }).catch(() => {}); return; }
      if (args.run) send(args.run + '\r');
      resize();
    } catch (e) {
      rowEls[0]?.replaceChildren(document.createTextNode('Could not start the terminal: ' + e.message));
    }
    input.focus({ preventScroll: true });
  });
}
