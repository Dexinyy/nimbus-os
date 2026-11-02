/* ========== The computer's hardware and services ==========
   Sound (PipeWire), displays and input (the window manager), Bluetooth (BlueZ), power, storage,
   time, updates and the clipboard, as the launcher reports them (nimbus-shell, nimbus_sys.py).
   Each service keeps its last status in .st and announces changes on the bus as 'sys' with its
   name. In a browser nothing is available and every status says so. */
const Sys = (() => {
  const call = (method, args = {}, timeout) => (IS_NATIVE ? Native.call(method, args, timeout) : Promise.reject(new Error('This needs Nimbus OS on a computer')));
  function service(name, method, empty) {
    const s = {
      name, st: Object.assign({}, empty), ready: false,
      async refresh() {
        if (!IS_NATIVE) { s.ready = true; return s.st; }
        try { s.st = Object.assign({}, empty, await call(method)); } catch (e) { s.st = Object.assign({}, empty, { error: e.message }); }
        s.ready = true; bus.emit('sys', name); return s.st;
      },
      update(d) { s.st = Object.assign({}, empty, d); s.ready = true; bus.emit('sys', name); },
    };
    if (IS_NATIVE) bus.on('native:' + name, (d) => (d && typeof d === 'object' ? s.update(d) : s.refresh()));
    return s;
  }

  /* Sound: outputs (sinks), inputs (sources) and programs playing (streams) */
  const sound = service('sound', 'soundStatus', { available: false, outputs: [], inputs: [], streams: [] });
  sound.def = (kind = 'sink') => (sound.st[kind === 'source' ? 'inputs' : 'outputs'] || []).find((d) => d.default) || null;
  sound.set = (what, kind, id, value) => call('soundSet', { what, kind, id, value }).catch((e) => Notif.push({ app: 'settings', title: 'Sound settings didn’t change', body: e.message, silent: true }));
  sound.volumeTimer = 0;
  // The taskbar's volume (S.data.volume) is the main output's volume
  sound.setMainVolume = (v) => {
    const d = sound.def('sink'); if (!d) return;
    d.volume = v;
    clearTimeout(sound.volumeTimer); sound.volumeTimer = setTimeout(() => sound.set('volume', 'sink', d.id, v), 40);
  };

  /* Displays, as the window manager reports them; backlight brightness when the screen has one */
  const display = service('display', 'displayStatus', { outputs: [], backlight: null });
  display.main = () => display.st.outputs[0] || null;
  display.set = (args) => call('displaySet', args);

  /* Keyboards, mice and touchpads the window manager sees */
  const input = service('input', 'inputStatus', { keyboards: [], pointers: [], touchpad: false });

  /* Bluetooth */
  const bt = service('bluetooth', 'btStatus', { available: false, powered: false, discovering: false, name: '', devices: [] });
  bt.do = (args) => call('btDo', args, 60000);

  /* Power: battery, power modes (power-profiles-daemon) */
  const power = service('power', 'powerStatus', { battery: null, profiles: [], profile: '', ac: true, lid: false });

  /* Clock: whether it sets itself (NTP) */
  const time = service('time', 'timeStatus', { ntp: true, synced: false, timezone: 'UTC', canNtp: false });

  // Settings the desktop keeps that the window manager applies (it starts fresh each time)
  function applyInput() {
    if (!NativeWin.on) return;
    const d = S.data;
    // speeds 1-20 become libinput's -1..1; scrolling is in lines (3 is normal)
    const sp = (v) => Math.round(((clamp(+v || 10, 1, 20) - 10) / 10) * 1000);
    NativeWin.call('input', {
      speed: sp(d.pointerSpeed), accel: d.pointerAccel === false ? 0 : 1, left: d.pointerLeft ? 1 : 0, scroll: clamp(+d.scrollLines || 3, 1, 20), natural: d.mouseNatural ? 1 : 0,
      tap: d.touchpadTap ? 1 : 0, tap2: d.touchpadTap2 === false ? 0 : 1, twofinger: d.touchpadTwoFinger === false ? 0 : 1, tnatural: d.touchpadNatural ? 1 : 0,
      dwt: d.touchpadDwt ? 1 : 0, tspeed: sp(d.touchpadSpeed), touchpad: d.touchpadOn ? 1 : 0,
    });
  }
  function applyKeyboard() {
    if (!NativeWin.on) return;
    NativeWin.call('keymap', { layout: S.data.kbLayout || 'us', variant: S.data.kbVariant || '', delay: S.data.kbDelay, rate: S.data.kbRate });
  }
  function applyCursor() {
    if (NativeWin.on) NativeWin.call('cursor', { size: S.data.cursorSize || 24, theme: S.data.cursorTheme === 'black' ? 'black' : 'white' });
    call('cursorSet', { size: S.data.cursorSize || 24, theme: S.data.cursorTheme === 'black' ? 'black' : 'white' }).catch(() => {}); // programs' own pointers
  }
  function applyIdle() {
    if (!NativeWin.on) return;
    const onBattery = power.st.battery && !power.st.ac;
    const p = onBattery ? S.data.powerBattery : S.data.powerPlugged;
    NativeWin.call('idle', { screen: p.screen || 0, sleep: p.sleep || 0 });
  }
  function applyDisplay() {
    const want = S.data.display; const o = display.main();
    if (!NativeWin.on || !o || !want) return;
    const args = { name: o.name };
    if (want.mode && o.modes.some((m) => m[0] === want.mode[0] && m[1] === want.mode[1] && m[2] === want.mode[2])) args.mode = want.mode;
    if (want.scale && want.scale !== o.scale) args.scale = want.scale;
    if (want.transform != null && want.transform !== o.transform) args.transform = want.transform;
    if (Object.keys(args).length > 1) display.set(args).catch(() => {});
  }
  // Volume and brightness from the taskbar go to the real hardware
  function applyVolume() { if (sound.st.available) sound.setMainVolume(S.data.volume); }
  function applyHwBrightness() { if (display.st.backlight) call('brightnessSet', { percent: S.data.brightness }).catch(() => {}); }

  // The window manager starts fresh: give it the settings it keeps
  function wmReady() {
    if (!NativeWin.on) return;
    applyInput(); applyKeyboard(); applyCursor(); applyIdle();
    display.refresh().then(applyDisplay); input.refresh();
  }
  function init() {
    if (!IS_NATIVE) return;
    sound.refresh(); power.refresh(); time.refresh(); bt.refresh(); display.refresh(); input.refresh();
    Object.assign(APPLY, {
      pointerSpeed: applyInput, pointerLeft: applyInput, scrollLines: applyInput, mouseNatural: applyInput, touchpadTap: applyInput,
      touchpadNatural: applyInput, touchpadDwt: applyInput, touchpadSpeed: applyInput, touchpadOn: applyInput,
      pointerAccel: applyInput, touchpadTap2: applyInput, touchpadTwoFinger: applyInput,
      kbLayout: applyKeyboard, kbVariant: applyKeyboard, kbDelay: applyKeyboard, kbRate: applyKeyboard, cursorSize: applyCursor, cursorTheme: applyCursor,
      powerPlugged: applyIdle, powerBattery: applyIdle,
    });
    const prevVol = APPLY.volume, prevBright = APPLY.brightness;
    APPLY.volume = () => { prevVol?.(); applyVolume(); };
    APPLY.brightness = () => { prevBright?.(); applyHwBrightness(); };
    // The main output's volume shows on the taskbar and in quick settings
    bus.on('sys', (name) => {
      if (name === 'sound') {
        const d = sound.def('sink');
        if (d && (S.data.volume !== d.volume || !!S.data.muted !== !!d.muted)) { S.data.volume = d.volume; S.data.muted = !!d.muted; bus.emit('settings', ['volume']); Taskbar.tray(); }
      }
      if (name === 'power') applyIdle();
      if (name === 'display') {
        // the screen's own brightness is the starting point, as with the volume
        const bl = display.st.backlight;
        if (bl && !display.synced) { display.synced = true; S.data.brightness = clamp(bl.percent, 5, 100); bus.emit('settings', ['brightness']); }
        applyBrightness_();
      }
    });
  }
  // A screen with a backlight is dimmed for real, so the dark layer (shell.js) goes away
  const applyBrightness_ = () => applyBrightness();
  return { call, sound, display, input, bt, power, time, init, wmReady, applyInput, applyKeyboard, applyIdle, applyDisplay };
})();
