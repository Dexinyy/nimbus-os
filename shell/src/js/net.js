/* ========== Network: Wi-Fi and wired (installed OS) ==========
   State comes from nimbus_net.py through the native bridge; 'native:net' events arrive whenever
   NetworkManager reports a change. bus 'net' tells the taskbar, Quick settings and Settings to redraw. */
function wifiIcon(level, cls) {
  // level 0-4: how much of the fan is lit
  const parts = ['M12 19.3h.01', 'M9 16a4.5 4.5 0 0 1 6 0', 'M5.9 12.6a9 9 0 0 1 12.2 0', 'M2.8 9.2a13.5 13.5 0 0 1 18.4 0'];
  const paths = parts.map((d, i) => `<path d="${d}"${i < level ? '' : ' opacity=".28"'}/>`).join('');
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${paths}</svg>`;
}
const Net = {
  status: null, networks: [], scanning: false, busy: '', error: null,
  get ready() { return IS_NATIVE && !!(this.status && this.status.available); },
  get hasWifi() { return this.ready && this.status.wifi.present; },
  async refresh() {
    if (!IS_NATIVE) return null;
    try { this.status = await Native.call('netStatus'); } catch (e) { console.warn('Network status', e); }
    bus.emit('net');
    return this.status;
  },
  async scan(rescan = true) {
    if (!this.hasWifi || this.scanning) return;
    this.scanning = true; bus.emit('net');
    try { this.networks = await Native.call('wifiList', { rescan }, 50000); } catch (e) { console.warn('Wi-Fi list', e); }
    this.scanning = false; bus.emit('net');
  },
  async act(method, args, ssid = '') {
    this.busy = ssid || method; this.error = null; bus.emit('net');
    try {
      const s = await Native.call(method, args, 80000);
      if (s && typeof s === 'object' && 'available' in s) this.status = s;
      return true;
    } catch (e) {
      this.error = { ssid, message: e.message };
      return false;
    } finally {
      this.busy = ''; bus.emit('net'); this.scan(false);
    }
  },
  connect(ssid, password) { return this.act('wifiConnect', { ssid, password: password || null }, ssid); },
  disconnect() { return this.act('wifiDisconnect', {}); },
  forget(ssid) { return this.act('wifiForget', { ssid }); },
  async setWifi(on) { await this.act('wifiRadio', { on }); if (on) setTimeout(() => this.scan(true), 1500); },
  setAirplane(on) { return this.act('airplane', { on }); },
  level(signal) { return signal >= 70 ? 4 : signal >= 45 ? 3 : signal >= 20 ? 2 : 1; },
  icon(cls) {
    const s = this.status;
    if (!this.ready) return ui(navigator.onLine === false ? 'wifiOff' : 'wifi', cls);
    if (s.airplane) return ui('airplane', cls);
    if (s.wifi.ssid) return wifiIcon(this.level(s.wifi.signal), cls);
    if (s.wired.connected) return ui('ethernet', cls);
    return ui('wifiOff', cls);
  },
  label() {
    const s = this.status;
    if (!this.ready) return navigator.onLine === false ? 'Offline' : 'Online';
    const net = s.connectivity === 'full' || s.connectivity === 'unknown' ? '' : s.connectivity === 'portal' ? ' (sign-in needed)' : ' (no internet)';
    if (s.airplane) return 'Airplane mode';
    if (s.wifi.ssid) return s.wifi.ssid + net;
    if (s.wired.connected) return 'Ethernet' + net;
    if (s.wifi.connecting) return `Connecting to ${s.wifi.connecting}…`;
    return 'Not connected';
  },
};
if (IS_NATIVE) bus.on('native:net', (s) => { Net.status = s; bus.emit('net'); });

/* A list of Wi-Fi networks: click one to connect, typing the password when it needs one.
   Rows are updated in place, so a password being typed survives refreshes. */
function netList() {
  const el = h('div', { class: 'netlist' });
  const rows = new Map();
  let open = '', showPw = false;
  function rowFor(n) {
    let r = rows.get(n.ssid);
    if (r) return r;
    r = { el: h('div', { class: 'net' }), key: null };
    r.head = h('button', { class: 'net-head' });
    r.head.addEventListener('click', () => {
      open = open === n.ssid ? '' : n.ssid; showPw = false; Net.error = null; render();
      if (open) requestAnimationFrame(() => r.el.querySelector('.net-body input, .net-body .btn.primary')?.focus());
    });
    r.body = h('div', { class: 'net-body' });
    r.el.append(r.head, r.body);
    rows.set(n.ssid, r);
    return r;
  }
  function paint(r, n) {
    const busy = Net.busy === n.ssid, isOpen = open === n.ssid;
    const state = busy ? 'Connecting…' : n.active ? 'Connected' : n.saved ? 'Saved' : n.secure ? 'Secured' : 'Open';
    r.head.innerHTML = `${wifiIcon(Net.level(n.signal))}<span class="net-name">${esc(n.ssid)}</span>${n.secure ? ui('lock', 'net-lock') : ''}<span class="net-state">${state}</span>`;
    r.head.setAttribute('aria-expanded', String(isOpen));
    r.head.setAttribute('aria-label', `${n.ssid}, ${state}, signal ${n.signal}%`);
    r.el.classList.toggle('active', !!n.active);
    r.el.classList.toggle('open', isOpen);
    const err = Net.error && Net.error.ssid === n.ssid ? Net.error.message : '';
    const key = [isOpen, n.active, n.saved, n.secure, busy, err].join('|');
    if (r.key === key) return; // keep what's on screen (and a password being typed)
    r.key = key;
    r.body.replaceChildren();
    if (!isOpen) return;
    if (err) r.body.append(h('div', { class: 'net-err', role: 'alert', text: err }));
    if (n.active) {
      r.body.append(h('div', { class: 'net-btns' },
        n.saved ? h('button', { class: 'btn', text: 'Forget', onclick: () => Net.forget(n.ssid) }) : null,
        h('button', { class: 'btn primary', text: 'Disconnect', disabled: !!Net.busy, onclick: () => Net.disconnect() })));
      return;
    }
    const needPw = n.secure && (!n.saved || !!err);
    let pw = null;
    if (needPw) {
      pw = h('input', { class: 'field', type: 'password', placeholder: 'Password', 'aria-label': `Password for ${n.ssid}`, autocomplete: 'off', spellcheck: 'false' });
      const eye = h('button', { class: 'ibtn', 'aria-label': 'Show password', 'aria-pressed': 'false', html: ui('eye') });
      eye.addEventListener('click', () => { showPw = !showPw; pw.type = showPw ? 'text' : 'password'; eye.setAttribute('aria-pressed', String(showPw)); pw.focus(); });
      pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      r.body.append(h('div', { class: 'net-pw' }, pw, eye));
    }
    const go = () => {
      if (Net.busy) return;
      if (pw && pw.value.length < 8) { pw.setCustomValidity('Wi-Fi passwords have at least 8 characters.'); pw.reportValidity(); pw.setCustomValidity(''); return; }
      Net.connect(n.ssid, pw ? pw.value : null).then((ok) => { if (ok) { open = ''; render(); } });
    };
    r.body.append(h('div', { class: 'net-btns' },
      n.saved ? h('button', { class: 'btn', text: 'Forget', onclick: () => Net.forget(n.ssid) }) : null,
      h('button', { class: 'btn primary', text: busy ? 'Connecting…' : 'Connect', disabled: !!Net.busy, onclick: go })));
  }
  function message(text) { rows.clear(); el.replaceChildren(h('div', { class: 'net-empty', text })); }
  function render() {
    const s = Net.status;
    if (!Net.ready) return message('The network service isn’t running.');
    if (!s.wifi.present) return message(s.wired.connected ? 'This PC is connected with a cable. It has no Wi-Fi adapter.' : 'This PC has no Wi-Fi adapter.');
    if (s.airplane) return message('Airplane mode is on.');
    if (!s.wifi.enabled) return message('Wi-Fi is off.');
    if (!Net.networks.length) return message(Net.scanning ? 'Looking for networks…' : 'No networks found.');
    const want = Net.networks.map((n) => { const r = rowFor(n); paint(r, n); return r.el; });
    for (const ssid of [...rows.keys()]) if (!Net.networks.some((n) => n.ssid === ssid)) rows.delete(ssid);
    const same = want.length === el.children.length && want.every((x, i) => el.children[i] === x);
    if (!same) {
      const focused = el.contains(document.activeElement) ? document.activeElement : null;
      el.replaceChildren(...want);
      focused?.focus({ preventScroll: true });
    }
    el.classList.toggle('scanning', Net.scanning);
  }
  const off = bus.on('net', render);
  render();
  Net.scan(true);
  const timer = setInterval(() => { if (document.body.contains(el)) Net.scan(true); }, 20000);
  return { el, render, destroy() { off(); clearInterval(timer); } };
}

/* Boot tests only ("nimbus.test=wifi"): join NimbusTestAP through the same code as the Wi-Fi menu,
   and write the result to the system log for os/qmp.py to read. */
async function testWifi() {
  const log = (text) => Native.call('log', { text: 'test wifi: ' + text }).catch(() => {});
  for (let i = 0; i < 45 && !Net.networks.some((n) => n.ssid === 'NimbusTestAP'); i++) {
    await Net.refresh(); await Net.scan(true); await sleep(1500);
  }
  if (!Net.networks.some((n) => n.ssid === 'NimbusTestAP')) { log('failed: NimbusTestAP never showed up'); return; }
  const ok = await Net.connect('NimbusTestAP', 'nimbus-test-123');
  log(ok ? 'connected' : 'failed: ' + (Net.error ? Net.error.message : 'no reason given'));
  await sleep(2500);
  log('settings shows ' + (document.querySelector('.app-settings .net-hero-t')?.textContent || 'nothing'));
}
