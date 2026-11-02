/* ========== Procedural wallpapers (Canvas) ========== */
function grain(c, w, h, R, amt) {
  const t = document.createElement('canvas'); t.width = t.height = 128;
  const tc = t.getContext('2d'); const id = tc.createImageData(128, 128);
  for (let i = 0; i < id.data.length; i += 4) { const v = R() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255 * amt; }
  tc.putImageData(id, 0, 0);
  c.fillStyle = c.createPattern(t, 'repeat'); c.fillRect(0, 0, w, h);
}
function glow(c, x, y, r, color, w, h) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, color.replace(/[\d.]+\)$/, '0)'));
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}
function ridge(c, w, h, base, amp, R, fill) {
  const ph = [R() * 6, R() * 6, R() * 6, R() * 6], f = [1.2 + R(), 2.8 + R() * 2, 6 + R() * 4, 19 + R() * 9];
  c.beginPath(); c.moveTo(0, h);
  for (let x = 0; x <= w + 6; x += 6) {
    const t = x / w;
    const y = base - amp * (0.55 * Math.sin(t * f[0] * Math.PI + ph[0]) + 0.3 * Math.sin(t * f[1] * Math.PI + ph[1]) + 0.12 * Math.sin(t * f[2] * Math.PI + ph[2]) + 0.04 * Math.sin(t * f[3] * Math.PI + ph[3]));
    c.lineTo(x, y);
  }
  c.lineTo(w, h); c.closePath(); c.fillStyle = fill; c.fill();
}
const WALLS = [
  { id: 'ridgeline', name: 'Ridgeline', tint: '#4a5590', draw(c, w, h, R) {
    let g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#121a3c'); g.addColorStop(0.4, '#2f3f78'); g.addColorStop(0.66, '#a86e78'); g.addColorStop(0.82, '#eda877'); g.addColorStop(1, '#f6c58c');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const s = w / 1920;
    for (let i = 0; i < 170; i++) { const x = R() * w, y = R() * h * 0.42; const a = (1 - y / (h * 0.42)) * 0.75 * R(); c.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`; c.beginPath(); c.arc(x, y, (R() * 1.1 + 0.35) * s + 0.2, 0, 6.283); c.fill(); }
    const sx = w * 0.68, sy = h * 0.64;
    glow(c, sx, sy, h * 0.6, 'rgba(255,205,150,0.55)', w, h);
    glow(c, sx, sy, h * 0.16, 'rgba(255,230,190,0.6)', w, h);
    c.fillStyle = 'rgba(255,240,210,0.96)'; c.beginPath(); c.arc(sx, sy, h * 0.032, 0, 6.283); c.fill();
    const layers = [['#9a7590', 0.6, 0.05], ['#6b5a84', 0.66, 0.065], ['#463f6c', 0.73, 0.08], ['#2c2a52', 0.81, 0.095], ['#17173a', 0.9, 0.11]];
    layers.forEach(([col, base, a], li) => {
      ridge(c, w, h, h * base, h * a, R, col);
      const mg = c.createLinearGradient(0, h * (base - a), 0, h * (base + 0.08));
      mg.addColorStop(0, 'rgba(255,190,160,0)'); mg.addColorStop(1, `rgba(255,185,160,${(0.12 - li * 0.02).toFixed(3)})`);
      c.fillStyle = mg; c.fillRect(0, h * (base - a), w, h * (a + 0.08));
    });
    grain(c, w, h, R, 0.035);
  } },
  { id: 'tide', name: 'Tide', tint: '#2f8c93', draw(c, w, h, R) {
    let g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#e2f5f1'); g.addColorStop(0.5, '#a3dad6'); g.addColorStop(1, '#4ea6b6');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    glow(c, w * 0.2, h * 0.18, h * 0.55, 'rgba(255,255,236,0.75)', w, h);
    const cols = ['rgba(255,255,255,0.38)', 'rgba(52,170,176,0.34)', 'rgba(22,120,148,0.44)', 'rgba(12,78,116,0.56)', 'rgba(8,50,86,0.74)'];
    cols.forEach((col, i) => {
      const base = h * (0.4 + i * 0.13), amp = h * (0.045 + R() * 0.04), f = 0.9 + R() * 1.3, ph = R() * 6;
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w + 8; x += 8) { const t = x / w; c.lineTo(x, base + amp * Math.sin(t * Math.PI * 2 * f + ph) + amp * 0.3 * Math.sin(t * Math.PI * 5.3 * f + ph * 2)); }
      c.lineTo(w, h); c.closePath(); c.fillStyle = col; c.fill();
    });
    grain(c, w, h, R, 0.03);
  } },
  { id: 'nebula', name: 'Nebula', tint: '#563a8a', draw(c, w, h, R) {
    c.fillStyle = '#06061a'; c.fillRect(0, 0, w, h);
    const m = Math.max(w, h);
    glow(c, w * 0.28, h * 0.38, m * 0.5, 'rgba(118,62,232,0.55)', w, h);
    glow(c, w * 0.64, h * 0.58, m * 0.42, 'rgba(230,74,150,0.36)', w, h);
    glow(c, w * 0.8, h * 0.22, m * 0.36, 'rgba(56,186,248,0.32)', w, h);
    glow(c, w * 0.46, h * 0.8, m * 0.42, 'rgba(96,104,240,0.38)', w, h);
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1100; i++) { const t = R(); const x = w * t; const y = h * (0.78 - t * 0.55) + (R() - 0.5) * h * 0.2 * Math.sin(t * Math.PI); c.fillStyle = `rgba(205,185,255,${(R() * 0.12).toFixed(3)})`; c.fillRect(x, y, 1.6, 1.6); }
    c.restore();
    const s = w / 1920 + 0.3;
    for (let i = 0; i < 560; i++) { const x = R() * w, y = R() * h, q = R(); const r = q > 0.985 ? 1.8 : q > 0.9 ? 1.1 : 0.6; c.fillStyle = `rgba(255,255,255,${(0.3 + R() * 0.7).toFixed(3)})`; c.beginPath(); c.arc(x, y, r * s, 0, 6.283); c.fill(); }
    for (let i = 0; i < 7; i++) { const x = R() * w, y = R() * h; const g = c.createRadialGradient(x, y, 0, x, y, 16 * s); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x - 20 * s, y - 20 * s, 40 * s, 40 * s); }
    grain(c, w, h, R, 0.03);
  } },
  { id: 'dawn', name: 'Dawn', tint: '#e0b5a6', draw(c, w, h, R) {
    c.fillStyle = '#f6ece6'; c.fillRect(0, 0, w, h);
    const m = Math.max(w, h);
    [['255,196,166', 0.15, 0.2, 0.62], ['200,184,255', 0.86, 0.14, 0.56], ['166,218,255', 0.72, 0.88, 0.6], ['255,212,230', 0.22, 0.92, 0.5], ['255,240,200', 0.5, 0.46, 0.42]]
      .forEach(([rgb, x, y, r]) => glow(c, w * x, h * y, m * r, `rgba(${rgb},0.95)`, w, h));
    grain(c, w, h, R, 0.03);
  } },
  { id: 'dunes', name: 'Dunes', tint: '#c7834a', draw(c, w, h, R) {
    let g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f8dcb4'); g.addColorStop(0.45, '#f2b47f'); g.addColorStop(1, '#e28954');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    glow(c, w * 0.3, h * 0.3, h * 0.4, 'rgba(255,248,226,0.7)', w, h);
    c.fillStyle = 'rgba(255,250,236,0.95)'; c.beginPath(); c.arc(w * 0.3, h * 0.3, h * 0.055, 0, 6.283); c.fill();
    ['#eaa66e', '#d98b56', '#c47344', '#a65a34', '#7b4026'].forEach((col, i) => {
      const base = h * (0.52 + i * 0.105), amp = h * (0.06 + R() * 0.035), f = 0.55 + R() * 0.8, ph = R() * 6;
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w + 6; x += 6) { const t = x / w; c.lineTo(x, base - amp * Math.pow(Math.abs(Math.sin(t * Math.PI * f + ph)), 0.8)); }
      c.lineTo(w, h); c.closePath();
      const lg = c.createLinearGradient(0, base - amp, 0, base + h * 0.12);
      lg.addColorStop(0, mixHex(col, '#ffffff', 0.18)); lg.addColorStop(1, col);
      c.fillStyle = lg; c.fill();
    });
    grain(c, w, h, R, 0.035);
  } },
  { id: 'grove', name: 'Grove', tint: '#2f6d52', draw(c, w, h, R) {
    let g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0e2a20'); g.addColorStop(1, '#1f4d38');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const s = w / 1920 + 0.2;
    for (let i = 0; i < 48; i++) {
      const x = R() * w, y = R() * h, r = (24 + R() * 110) * s, a = 0.05 + R() * 0.15;
      const hue = R() > 0.5 ? '190,255,172' : '255,236,172';
      const gg = c.createRadialGradient(x, y, 0, x, y, r);
      gg.addColorStop(0, `rgba(${hue},${a.toFixed(3)})`); gg.addColorStop(0.7, `rgba(${hue},${(a * 0.6).toFixed(3)})`); gg.addColorStop(1, `rgba(${hue},0)`);
      c.fillStyle = gg; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
    }
    const v = c.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = v; c.fillRect(0, 0, w, h);
    grain(c, w, h, R, 0.03);
  } },
  { id: 'slate', name: 'Slate', tint: '#3c424d', draw(c, w, h, R) {
    let g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#2c313a'); g.addColorStop(0.6, '#1b1e25'); g.addColorStop(1, '#111318');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const l = c.createLinearGradient(w * 0.2, 0, w * 0.8, h);
    l.addColorStop(0, 'rgba(255,255,255,0)'); l.addColorStop(0.5, 'rgba(255,255,255,0.06)'); l.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = l; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(255,255,255,0.04)'; c.lineWidth = Math.max(1, w / 1600);
    for (let r = h * 0.18; r < Math.max(w, h) * 1.3; r += h * 0.055) { c.beginPath(); c.arc(w * 0.86, h * 1.05, r, 0, 6.283); c.stroke(); }
    grain(c, w, h, R, 0.03);
  } },
  { id: 'paper', name: 'Paper', tint: '#cfc7ba', draw(c, w, h, R) {
    let g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f0ece5'); g.addColorStop(1, '#ddd6cb');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    glow(c, w * 0.3, h * 0.25, Math.max(w, h) * 0.7, 'rgba(255,255,255,0.55)', w, h);
    grain(c, w, h, R, 0.045);
  } },
];
const wallCache = new Map();
function renderWall(id, w, hgt, q = 0.9) {
  const def = WALLS.find((x) => x.id === id) || WALLS[0];
  const key = def.id + ':' + w + 'x' + hgt + ':' + q;
  if (wallCache.has(key)) return wallCache.get(key);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
  const ctx = cv.getContext('2d');
  def.draw(ctx, w, hgt, rng(hashStr(def.id)));
  const url = cv.toDataURL('image/jpeg', q);
  wallCache.set(key, url);
  return url;
}
function wallSize() {
  const os = document.getElementById('os');
  const W = os.clientWidth || innerWidth, H = os.clientHeight || innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(clamp(W * dpr, 1280, 2560));
  return { w, h: Math.round(w * (H / W)) };
}
const wallThumb = (id) => renderWall(id, 240, 135, 0.82);
function wallName(id) {
  if (String(id).startsWith('file:')) return FS.get(String(id).slice(5))?.name || 'Your picture';
  return (WALLS.find((w) => w.id === id) || WALLS[0]).name;
}
function averageTint(dataURL, cb) {
  const img = new Image();
  img.onload = () => {
    try {
      const cv = document.createElement('canvas'); cv.width = cv.height = 8;
      const x = cv.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
      const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      cb(rgbToHex(r / 64, g / 64, b / 64));
    } catch { cb(null); }
  };
  img.onerror = () => cb(null);
  img.src = dataURL;
}
let currentWallURL = '';
let slideTimer = 0, slideIdx = -1;
// Settings > Personalization > Background: a picture (with a fit), a solid color, or a slideshow
function slideList() {
  if (S.data.slideSource === 'pictures') {
    const pics = Object.values(FS.nodes).filter((x) => x.kind === 'image' && !FS.inTrash(x.id)).map((n) => 'file:' + n.id);
    if (pics.length) return pics;
  }
  return WALLS.map((w) => w.id);
}
function solidURL(color) {
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 9;
  const c = cv.getContext('2d'); c.fillStyle = color; c.fillRect(0, 0, 16, 9);
  return cv.toDataURL('image/png');
}
function applyWallpaper() {
  const root = document.documentElement.style;
  const wall = document.getElementById('wall');
  clearTimeout(slideTimer);
  const fitted = S.data.wallMode !== 'solid' && String(S.data.wallMode === 'slideshow' ? '' : S.data.wallpaper).startsWith('file:');
  wall.style.backgroundSize = fitted ? ({ fit: 'contain', stretch: '100% 100%', tile: 'auto', center: 'auto' }[S.data.wallFit] || 'cover') : 'cover';
  wall.style.backgroundRepeat = fitted && S.data.wallFit === 'tile' ? 'repeat' : 'no-repeat';
  wall.style.backgroundColor = S.data.wallColor || '#0063b1';
  if (S.data.wallMode === 'solid') {
    const c = /^#[0-9a-f]{6}$/i.test(S.data.wallColor || '') ? S.data.wallColor : '#0063b1';
    setWallURL(solidURL(c)); root.setProperty('--wall-tint', c); afterTint();
    return;
  }
  let id = S.data.wallpaper || 'ridgeline';
  if (S.data.wallMode === 'slideshow') {
    const list = slideList();
    slideIdx = S.data.slideShuffle ? Math.floor(Math.random() * list.length) : (slideIdx + 1) % list.length;
    id = list[slideIdx] || id;
    slideTimer = setTimeout(applyWallpaper, clamp(+S.data.slideEvery || 30, 1, 1440) * 60000);
  }
  showWall(id);
}
function showWall(id) {
  const root = document.documentElement.style;
  if (String(id).startsWith('file:')) {
    const fid = id.slice(5); const n = FS.get(fid);
    const data = n && !FS.inTrash(fid) ? FS.read(fid) : '';
    if (data.startsWith('data:image')) {
      setWallURL(data);
      averageTint(data, (t) => { if (t && currentWallURL === data) { root.setProperty('--wall-tint', t); afterTint(); } });
      return;
    }
  }
  const def = WALLS.find((w) => w.id === id) || WALLS[0];
  const { w, h: hh } = wallSize();
  setWallURL(renderWall(def.id, w, hh));
  root.setProperty('--wall-tint', def.tint);
  afterTint();
}
function afterTint() { if (typeof autoAccent === 'function') autoAccent(); }
function setWallURL(url) {
  currentWallURL = url;
  document.getElementById('wall').style.backgroundImage = `url("${url}")`;
  if (!S.data.lockWall) $$('.screen.lock').forEach((el) => { el.style.backgroundImage = `url("${url}")`; });
}
/* Downscale an image file (from the viewer's computer) into a data URL */
function fileToImageURL(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read the file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image this browser can open'));
      img.onload = () => {
        const sc = Math.min(1, maxSide / Math.max(img.width, img.height));
        const cw = Math.max(1, Math.round(img.width * sc)), ch = Math.max(1, Math.round(img.height * sc));
        const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
        const x = cv.getContext('2d');
        const png = /png|gif|webp|svg/i.test(file.type);
        if (!png) { x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); }
        x.drawImage(img, 0, 0, cw, ch);
        let url = png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.86);
        if (url.length > 1400000) url = cv.toDataURL('image/jpeg', 0.8);
        resolve(url);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
