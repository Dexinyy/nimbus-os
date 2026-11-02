/* ========== Native bridge ==========
   Present only when this page runs as the desktop of Nimbus OS (the nimbus-shell
   launcher registers a WebKit message handler named "nimbus"). In a normal
   browser it is null and the desktop keeps its web behaviour. */
const Native = (() => {
  const handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nimbus;
  if (!handler) return null;
  let seq = 0;
  const pending = new Map();
  window.__nimbusNative = {
    resolve(id, data) { const p = pending.get(id); if (!p) return; pending.delete(id); clearTimeout(p.t); p.resolve(data); },
    reject(id, msg) { const p = pending.get(id); if (!p) return; pending.delete(id); clearTimeout(p.t); p.reject(new Error(msg || 'The system refused')); },
  };
  const api = {
    info: null,
    call(method, args = {}, timeout = 25000) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        const t = setTimeout(() => { if (pending.delete(id)) reject(new Error('The system did not answer')); }, timeout);
        pending.set(id, { resolve, reject, t });
        try { handler.postMessage(JSON.stringify({ id, method, args })); }
        catch (e) { clearTimeout(t); pending.delete(id); reject(e); }
      });
    },
    async refresh() {
      try { api.info = await api.call('info'); api.infoAt = Date.now(); bus.emit('native-info', api.info); }
      catch (e) { console.warn('Could not read system info', e); }
      return api.info;
    },
    get live() { return !!(api.info && api.info.live); },
  };
  // Debug start-up ("nimbus.debug" on the kernel command line): log keyboard and focus events to the system journal.
  if (/[?&]debug=1\b/.test(location.search)) {
    const log = (text) => { try { handler.postMessage(JSON.stringify({ id: 0, method: 'log', args: { text } })); } catch {} };
    const where = () => { const a = document.activeElement; return a ? a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.split(' ')[0] : '') : 'none'; };
    for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, (e) => log(`${type} key=${e.key} code=${e.code} repeat=${e.repeat} focus=${where()} hasFocus=${document.hasFocus()}`), true);
    }
    window.addEventListener('focus', () => log('window focus'));
    window.addEventListener('blur', () => log('window blur'));
    window.addEventListener('error', (e) => log(`error: ${e.message} at ${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', (e) => log(`unhandled rejection: ${e.reason && e.reason.message || e.reason}`));
    log(`page loaded, hasFocus=${document.hasFocus()}`);
  }
  return api;
})();
const IS_NATIVE = !!Native;

/* A time zone picker that changes the computer's time zone (native only) */
function buildTzSelect(id) {
  const cur = (Native && Native.info && Native.info.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const sel = h('select', { class: 'field', id, 'aria-label': 'Time zone', style: 'max-width:280px' });
  sel.append(h('option', { value: cur, text: cur.replace(/_/g, ' ') }));
  Native.call('timezones').then((list) => {
    sel.innerHTML = '';
    for (const z of list) sel.append(h('option', { value: z, text: z.replace(/_/g, ' '), selected: z === cur }));
  }).catch(() => {});
  sel.addEventListener('change', async () => {
    Store.flushLocal();
    try { await Native.call('setTimezone', { tz: sel.value }); Notif.push({ app: 'settings', title: 'Time zone changed', body: 'The desktop restarts for a moment to use it.', silent: true }); }
    catch (e) { Notif.push({ app: 'settings', title: 'Could not change the time zone', body: e.message }); }
  });
  return sel;
}
