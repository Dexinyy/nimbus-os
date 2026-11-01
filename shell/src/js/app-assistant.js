/* ========== Assistant (asks Claude through the page's sample capability) ========== */
function mdToHTML(text) {
  const inline = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  const lines = esc(text).split('\n'); let html = '', list = null, code = false, para = [];
  const flush = () => { if (para.length) { html += '<p>' + inline(para.join('<br>')) + '</p>'; para = []; } };
  const endList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of lines) {
    if (/^```/.test(line.trim())) { flush(); endList(); html += code ? '</code></pre>' : '<pre><code>'; code = !code; continue; }
    if (code) { html += line + '\n'; continue; }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) { flush(); const want = ul ? 'ul' : 'ol'; if (list !== want) { endList(); html += `<${want}>`; list = want; } html += '<li>' + inline((ul || ol)[1]) + '</li>'; continue; }
    if (/^#{1,6}\s/.test(line)) { flush(); endList(); html += '<p><strong>' + inline(line.replace(/^#+\s*/, '')) + '</strong></p>'; continue; }
    if (!line.trim()) { flush(); endList(); continue; }
    endList(); para.push(line);
  }
  flush(); endList(); if (code) html += '</code></pre>';
  return html;
}
function osSnapshot() {
  const files = Object.values(FS.nodes).filter((n) => n.type === 'file' && !FS.inTrash(n.id)).sort((a, b) => b.modified - a.modified).slice(0, 120).map((n) => FS.pathOf(n.id) + (n.kind === 'image' ? ' (picture)' : ` (${fmtBytes(n.size || 0)})`));
  const folders = Object.values(FS.nodes).filter((n) => n.type === 'folder' && !FS.isSpecial(n.id) && !FS.inTrash(n.id)).slice(0, 60).map((n) => FS.pathOf(n.id) + '/');
  const wins = WM.list().filter((w) => w.appId !== 'assistant').map((w) => `${w.title}${w.min ? ' (minimized)' : ''}`);
  return [
    `Date and time: ${fmtDT(Date.now(), { dateStyle: 'full', timeStyle: 'short' })}`,
    `User name: ${userName() || 'not set'}. OS name: ${osTitle()}. PC name: ${S.data.deviceName}.`,
    `Theme: ${S.data.theme} (showing ${effectiveTheme()}), accent ${S.data.accent}, wallpaper ${wallName(S.data.wallpaper)}.`,
    `Night light ${S.data.nightLight ? 'on' : 'off'}, Focus (do not disturb) ${S.data.dnd ? 'on' : 'off'}, energy saver ${S.data.energySaver ? 'on' : 'off'}, brightness ${S.data.brightness}%, volume ${S.data.volume}%, text size ${S.data.textSize}px.`,
    `Taskbar: ${S.data.tbAlign}-aligned at the ${S.data.tbPos}${S.data.tbFloat ? ', floating' : ''}.`,
    `Apps you can open: ${Object.keys(APPS).filter((k) => appAvailable(k) && k !== 'assistant').map((k) => `${k} (${APPS[k].name})`).join(', ')}.`,
    `Wallpapers: ${WALLS.map((w) => w.id).join(', ')}.`,
    `Open windows: ${wins.length ? wins.join('; ') : 'none'}.`,
    `Folders: /Desktop/, /Documents/, /Pictures/, /Downloads/${folders.length ? ', ' + folders.join(', ') : ''}.`,
    `Files (newest first): ${files.length ? files.join(', ') : 'none'}.`,
    `Timers: ${Clock.focus.running ? 'focus session with ' + fmtDuration(Clock.focus.left) + ' left' : 'no focus session'}; ${Clock.timer.running ? 'timer with ' + fmtDuration(Clock.timer.left) + ' left' : 'no timer'}.`,
  ].join('\n');
}
function assistantTools(log) {
  const appIds = Object.keys(APPS).filter((k) => appAvailable(k) && k !== 'assistant');
  const ensureDir = (path) => {
    let cur = 'root';
    for (const seg of path.split('/').filter(Boolean)) {
      const kids = cur === 'root' ? FS.children('root') : FS.children(cur);
      let m = kids.find((k) => k.type === 'folder' && k.name.toLowerCase() === seg.toLowerCase());
      if (!m) { if (cur === 'root') throw new Error('Files must go inside Desktop, Documents, Pictures or Downloads'); m = FS.create(cur, seg, 'folder'); }
      cur = m.id;
    }
    if (cur === 'root') throw new Error('Pick a folder such as /Documents');
    return cur;
  };
  const resolve = (p) => { const id = FS.resolve(String(p || ''), 'root'); if (!id) throw new Error('Nothing at ' + p); return id; };
  return [
    { name: 'open_app', description: 'Open an app window on the desktop. Returns a confirmation.', inputSchema: { type: 'object', properties: { app: { type: 'string', enum: appIds } }, required: ['app'] },
      execute: ({ app }) => { app = String(app); if (!appIds.includes(app)) throw new Error('Unknown app: ' + app); WM.open(app); log(`Opened ${APPS[app].name}`, 'external'); return 'Opened ' + APPS[app].name; } },
    { name: 'change_settings', description: 'Change OS settings. Pass only the fields to change. Returns the values that were applied.', inputSchema: { type: 'object', properties: {
        theme: { type: 'string', enum: ['light', 'dark', 'auto'] }, accent: { type: 'string', description: 'Hex color like #3b82f6' }, wallpaper: { type: 'string', enum: WALLS.map((w) => w.id) },
        nightLight: { type: 'boolean' }, focus: { type: 'boolean', description: 'Do not disturb' }, energySaver: { type: 'boolean' }, brightness: { type: 'number', minimum: 30, maximum: 100 }, volume: { type: 'number', minimum: 0, maximum: 100 },
        textSize: { type: 'number', minimum: 12, maximum: 18 }, taskbarAlignment: { type: 'string', enum: ['center', 'left'] }, taskbarPosition: { type: 'string', enum: ['bottom', 'top'] }, floatingTaskbar: { type: 'boolean' },
        osName: { type: 'string' }, userName: { type: 'string' } } },
      execute: (inp) => {
        const p = {}; const done = [];
        const set = (k, v, label) => { p[k] = v; done.push(label); };
        if (['light', 'dark', 'auto'].includes(inp.theme)) set('theme', inp.theme, `${inp.theme} theme`);
        if (typeof inp.accent === 'string' && /^#?[0-9a-f]{6}$/i.test(inp.accent.trim())) { const a = '#' + inp.accent.trim().replace('#', '').toLowerCase(); set('accent', a, 'accent ' + a); }
        if (WALLS.some((w) => w.id === inp.wallpaper)) set('wallpaper', inp.wallpaper, 'wallpaper ' + wallName(inp.wallpaper));
        if (typeof inp.nightLight === 'boolean') set('nightLight', inp.nightLight, 'night light ' + (inp.nightLight ? 'on' : 'off'));
        if (typeof inp.focus === 'boolean') set('dnd', inp.focus, 'Focus ' + (inp.focus ? 'on' : 'off'));
        if (typeof inp.energySaver === 'boolean') set('energySaver', inp.energySaver, 'energy saver ' + (inp.energySaver ? 'on' : 'off'));
        if (inp.brightness != null && isFinite(+inp.brightness)) set('brightness', clamp(Math.round(+inp.brightness), 30, 100), 'brightness ' + clamp(Math.round(+inp.brightness), 30, 100) + '%');
        if (inp.volume != null && isFinite(+inp.volume)) set('volume', clamp(Math.round(+inp.volume), 0, 100), 'volume ' + clamp(Math.round(+inp.volume), 0, 100) + '%');
        if (inp.textSize != null && isFinite(+inp.textSize)) set('textSize', clamp(Math.round(+inp.textSize), 12, 18), 'text size ' + clamp(Math.round(+inp.textSize), 12, 18) + 'px');
        if (['center', 'left'].includes(inp.taskbarAlignment)) set('tbAlign', inp.taskbarAlignment, 'taskbar ' + inp.taskbarAlignment);
        if (['bottom', 'top'].includes(inp.taskbarPosition)) set('tbPos', inp.taskbarPosition, 'taskbar at the ' + inp.taskbarPosition);
        if (typeof inp.floatingTaskbar === 'boolean') set('tbFloat', inp.floatingTaskbar, (inp.floatingTaskbar ? 'floating' : 'docked') + ' taskbar');
        if (typeof inp.osName === 'string' && inp.osName.trim()) set('osName', inp.osName.trim().slice(0, 24), 'OS name ' + inp.osName.trim().slice(0, 24));
        if (typeof inp.userName === 'string') set('userName', inp.userName.trim().slice(0, 32), 'your name');
        if (!done.length) throw new Error('No valid setting was given');
        S.patch(p); log('Set ' + done.join(', '), 'settings');
        return { applied: done };
      } },
    { name: 'list_folder', description: 'List what is inside a folder, such as /Documents or / for the top level. Returns names, kinds and sizes.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: ({ path }) => { const id = resolve(path); if (!FS.isFolder(id)) throw new Error(path + ' is a file'); return FS.children(id).slice(0, 200).map((n) => ({ name: n.name, kind: n.type === 'folder' ? 'folder' : n.kind, size: n.type === 'file' ? fmtBytes(n.size || 0) : undefined })); } },
    { name: 'read_file', description: 'Read a text file. Returns up to 8000 characters of its text.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: ({ path }) => { const id = resolve(path); const n = FS.get(id); if (n.type === 'folder') throw new Error(path + ' is a folder'); if (n.kind === 'image') throw new Error('That is a picture, not text'); log('Read ' + n.name, 'doc'); return FS.read(id).slice(0, 8000); } },
    { name: 'write_file', description: 'Create or replace a text file, then open it in Notes. If the file exists, its old version goes to the Recycle Bin first so the user can get it back. Returns the saved path.', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'For example /Documents/Shopping list.txt' }, content: { type: 'string' }, open: { type: 'boolean', description: 'Open it in Notes (default true)' } }, required: ['path', 'content'] },
      execute: ({ path, content, open }) => {
        path = String(path || '').trim(); if (!path.startsWith('/')) path = '/Documents/' + path;
        const i = path.lastIndexOf('/'); let name = FS.clean(path.slice(i + 1)); if (!name) throw new Error('Missing file name');
        if (!/\.[a-z0-9]{1,8}$/i.test(name)) name += '.txt';
        const dir = ensureDir(path.slice(0, i) || '/Documents');
        const ex = FS.children(dir).find((n) => n.type === 'file' && n.name.toLowerCase() === name.toLowerCase());
        if (ex) FS.trash(ex.id);
        const made = FS.create(dir, name, 'file', String(content ?? ''), 'text');
        log((ex ? 'Replaced ' : 'Saved ') + FS.pathOf(made.id), 'save');
        if (open !== false) WM.open('notes', { file: made.id });
        return { saved: FS.pathOf(made.id), replacedOldVersion: !!ex };
      } },
    { name: 'create_folder', description: 'Create a folder, for example /Documents/Trips. Returns its path.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: ({ path }) => { const id = ensureDir(String(path || '')); log('Created folder ' + FS.pathOf(id), 'folder'); return FS.pathOf(id); } },
    { name: 'move_to_recycle_bin', description: 'Move a file or folder to the Recycle Bin. The user can restore it from there.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: ({ path }) => { const id = resolve(path); if (FS.isSpecial(id)) throw new Error('That folder cannot be removed'); const nm = FS.get(id).name; FS.trash(id); log('Moved ' + nm + ' to the Recycle Bin', 'trash'); return 'Moved to the Recycle Bin'; } },
    { name: 'open_file', description: 'Open a file in its app, or a folder in Files.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      execute: ({ path }) => { const id = resolve(path); openNode(id); log('Opened ' + FS.get(id).name, 'external'); return 'Opened'; } },
    { name: 'start_timer', description: 'Start a countdown timer, or a focus session that also silences notifications. Returns when it ends.', inputSchema: { type: 'object', properties: { minutes: { type: 'number', minimum: 0.1, maximum: 600 }, kind: { type: 'string', enum: ['timer', 'focus'] }, label: { type: 'string' } }, required: ['minutes'] },
      execute: ({ minutes, kind, label }) => { const m = clamp(+minutes || 0, 0.1, 600); if (kind === 'focus') Clock.startFocus(m); else Clock.startTimer(m, label ? String(label).slice(0, 40) : 'Timer'); log(`Started a ${fmtDuration(m * 60000)} ${kind === 'focus' ? 'focus session' : 'timer'}`, 'timer'); return { endsAt: fmtDT(Date.now() + m * 60000, { timeStyle: 'short' }) }; } },
    { name: 'lock_screen', description: 'Lock the screen right away.', inputSchema: { type: 'object', properties: {} },
      execute: () => { setTimeout(() => Power.lock(), 1200); log('Locking the screen', 'lock'); return 'The screen will lock in a moment'; } },
  ];
}
function mountAssistant(root, api, args) {
  const turns = []; let ctl = null, busy = false, disabled = '';
  root.classList.add('app-ai');
  root.innerHTML = `
    <div class="ai-head"><div class="seg" role="group" aria-label="Answer style"><button data-mode="quick">Fast</button><button data-mode="default">Thorough</button></div><span class="grow"></span><button class="ibtn" data-act="new" aria-label="New chat" data-tip="New chat">${ui('newchat')}</button></div>
    <div class="ai-log selectable" role="log" aria-live="polite"></div>
    <form class="ai-form"><textarea id="${api.id}-ask" rows="1" placeholder="Ask anything, or tell me what to do" aria-label="Message the assistant"></textarea><button class="ai-send" type="submit" aria-label="Send">${ui('send')}</button></form>
    <div class="ai-foot muted">Uses your Claude account. It can open apps, change settings and work with your files.</div>`;
  const log = root.querySelector('.ai-log'), form = root.querySelector('.ai-form'), ta = form.querySelector('textarea'), sendBtn = form.querySelector('.ai-send');
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const SUGGEST = ['Switch to dark mode with a teal accent', 'Write a packing list for a weekend trip and save it', 'What is in my Documents folder?', 'Start a 10 minute timer', 'Move the taskbar to the top', 'Give me three ideas for a weekend project'];
  function empty() {
    log.innerHTML = '';
    const box = h('div', { class: 'ai-empty' }, h('div', { class: 'ai-logo', html: appIcon('assistant') }), h('h2', { text: userName() ? `Hi ${userName().split(' ')[0]}, how can I help?` : 'How can I help?' }), h('p', { class: 'muted', text: caps.tools ? 'Ask a question, or ask me to do something on this PC.' : 'Ask a question. In this view I can answer, but I cannot change anything for you.' }));
    const chips = h('div', { class: 'ai-chips' });
    for (const s of SUGGEST) chips.append(h('button', { class: 'chip', text: s, onclick: () => send(s) }));
    box.append(chips); log.append(box);
  }
  function setMode() { root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String((S.data.assistantMode || 'quick') === b.dataset.mode))); }
  function setBusy(v) { busy = v; sendBtn.innerHTML = ui(v ? 'stop' : 'send'); sendBtn.setAttribute('aria-label', v ? 'Stop' : 'Send'); sendBtn.classList.toggle('stop', v); }
  function bubble(role, text) {
    log.querySelector('.ai-empty')?.remove();
    const wrap = h('div', { class: 'ai-msg ' + role });
    const b = h('div', { class: 'ai-bubble' });
    if (role === 'user') b.textContent = text; else b.innerHTML = text ? mdToHTML(text) : '';
    if (role === 'assistant') wrap.append(h('span', { class: 'ai-av', html: appIcon('assistant') }));
    wrap.append(b); log.append(wrap); scroll();
    return b;
  }
  function note(text, cls = '') { log.append(h('div', { class: 'ai-note ' + cls, text })); scroll(); }
  const COPY = {
    not_granted: 'The assistant needs your permission to use Claude. It stays off for this visit because the request was declined.',
    sampling_disabled: 'Claude is not available for this account, so the assistant is off.',
    not_declared: 'The assistant is not enabled for this page.', capability_disabled: 'The assistant cannot run in this view.', capability_removed: 'The assistant cannot run in this view.',
    rate_limited: 'You have reached a usage limit. Try again in a little while.', session_expired: 'Your Claude session expired. Sign in again, then try once more.',
    refused: 'The assistant cannot help with that request. Try asking something else.', empty_completion: 'The assistant did not reply. Try asking in a different way.',
    prompt_too_large: 'That was too much text at once. Start a new chat or ask about less.', tools_unavailable: 'In this view the assistant can answer but cannot act on the OS.',
  };
  const FATAL = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'];
  async function send(text) {
    text = String(text || '').trim();
    if (busy || !text || disabled) return;
    const sample = caps.sample;
    if (!sample) { note('The assistant works when this OS is open in Claude.'); return; }
    ta.value = ''; autoGrow();
    turns.push({ role: 'user', content: text });
    bubble('user', text);
    const wrapEl = h('div', { class: 'ai-msg assistant' }, h('span', { class: 'ai-av', html: appIcon('assistant') }));
    const col = h('div', { class: 'ai-col' }); const acts = h('div', { class: 'ai-acts' }); const b = h('div', { class: 'ai-bubble thinking', text: 'Thinking…' });
    col.append(acts, b); wrapEl.append(col); log.append(wrapEl); scroll();
    setBusy(true); ctl = new AbortController();
    const act = (txt, icon) => { acts.append(h('div', { class: 'ai-act' }, h('span', { html: ui(icon || 'check') }), h('span', { text: txt }))); scroll(); };
    const useTools = !!caps.tools;
    const rules = `You are the assistant built into ${osTitle()}, a desktop operating system that runs in the user's web browser. You talk with the user in a small chat window on their desktop.
${useTools ? 'You can act on the OS with the tools you have. When the user asks you to do something, do it with the tools instead of explaining how. Harmless actions need no confirmation. Removing a file moves it to the Recycle Bin, and replacing a file keeps the old version there, so the user can undo.' : 'In this view you cannot change anything on the OS. If the user asks you to do something, tell them in one or two short steps how to do it themselves.'}
Keep replies short: one to four sentences unless the user asks for more. Write plainly. You may use **bold**, short bullet lists and \`code\`. Only mention files that appear in the list below or that a tool returned.

What the OS looks like right now:
${osSnapshot()}`;
    const keep = turns.slice(-16);
    if (keep[0]?.role !== 'user') keep.shift();
    try {
      const opts = { signal: ctl.signal, cache: false, modelTier: S.data.assistantMode === 'default' ? 'default' : 'quick', onText: ({ text: t }) => { b.classList.remove('thinking'); b.innerHTML = mdToHTML(t); scroll(); } };
      if (useTools) opts.tools = assistantTools(act).slice(0, caps.maxTools || 16);
      const res = await sample([{ role: 'user', content: rules }, ...keep], opts);
      b.classList.remove('thinking'); b.innerHTML = mdToHTML(res.text);
      turns.push({ role: 'assistant', content: res.text });
      if (res.truncated) note('The answer was cut short. Ask for less at a time.');
    } catch (e) {
      const code = e && e.code;
      b.classList.remove('thinking');
      if (e && e.text && code !== 'refused') { b.innerHTML = mdToHTML(e.text); turns.push({ role: 'assistant', content: e.text }); }
      else if (!acts.childElementCount) wrapEl.remove(); else b.remove();
      if (code === 'cancelled') note('Stopped.');
      else { note(COPY[code] || 'Something went wrong while reaching Claude. Try again.', 'err'); if (code === 'refused') turns.pop(); }
      if (FATAL.includes(code)) { disabled = code; ta.disabled = true; ta.placeholder = 'The assistant is off for this visit'; }
    } finally { setBusy(false); ctl = null; if (!disabled) ta.focus({ preventScroll: true }); }
  }
  function autoGrow() { ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px'; }
  form.addEventListener('submit', (e) => { e.preventDefault(); if (busy) ctl?.abort(); else send(ta.value); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) send(ta.value); } });
  ta.addEventListener('input', autoGrow);
  root.querySelector('.ai-head').addEventListener('click', (e) => {
    const m = e.target.closest('[data-mode]'); if (m) { S.set('assistantMode', m.dataset.mode); setMode(); return; }
    if (e.target.closest('[data-act="new"]')) { if (busy) ctl?.abort(); turns.length = 0; empty(); ta.focus(); }
  });
  api.onClose(() => ctl?.abort());
  api.onArgs = (a) => { if (a.ask) send(a.ask); };
  setMode(); empty();
  if (args.ask) send(args.ask);
  requestAnimationFrame(() => ta.focus({ preventScroll: true }));
}
