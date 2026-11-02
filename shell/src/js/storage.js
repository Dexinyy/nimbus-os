/* ========== Saving between restarts (installed OS, live session) ==========
   Nimbus starts with casper's "persistent" option: when a storage area exists, everything that
   changes (files, settings, Wi-Fi passwords, installed programs) is kept on it. Started from a USB
   stick, casper makes one in the stick's free space by itself. Otherwise (a DVD, a virtual machine)
   the root helper nimbus-storage can make one on a completely empty disk. */
const Storage = {
  info: null, busy: false,
  get saving() { return IS_NATIVE && !!(Native.info && Native.info.persistent); },
  async status() {
    this.info = await Native.call('storageStatus', {}, 60000);
    bus.emit('storage');
    return this.info;
  },
  async setup(id) {
    this.busy = true; bus.emit('storage');
    try { this.info = await Native.call('storageSetup', { id }, 240000); return this.info; }
    finally { this.busy = false; bus.emit('storage'); }
  },
  placeText(c) {
    return { title: `Empty ${c.disk.kind}: ${c.disk.name}`, desc: `${fmtBytes(c.size)}. It looks completely empty; it will be prepared for Nimbus OS.` };
  },
  /* The setup dialog: pick a place, confirm, then offer a restart. */
  async open() {
    let info;
    try { info = await this.status(); } catch (e) { Dialog.show({ title: 'Couldn’t check for storage', message: e.message }); return; }
    if (info.storage) {
      const s = info.storage;
      Dialog.show({ title: s.active ? 'Saving is on' : 'Restart to start saving',
        message: s.active ? `Your work is kept on ${s.disk.name}.` : `A storage area is ready on ${s.disk.name}. Restart, and from then on your work is kept.`,
        buttons: s.active ? [{ label: 'OK', value: true, primary: true }] : [{ label: 'Restart now', value: 'restart', primary: true }, { label: 'Later', value: null }] })
        .then((v) => { if (v === 'restart') Power.restart(); });
      return;
    }
    if (!info.candidates.length) {
      Dialog.show({ title: 'No place to save yet',
        message: 'Started from a USB stick with free space, Nimbus OS saves your work by itself. This time it started from a DVD or a disk image, and there’s no empty disk to use. '
          + 'In VirtualBox: shut down, open Settings → Storage, add a new hard disk (8 GB is plenty), and start Nimbus OS again.' });
      return;
    }
    let pick = info.candidates[0].id;
    const list = h('div', { class: 'stg-list', role: 'radiogroup', 'aria-label': 'Where to save' });
    for (const c of info.candidates) {
      const t = this.placeText(c);
      const b = h('button', { class: 'stg-opt', role: 'radio', 'aria-checked': String(c.id === pick) },
        h('span', { class: 'stg-ic', html: ui('hdd') }), h('span', { class: 'stg-txt' }, h('b', { text: t.title }), h('span', { class: 'muted', text: t.desc })));
      b.addEventListener('click', () => { pick = c.id; list.querySelectorAll('.stg-opt').forEach((x) => x.setAttribute('aria-checked', String(x === b))); });
      list.append(b);
    }
    const content = h('div', { class: 'stg' }, h('p', { text: 'Your files, settings and Wi-Fi passwords will be kept between restarts. Choose where:' }), list);
    const go = await Dialog.show({ title: 'Keep your work', content, wide: true,
      buttons: [{ label: 'Set up saving', value: true, primary: true }, { label: 'Cancel', value: null }] });
    if (!go) return;
    const c = info.candidates.find((x) => x.id === pick);
    const sure = await Dialog.show({ title: `Use ${c.disk.name}?`,
      message: `Everything on ${c.disk.name} (${fmtBytes(c.disk.size)}) will be erased. It looks empty, so nothing should be lost, but if you keep anything on it, cancel now.`,
      buttons: [{ label: 'Erase and use it', value: true, primary: true }, { label: 'Cancel', value: null }] });
    if (!sure) return;
    Notif.push({ app: 'settings', title: 'Setting up saving…', body: 'This takes a few seconds.', silent: true });
    try { await this.setup(pick); } catch (e) { Dialog.show({ title: 'Couldn’t set up saving', message: e.message }); return; }
    const again = await Dialog.show({ title: 'Saving is ready', message: 'Restart Nimbus OS to start keeping your work. Changes you make before restarting aren’t kept.',
      buttons: [{ label: 'Restart now', value: true, primary: true }, { label: 'Later', value: null }] });
    if (again) Power.restart();
  },
};

/* Boot tests only ("nimbus.test=storage"). From a USB image, casper starts saving by itself; from a
   DVD with an empty disk, the first start sets up saving there and restarts. Once saving is on: write
   a marker and restart, then report whether it's still there. os/qmp.py follows the system log. */
async function testStorage() {
  const log = (text) => Native.call('log', { text: 'test storage: ' + text }).catch(() => {});
  const restart = async (why) => { await sleep(1500); Store.flushLocal(); await sleep(2000); log(why + ', restarting'); await sleep(500); await Native.call('power', { action: 'reboot' }); };
  try {
    const info = await Storage.status();
    if (info.storage && info.storage.active) {
      if (S.data.testMarker === 'kept-across-restart') { log('kept'); return; }
      S.set('testMarker', 'kept-across-restart');
      await restart('marker written');
      return;
    }
    const c = info.candidates[0];
    if (!c) { log('failed: nowhere to save: ' + JSON.stringify(info)); return; }
    await Storage.setup(c.id);
    await restart('set up on ' + c.device);
  } catch (e) {
    log('failed: ' + e.message);
  }
}
