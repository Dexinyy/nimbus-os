'use strict';
/* ========== Small utilities ========== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const motionOff = () => document.documentElement.hasAttribute('data-reduce-motion') || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const caps = { db: null, user: null, sample: null, downloads: null, tools: false, maxTools: 0 };

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function frag(str) { const t = document.createElement('template'); t.innerHTML = str.trim(); return t.content.firstElementChild; }

/* ========== Event bus ========== */
const bus = {
  m: new Map(),
  on(e, f) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e).add(f); return () => this.m.get(e)?.delete(f); },
  emit(e, d) { const s = this.m.get(e); if (!s) return; for (const f of [...s]) { try { f(d); } catch (err) { console.error(err); } } },
};

/* ========== Color helpers ========== */
function hexToRgb(hex) {
  let x = String(hex).replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
function mixHex(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* ========== Formatting ========== */
function fmtBytes(n) {
  n = n || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  if (n < 1099511627776) return (n / 1073741824).toFixed(1) + ' GB';
  return (n / 1099511627776).toFixed(2) + ' TB';
}
const fmtDT = (ts, o) => new Intl.DateTimeFormat(undefined, o).format(new Date(ts));
const fmtDate = (ts) => fmtDT(ts, { dateStyle: 'medium', timeStyle: 'short' });
function relTime(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 45) return 'Just now';
  if (d < 3600) return Math.round(d / 60) + ' min ago';
  if (d < 86400) { const x = Math.round(d / 3600); return x + (x === 1 ? ' hour ago' : ' hours ago'); }
  if (d < 86400 * 7) { const x = Math.round(d / 86400); return x + (x === 1 ? ' day ago' : ' days ago'); }
  return fmtDT(ts, { dateStyle: 'medium' });
}
function fmtNum(v) {
  if (!isFinite(v)) return String(v);
  const r = parseFloat(Number(v).toPrecision(14));
  if (r !== 0 && (Math.abs(r) >= 1e16 || Math.abs(r) < 1e-10)) return r.toExponential(8).replace(/\.?0+e/, 'e');
  return r.toLocaleString(undefined, { maximumFractionDigits: 12 });
}
function fmtDuration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0');
}
function hashStr(s) { let h1 = 2166136261; for (let i = 0; i < s.length; i++) { h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 16777619); } return h1 >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ========== Safe math (no eval) ========== */
function evalMath(src) {
  const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '').replace(/\s+/g, '').replace(/^=/, '').toLowerCase();
  if (!s || !/^[\d.+\-*/%^()epi]+$/.test(s)) throw new Error('Not a math expression');
  let i = 0;
  const peek = () => s[i];
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const op = s[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const term = () => { let v = unary(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = s[i++]; const r = unary(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; };
  const unary = () => { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); };
  const power = () => { const b = atom(); if (peek() === '^') { i++; return Math.pow(b, unary()); } return b; };
  const atom = () => {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('Missing )'); i++; return v; }
    if (s.startsWith('pi', i)) { i += 2; return Math.PI; }
    const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/.exec(s.slice(i));
    if (!m) throw new Error('Expected a number');
    i += m[0].length; return parseFloat(m[0]);
  };
  const v = expr();
  if (i !== s.length) throw new Error('Unexpected input');
  if (!isFinite(v)) throw new Error('Result is not a number');
  return v;
}

/* ========== Icons ========== */
function gearPath(cx, cy, ro, ri, n, tooth = 0.5) {
  const pts = [], step = (Math.PI * 2) / n;
  for (let k = 0; k < n; k++) {
    const a = k * step - Math.PI / 2, t1 = (step * tooth) / 2, t2 = t1 + step * 0.11;
    pts.push([a - t2, ri], [a - t1, ro], [a + t1, ro], [a + t2, ri]);
  }
  return 'M' + pts.map(([a, r]) => (cx + r * Math.cos(a)).toFixed(2) + ' ' + (cy + r * Math.sin(a)).toFixed(2)).join('L') + 'Z';
}
const UI_ICONS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  min: '<path d="M6 12h12"/>',
  max: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  restore: '<rect x="6" y="9" width="9" height="9" rx="1.8"/><path d="M9 6h7.2A1.8 1.8 0 0 1 18 7.8V15"/>',
  chevL: '<path d="M14.5 5.5L8 12l6.5 6.5"/>', chevR: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  chevU: '<path d="M5.5 14.5L12 8l6.5 6.5"/>', chevD: '<path d="M5.5 9.5L12 16l6.5-6.5"/>',
  arrowL: '<path d="M19 12H5.5M11 6l-6 6 6 6"/>', arrowR: '<path d="M5 12h13.5M13 6l6 6-6 6"/>', arrowUp: '<path d="M12 19V5.5M6 11l6-6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l1 12.7h9l1-12.7M10 11v5.5M14 11v5.5"/>',
  pencil: '<path d="M4.5 19.5l1-4.2L15.8 5a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.7 18.5z"/><path d="M13.8 7l3.2 3.2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.6"/><circle cx="17.5" cy="17.5" r="2.6"/><path d="M8.4 15.6L17.5 4M15.6 15.6L6.5 4"/>',
  paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5M9 11h6M9 15h4"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  wifi: '<path d="M2.8 9.2a13.5 13.5 0 0 1 18.4 0M5.9 12.6a9 9 0 0 1 12.2 0M9 16a4.5 4.5 0 0 1 6 0M12 19.3h.01"/>',
  airplane: '<path d="M10.5 13.5L4 15.5v-2l6.5-4.2V4.8a1.5 1.5 0 0 1 3 0v4.5L20 13.5v2l-6.5-2v4.2l2.2 1.6v1.6L12 19.8l-3.7 1.1v-1.6l2.2-1.6z"/>',
  ethernet: '<rect x="4" y="4.5" width="16" height="11" rx="2"/><path d="M8.5 8.5v3M12 8.5v3M15.5 8.5v3M12 15.5v4M8 19.5h8"/>',
  wifiOff: '<path d="M2.8 9.2a13.5 13.5 0 0 1 18.4 0M5.9 12.6a9 9 0 0 1 12.2 0M9 16a4.5 4.5 0 0 1 6 0M12 19.3h.01M3.5 3.5l17 17"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  power: '<path d="M12 3.5v8"/><path d="M7.1 6.6a7.5 7.5 0 1 0 9.8 0"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M6 16.5V11a6 6 0 0 1 9.4-4.9M18 11v5.5l1.5 2H8.5M10 20.5a2 2 0 0 0 4 0M3.5 3.5l17 17"/>',
  leaf: '<path d="M5 19.5c0-8.5 5.5-14 14.5-14.5 0 9.5-5.5 14.5-14 14.5z"/><path d="M5 19.5l7.5-7.5"/>',
  textSize: '<path d="M3.5 18.5L8.5 6l5 12.5M5.3 14h6.4M14.5 18.5l3-7.5 3 7.5M15.4 16.3h4.2"/>',
  sunset: '<path d="M3.5 18.5h17M7 15a5 5 0 0 1 10 0M12 4v3.5M5.2 8.2l1.6 1.6M18.8 8.2l-1.6 1.6"/>',
  settings: '<path d="' + gearPath(12, 12, 9, 7, 8, 0.48) + '"/><circle cx="12" cy="12" r="2.8"/>',
  pin: '<path d="M9 3.8h6l-1.2 5.4 3.4 3.3v1.9H6.8v-1.9l3.4-3.3z"/><path d="M12 14.4v5.8"/>',
  unpin: '<path d="M9 3.8h6l-1.2 5.4 3.4 3.3v1.9H6.8v-1.9l3.4-3.3z"/><path d="M12 14.4v5.8M3.5 3.5l17 17"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2M12 7.8h.01"/>',
  warning: '<path d="M10.3 4.6 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z"/><path d="M12 10v4M12 17.2h.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  flag: '<path d="M6 21V4M6 4.5h11l-2.5 4 2.5 4H6"/>',
  home: '<path d="M4 11l8-7 8 7v8.5a1 1 0 0 1-1 1h-4.5V15h-5v5.5H5a1 1 0 0 1-1-1z"/>',
  desktop: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>',
  doc: '<path d="M7 3.5h7l4 4v13H7z"/><path d="M14 3.5v4h4M10 12h5M10 15.5h5"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="M4 17.5l5-4.5 3.5 3 3-2.5 4.5 4"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.7l2 2h7.3a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3.5 17.5V7.5a2 2 0 0 1 2-2h3.7l2 2h6.3a2 2 0 0 1 2 2v1"/><path d="M3.5 17.5l2.2-6a1.5 1.5 0 0 1 1.4-1h13.2a1 1 0 0 1 .9 1.4l-2.4 5.6a1.5 1.5 0 0 1-1.4 1H4.5z"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
  sparkle: '<path d="M11 3.5l1.9 5.6 5.6 1.9-5.6 1.9L11 18.5l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01"/>',
  palette: '<path d="M12 3.5c-4.9 0-8.5 3.5-8.5 8 0 4.3 3.3 8.5 7.6 8.5 1.2 0 1.8-.7 1.8-1.6 0-1.1-.8-1.4-.8-2.4 0-.9.7-1.5 1.6-1.5h2.2c3 0 5.6-2 5.6-4.9 0-3.6-4.1-6.1-9.5-6.1z"/><path d="M7.8 11h.01M10.5 7.5h.01M15 7.8h.01"/>',
  brush: '<path d="M18.5 3.5l2 2-9 9.5-2.5-2.5z"/><path d="M9 12.5c-2.6 0-4 1.5-4 4 0 1.4-.6 2.4-1.5 3 3.8 1 8 .2 8-4.5"/>',
  eraser: '<path d="M8.5 20h11.5M5.4 14.6l8-8a2 2 0 0 1 2.8 0l2.7 2.7a2 2 0 0 1 0 2.8L11.7 19.3H8.9l-3.5-3.5a.85.85 0 0 1 0-1.2z"/><path d="M9.5 10.5l5 5"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4.5" y="6.5" width="15" height="11" rx="1.2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  bucket: '<path d="M4.4 11.2L11 4.6l7 7-6.6 6.6a1.6 1.6 0 0 1-2.2 0l-4.8-4.8a1.6 1.6 0 0 1 0-2.2zM4.5 11.5h13"/><path d="M20 15s-1.6 2.1-1.6 3.1a1.6 1.6 0 0 0 3.2 0c0-1-1.6-3.1-1.6-3.1zM8.5 3l3 3"/>',
  picker: '<path d="M14.5 4.8a2.5 2.5 0 0 1 3.5 0l1.2 1.2a2.5 2.5 0 0 1 0 3.5l-1.7 1.7-4.7-4.7z"/><path d="M12.8 6.5l4.7 4.7-8.3 8.3H4.5v-4.7z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H12"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H12"/>',
  save: '<path d="M5 4h11.3L20 7.7V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  person: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  apps: '<rect x="4" y="4" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="4" width="4.5" height="4.5" rx="1"/><rect x="15.5" y="4" width="4.5" height="4.5" rx="1"/><rect x="4" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="15.5" y="9.75" width="4.5" height="4.5" rx="1"/><rect x="4" y="15.5" width="4.5" height="4.5" rx="1"/><rect x="9.75" y="15.5" width="4.5" height="4.5" rx="1"/><rect x="15.5" y="15.5" width="4.5" height="4.5" rx="1"/>',
  taskview: '<rect x="3.5" y="5.5" width="11.5" height="9.5" rx="1.8"/><path d="M18 8.5h.7a1.8 1.8 0 0 1 1.8 1.8v6.4a1.8 1.8 0 0 1-1.8 1.8H8.8A1.8 1.8 0 0 1 7 16.7V18"/>',
  layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M12 4.5v15M12 12h8.5"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-8A6 6 0 0 0 6.6 9.2 4.7 4.7 0 0 0 7 18.5z"/>',
  cloudOff: '<path d="M7 18.5h10.5M19.9 15.6a4 4 0 0 0-1.8-5.1A6 6 0 0 0 9.4 5.8M6.3 9.4A4.7 4.7 0 0 0 7 18.5M3.5 3.5l17 17"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.2 1.5M10 3h4M12 3v3.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.4 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.4-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12h.01"/>',
  send: '<path d="M4.5 12L20 4.5 15.5 20l-3.3-6.8z"/><path d="M12.2 13.2L20 4.5"/>',
  newchat: '<path d="M12 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12"/><path d="M17.8 3.7a1.8 1.8 0 0 1 2.5 2.5L13 13.5l-3.3.8.8-3.3z"/>',
  external: '<path d="M13.5 4.5h6v6M19.5 4.5L11 13M17 14v4.5a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1H10"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5M11 8.5v5"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8.5 11h5"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  rotate: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4"/>',
  hdd: '<rect x="3.5" y="12" width="17" height="7" rx="2"/><path d="M5 12l2.3-6.2A1.5 1.5 0 0 1 8.7 4.8h6.6a1.5 1.5 0 0 1 1.4 1L19 12M16.5 15.5h.01"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1.6"/><path d="M9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5"/>',
  activity: '<path d="M3.5 12h4l2.5-6 4 12 2.5-6h4"/>',
  bolt: '<path d="M13 3L6 13.5h5L10 21l8-11h-5z"/>',
  access: '<circle cx="12" cy="4.9" r="1.7"/><path d="M5 8.6l7 1.6 7-1.6M12 10.2v4.6M12 14.8l-3 6M12 14.8l3 6"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  app: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  sliders: '<path d="M5 6h9M18 6h1M5 12h2M11 12h8M5 18h7M16 18h3"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="14" cy="18" r="2"/>',
};
function ui(name, cls) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${UI_ICONS[name] || UI_ICONS.app}</svg>`;
}

const SVG_DEFS = `<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>
<linearGradient id="g-fold-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0b43c"/><stop offset="1" stop-color="#d38a15"/></linearGradient>
<linearGradient id="g-fold-f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffdb75"/><stop offset="1" stop-color="#f5b73c"/></linearGradient>
<linearGradient id="g-paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e5e9f1"/></linearGradient>
<linearGradient id="g-blue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#62a6ff"/><stop offset="1" stop-color="#2f5fe0"/></linearGradient>
<linearGradient id="g-slate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#434b61"/><stop offset="1" stop-color="#22262f"/></linearGradient>
<linearGradient id="g-gear" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b3bccc"/><stop offset="1" stop-color="#5c6780"/></linearGradient>
<linearGradient id="g-term" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2e3446"/><stop offset="1" stop-color="#141824"/></linearGradient>
<linearGradient id="g-pal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff5e6"/><stop offset="1" stop-color="#efcf9f"/></linearGradient>
<linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fa9ff"/><stop offset="1" stop-color="#a9ddff"/></linearGradient>
<linearGradient id="g-teal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fd6c0"/><stop offset="1" stop-color="#0d7a8a"/></linearGradient>
<linearGradient id="g-mine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dde2ec"/><stop offset="1" stop-color="#aab3c4"/></linearGradient>
<linearGradient id="g-clock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f80ff"/><stop offset="1" stop-color="#4a3dd4"/></linearGradient>
<linearGradient id="g-spark" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8db0"/><stop offset=".5" stop-color="#a47dff"/><stop offset="1" stop-color="#4c8dff"/></linearGradient>
<linearGradient id="g-bin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef4fc"/><stop offset="1" stop-color="#b8c7dd"/></linearGradient>
<linearGradient id="g-screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ab6ff"/><stop offset="1" stop-color="#3a50d6"/></linearGradient>
<linearGradient id="g-logo" x1=".2" y1=".08" x2=".8" y2=".95"><stop offset="0" style="stop-color:var(--accent-hi)"/><stop offset=".55" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-lo)"/></linearGradient>
<linearGradient id="g-ring" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--accent-hi)"/><stop offset="1" style="stop-color:var(--accent)"/></linearGradient>
<linearGradient id="g-web" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa9ff"/><stop offset="1" stop-color="#2347c9"/></linearGradient>
<clipPath id="c-photo"><rect x="5" y="8" width="38" height="32" rx="7"/></clipPath>
</defs></svg>`;

const PAGE = 'M12 4h16l10 10v26a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z';
const FOLD_B = '<path d="M5 14a4 4 0 0 1 4-4h9.6a4 4 0 0 1 2.8 1.2L24.2 14H39a4 4 0 0 1 4 4v17a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="url(#g-fold-b)"/>';
const FOLD_F = '<path d="M5 20a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v15a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="url(#g-fold-f)"/><path d="M9 16.6h30" stroke="#fff" stroke-opacity=".55" stroke-width="1.1"/>';
const calcKeys = (() => { let s = ''; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s += `<rect x="${12.5 + c * 8.25}" y="${22 + r * 7}" width="6.5" height="5" rx="1.6" fill="${r === 2 && c === 2 ? '#ff9d42' : '#5b647b'}"/>`; return s; })();
const APP_ICONS = {
  logo: '<g transform="rotate(-22 24 24)"><ellipse cx="24" cy="24" rx="21" ry="7" fill="none" stroke="url(#g-ring)" stroke-width="2.6" opacity=".6"/></g><circle cx="24" cy="24" r="12.6" fill="url(#g-logo)"/><circle cx="19.6" cy="19.2" r="4.6" fill="#fff" opacity=".26"/><g transform="rotate(-22 24 24)"><path d="M3 24A21 7 0 0 0 45 24" fill="none" stroke="url(#g-ring)" stroke-width="2.6" stroke-linecap="round"/></g>',
  files: FOLD_B + FOLD_F,
  folder: FOLD_B + FOLD_F,
  folderDesktop: FOLD_B + FOLD_F + '<rect x="17.5" y="22" width="13" height="9" rx="1.6" fill="none" stroke="#fff" stroke-width="2"/><path d="M21 34.6h6" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
  folderDocs: FOLD_B + FOLD_F + '<path d="M20 21.5h5.8l3.7 3.7V34a1.2 1.2 0 0 1-1.2 1.2H20a1.2 1.2 0 0 1-1.2-1.2V22.7a1.2 1.2 0 0 1 1.2-1.2z" fill="#fff" opacity=".93"/>',
  folderPics: FOLD_B + FOLD_F + '<rect x="16.5" y="22" width="15" height="11.5" rx="2" fill="#fff" opacity=".93"/><path d="M17.5 32.4l4.2-4.2 3 3 2.2-2.1 3.6 3.3" fill="none" stroke="#e79a1f" stroke-width="1.7" stroke-linejoin="round"/>',
  folderDl: FOLD_B + FOLD_F + '<path d="M24 21.5v9.5M19.6 26.8l4.4 4.4 4.4-4.4M18 35h12" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  notes: '<rect x="9" y="5" width="30" height="38" rx="5" fill="url(#g-paper)" stroke="#c8d0de"/><path d="M9 10a5 5 0 0 1 5-5h20a5 5 0 0 1 5 5v4H9z" fill="url(#g-blue)"/><rect x="15" y="20" width="18" height="2.6" rx="1.3" fill="#8f9bb3"/><rect x="15" y="26" width="18" height="2.6" rx="1.3" fill="#adb7ca"/><rect x="15" y="32" width="11" height="2.6" rx="1.3" fill="#adb7ca"/>',
  calculator: '<rect x="8" y="4" width="32" height="40" rx="7" fill="url(#g-slate)"/><rect x="12.5" y="9" width="23" height="9" rx="2.5" fill="#8fe6c5"/>' + calcKeys,
  settings: `<path d="${gearPath(24, 24, 19.5, 15.5, 9, 0.52)}" fill="url(#g-gear)"/><circle cx="24" cy="24" r="7.4" fill="#eef1f6"/><circle cx="24" cy="24" r="7.4" fill="none" stroke="#4d5870" stroke-opacity=".35"/>`,
  terminal: '<rect x="4" y="7" width="40" height="34" rx="7" fill="url(#g-term)"/><path d="M13 19.5l6.5 5.5L13 30.5" fill="none" stroke="#5ef0a8" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="23" y="28.5" width="12" height="3.2" rx="1.6" fill="#d7dded"/>',
  paint: '<path d="M24 5C13.2 5 5 12.9 5 23.1 5 33 12.6 42 21.9 42c2.6 0 3.9-1.6 3.9-3.6 0-2.4-1.7-2.9-1.7-5 0-1.8 1.5-3.2 3.3-3.2h4.4C38.5 30.2 43 25.6 43 19.6 43 11.3 34.6 5 24 5z" fill="url(#g-pal)" stroke="#d9b887" stroke-width=".8"/><circle cx="14.5" cy="22" r="3.7" fill="#ef4444"/><circle cx="20" cy="13.8" r="3.7" fill="#f59e0b"/><circle cx="29.5" cy="13.2" r="3.7" fill="#22c55e"/><circle cx="35.5" cy="20.5" r="3.7" fill="#3b82f6"/>',
  photos: '<g clip-path="url(#c-photo)"><rect x="5" y="8" width="38" height="32" fill="url(#g-sky)"/><circle cx="33" cy="17" r="4" fill="#fff7c9"/><path d="M14 41L29.5 22.5 47 41z" fill="#43b07f"/><path d="M1 41l14-15.5L29 41z" fill="#1f8a5c"/></g>',
  taskmgr: '<rect x="5" y="6" width="38" height="36" rx="7" fill="url(#g-teal)"/><path d="M11 30h5.5l4-9 6 14 4-8H37" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  mines: '<rect x="5" y="5" width="38" height="38" rx="8" fill="url(#g-mine)"/><path d="M18 36V12" stroke="#3b4255" stroke-width="2.6" stroke-linecap="round"/><path d="M19 12.5l14 5.5-14 5.5z" fill="#ef4444"/><rect x="12.5" y="34" width="15" height="3.6" rx="1.8" fill="#3b4255"/>',
  clock: '<circle cx="24" cy="24" r="19" fill="url(#g-clock)"/><circle cx="24" cy="24" r="14.5" fill="#fff"/><path d="M24 14v10l6.5 4" fill="none" stroke="#3a31b5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="2" fill="#3a31b5"/>',
  assistant: '<path d="M14 6H34A6 6 0 0 1 40 12V26A6 6 0 0 1 34 32H22L14 39V32A6 6 0 0 1 8 26V12A6 6 0 0 1 14 6Z" fill="url(#g-spark)"/><path d="M24 11.2l1.9 5.1 5.1 1.9-5.1 1.9L24 25.2l-1.9-5.1-5.1-1.9 5.1-1.9z" fill="#fff"/>',
  trash: '<path d="M12 15h24l-2.2 24.2A3.5 3.5 0 0 1 30.3 42.5H17.7a3.5 3.5 0 0 1-3.5-3.3z" fill="url(#g-bin)" stroke="#8fa1bd"/><rect x="9" y="10" width="30" height="5" rx="2.5" fill="#9cadc6"/><path d="M20 10V8.5A2.5 2.5 0 0 1 22.5 6h3A2.5 2.5 0 0 1 28 8.5V10" fill="none" stroke="#9cadc6" stroke-width="2"/><path d="M20 20v17M24 20v17M28 20v17" stroke="#8fa1bd" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>',
  trashFull: '<path d="M15 21l7-4 5 3 6-2v20H15z" fill="#f4cf6a"/><path d="M17 26l13-3v14H17z" fill="#7fb5ff"/><path d="M12 15h24l-2.2 24.2A3.5 3.5 0 0 1 30.3 42.5H17.7a3.5 3.5 0 0 1-3.5-3.3z" fill="url(#g-bin)" fill-opacity=".72" stroke="#8fa1bd"/><rect x="9" y="10" width="30" height="5" rx="2.5" fill="#9cadc6"/><path d="M20 10V8.5A2.5 2.5 0 0 1 22.5 6h3A2.5 2.5 0 0 1 28 8.5V10" fill="none" stroke="#9cadc6" stroke-width="2"/>',
  pc: '<rect x="4" y="7" width="40" height="27" rx="4" fill="#2a3040"/><rect x="6.5" y="9.5" width="35" height="22" rx="2" fill="url(#g-screen)"/><path d="M6.5 25l9-7 7 5 6-4 12.5 9v1.5a2 2 0 0 1-2 2h-30.5a2 2 0 0 1-2-2z" fill="#fff" opacity=".18"/><path d="M18 40h12M24 34v6" stroke="#5a6378" stroke-width="3" stroke-linecap="round"/>',
  fileText: `<path d="${PAGE}" fill="url(#g-paper)" stroke="#c3cbda"/><path d="M28 4v8a2 2 0 0 0 2 2h8" fill="#dde3ed" stroke="#c3cbda"/><rect x="14" y="21" width="18" height="2.4" rx="1.2" fill="#8d9ab3"/><rect x="14" y="27" width="18" height="2.4" rx="1.2" fill="#a9b4c8"/><rect x="14" y="33" width="12" height="2.4" rx="1.2" fill="#a9b4c8"/>`,
  fileImage: `<path d="${PAGE}" fill="url(#g-paper)" stroke="#c3cbda"/><path d="M28 4v8a2 2 0 0 0 2 2h8" fill="#dde3ed" stroke="#c3cbda"/><rect x="13" y="20" width="22" height="17" rx="2.5" fill="#7cc2ff"/><path d="M13 37l7.5-9 5.5 6 3-3 6 6z" fill="#2e9e6a"/><circle cx="29.5" cy="25" r="2.3" fill="#fff6c4"/>`,
  welcome: '',
};
// A web browser before Chrome is installed (then Chrome's own icon is used), and other programs
APP_ICONS.browser = '<circle cx="24" cy="24" r="19" fill="url(#g-web)"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-opacity=".92"><ellipse cx="24" cy="24" rx="8.2" ry="19"/><path d="M5.5 24h37M8.6 14.5h30.8M8.6 33.5h30.8"/></g>';
APP_ICONS.app = '<rect x="5" y="8" width="38" height="32" rx="6" fill="url(#g-slate)"/><path d="M5 14a6 6 0 0 1 6-6h26a6 6 0 0 1 6 6v2H5z" fill="#fff" fill-opacity=".2"/><circle cx="11" cy="12" r="1.5" fill="#fff"/><circle cx="15.5" cy="12" r="1.5" fill="#fff"/><rect x="11" y="21" width="26" height="3" rx="1.5" fill="#fff" fill-opacity=".7"/><rect x="11" y="28" width="17" height="3" rx="1.5" fill="#fff" fill-opacity=".45"/>';
APP_ICONS.welcome = '<rect x="5" y="5" width="38" height="38" rx="10" fill="url(#g-logo)"/><path d="M24 12.5l3.3 6.9 7.5 1-5.5 5.2 1.4 7.5L24 29.5l-6.7 3.6 1.4-7.5-5.5-5.2 7.5-1z" fill="#fff"/>';
// name: an icon below, or a picture (a program's own icon, as a data: URL)
function appIcon(name) {
  if (typeof name === 'string' && /^data:image\//.test(name)) return `<svg viewBox="0 0 48 48" aria-hidden="true"><image href="${esc(name)}" x="3" y="3" width="42" height="42"/></svg>`;
  return `<svg viewBox="0 0 48 48" aria-hidden="true">${APP_ICONS[name] || APP_ICONS.files}</svg>`;
}

/* ========== Settings ========== */
const DEFAULTS = {
  osName: 'Nimbus', userName: '', deviceName: 'My PC',
  theme: 'auto', accent: '#4a74f5', wallpaper: 'ridgeline',
  transparency: true, energySaver: false, reduceMotion: false, textSize: 14,
  tbAlign: 'center', tbPos: 'bottom', tbFloat: true, tbSearch: true, tbTaskView: true,
  pinned: ['chrome', 'files', 'notes', 'terminal', 'paint', 'settings'],
  startPins: ['chrome', 'files', 'notes', 'calculator', 'settings', 'terminal', 'paint', 'photos', 'clock', 'mines', 'taskmgr', 'assistant', 'welcome'],
  brightness: 100, nightLight: false, nightStrength: 45,
  volume: 60, sounds: true, dnd: false,
  clockSeconds: false, clock24: null, lockOnStart: false, showDesktopIcons: true, chromePinned: false,
  iconPos: {}, recent: [], filesView: 'grid', minesBest: {},
  worldClocks: ['America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'],
  focusDnd: true, assistantMode: 'quick', setupDone: false, updatedAt: 0,
};
const S = {
  data: JSON.parse(JSON.stringify(DEFAULTS)),
  load(obj) { this.data = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), obj || {}); },
  set(k, v) {
    const old = this.data[k];
    if (old === v && (typeof v !== 'object' || v === null)) return;
    this.data[k] = v;
    this.changed([k]);
  },
  patch(obj) {
    const ks = [];
    for (const k in obj) { if (this.data[k] !== obj[k] || (typeof obj[k] === 'object' && obj[k] !== null)) { this.data[k] = obj[k]; ks.push(k); } }
    if (ks.length) this.changed(ks);
  },
  changed(keys) {
    this.data.updatedAt = Date.now();
    Store.markUser();
    Store.saveSettings();
    for (const k of keys) applySetting(k);
    bus.emit('settings', keys);
  },
};
const APPLY = {};
function applySetting(k) { const f = APPLY[k]; if (f) { try { f(); } catch (e) { console.error(e); } } }
const osTitle = () => { const n = (S.data.osName || 'Nimbus').trim() || 'Nimbus'; return /\bos$/i.test(n) ? n : n + ' OS'; };
const osName = () => (S.data.osName || 'Nimbus').trim() || 'Nimbus';
const userName = () => (S.data.userName || '').trim();
const initials = () => { const n = userName(); return n ? n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : ''; };
function avatarHTML() { const i = initials(); return i ? esc(i) : ui('person'); }

/* ========== System sounds (Web Audio, no files) ========== */
const Sound = (() => {
  let ctx = null, master = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination);
    } catch { ctx = null; }
    return ctx;
  }
  function tone(freq, start, dur, type = 'sine', peak = 0.3) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(master); o.start(start); o.stop(start + dur + 0.05);
  }
  const LIB = {
    startup: (t) => { [[523.25, 0], [659.25, 0.1], [783.99, 0.2], [1046.5, 0.34]].forEach(([f, d]) => tone(f, t + d, 1.5, 'sine', 0.2)); tone(261.63, t, 1.8, 'triangle', 0.07); },
    shutdown: (t) => { [[783.99, 0], [659.25, 0.13], [523.25, 0.26]].forEach(([f, d]) => tone(f, t + d, 1, 'sine', 0.18)); },
    notify: (t) => { tone(987.77, t, 0.28, 'sine', 0.22); tone(1318.5, t + 0.09, 0.4, 'sine', 0.18); },
    error: (t) => { tone(233, t, 0.2, 'triangle', 0.22); tone(196, t + 0.1, 0.26, 'triangle', 0.2); },
    tick: (t) => tone(1400, t, 0.05, 'sine', 0.12),
    unlock: (t) => { tone(659.25, t, 0.25, 'sine', 0.18); tone(987.77, t + 0.08, 0.4, 'sine', 0.16); },
    trash: (t) => { tone(440, t, 0.1, 'triangle', 0.14); tone(311, t + 0.05, 0.14, 'triangle', 0.12); },
    alarm: (t) => { for (let k = 0; k < 3; k++) { tone(880, t + k * 0.45, 0.2, 'sine', 0.28); tone(1174.66, t + k * 0.45 + 0.1, 0.26, 'sine', 0.24); } },
  };
  return {
    unlock() { ensure(); },
    play(name) {
      if (!S.data.sounds || S.data.volume <= 0) return;
      if (!ensure() || !master) return;
      try { master.gain.value = (S.data.volume / 100) * 0.9; LIB[name]?.(ctx.currentTime + 0.01); } catch {}
    },
  };
})();
