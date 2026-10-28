'use strict';
/* ===========================================================
 *  RETRO BLOCKS — 아케이드 블록 퍼즐 (PWA)
 *  - 화면 크기에 맞춰 블록 크기/레이아웃이 동적으로 바뀜 (갤럭시 세로/가로/폴드 대응)
 *  - NES/아케이드식 규칙: 레벨(라운드)별 프레임 중력, 40/100/300/1200 점수, LINES LEFT
 *  - 터치: 탭=회전, 좌우 스와이프=이동, 아래 드래그=소프트드롭, 빠른 플릭=하드드롭
 *  - 8비트 사운드: WebAudio 펄스/삼각파/노이즈 (외부 음원 파일 없음)
 *  - 기록: localStorage (TOP 10 + 3글자 이니셜 + 통계)
 *  - 이벤트: ROUND CLEAR(불꽃놀이), 5라운드마다 로켓 발사
 * =========================================================== */
(() => {

/* ---------- 상수 ---------- */
const COLS = 10, ROWS = 20;
const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const PIECE_COLORS = ['#ff3b30', '#ffd60a', '#30d158', '#ff2d95', '#19d3f3', '#3d5afe', '#ff9f0a'];
const DEAD_COLOR = '#6b6f8a';
const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};
// NES NTSC 레벨별 낙하 프레임 (레벨 0~29)
const GRAVITY = [48,43,38,33,28,23,18,13,8,6,5,5,5,4,4,4,3,3,3,2,2,2,2,2,2,2,2,2,2,1];
const LINE_SCORE = [0, 40, 100, 300, 1200];
const KEY = 'retroblocks.v1';

const $ = (id) => document.getElementById(id);
const rnd = (n) => Math.floor(Math.random() * n);
const pad = (n, l) => String(Math.min(Math.max(0, Math.floor(n)), Math.pow(10, l) - 1)).padStart(l, '0');

/* ---------- 저장소 ---------- */
const DEFAULTS = {
  scores: [],
  stats: { games: 0, lines: 0, tetrises: 0, bestLevel: 0 },
  settings: { startLevel: 0, music: 'A', sfx: true, name: 'AAA' },
};
function loadStore() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    if (j) return {
      scores: Array.isArray(j.scores) ? j.scores : [],
      stats: Object.assign({}, DEFAULTS.stats, j.stats),
      settings: Object.assign({}, DEFAULTS.settings, j.settings),
    };
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULTS));
}
let store = loadStore();
function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }
const topScore = () => (store.scores[0] ? store.scores[0].score : 0);

/* ===========================================================
 *  8-BIT SOUND ENGINE
 * =========================================================== */
const Snd = (() => {
  let ctx = null, master = null, bus = null, sfxBus = null, pulse = null, noiseBuf = null;
  let mode = 'A', sfxOn = true, tempoMul = 1, held = false;
  let timer = null, track = null, idx = 0, loopStart = 0, spb = 0.4;

  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const hz = (n) => {
    const m = /^([A-G])([#b]?)(\d)$/.exec(n);
    const s = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return 440 * Math.pow(2, ((12 * (+m[3] + 1) + s) - 69) / 12);
  };

  /* --- 곡 데이터 (beat 단위) --- */
  function parseLead(str) {
    const ev = []; let b = 0;
    str.trim().split(/\s+/).forEach((tok) => {
      const [n, d] = tok.split(':'); const dur = parseFloat(d);
      if (n !== 'R') ev.push({ b, d: dur, f: hz(n), v: 'lead' });
      b += dur;
    });
    return { ev, len: b };
  }
  function buildTrack(leadStr, bassFn, drums, bpm) {
    const lead = parseLead(leadStr);
    const ev = lead.ev.slice();
    for (let m = 0; m < lead.len / 4; m++) bassFn(m).forEach((f, i) => ev.push({ b: m * 4 + i * 0.5, d: 0.45, f: hz(f), v: 'bass' }));
    for (let m = 0; m < lead.len / 4; m++) drums(m).forEach((e) => ev.push({ b: m * 4 + e[0], d: 0.2, v: e[1] }));
    ev.sort((a, b) => a.b - b.b);
    return { ev, len: lead.len, bpm };
  }
  // A: 러시아 민요 "코로베이니키" (퍼블릭 도메인)
  const roots = ['A', 'A', 'E', 'A', 'D', 'C', 'E', 'A'];
  const TRACKS = {
    A: buildTrack(
      'E5:1 B4:.5 C5:.5 D5:1 C5:.5 B4:.5 A4:1 A4:.5 C5:.5 E5:1 D5:.5 C5:.5 B4:1.5 C5:.5 D5:1 E5:1 C5:1 A4:1 A4:1 R:1 ' +
      'D5:1.5 F5:.5 A5:1 G5:.5 F5:.5 E5:1.5 C5:.5 E5:1 D5:.5 C5:.5 B4:1 B4:.5 C5:.5 D5:1 E5:1 C5:1 A4:1 A4:1 R:1',
      (m) => { const r = roots[m]; return [0,1,0,1,0,1,0,1].map((o) => r + (o ? 3 : 2)); },
      () => [[1, 'snare'], [3, 'snare'], [0.5, 'hat'], [1.5, 'hat'], [2.5, 'hat'], [3.5, 'hat']],
      150),
    // B: 오리지널 아르페지오 곡
    B: buildTrack(
      'E5:1.5 D5:.5 C5:1 D5:1 C5:1.5 A4:.5 C5:2 E5:1 G5:1 E5:1 C5:1 D5:3 R:1 ' +
      'A5:1.5 G5:.5 E5:1 D5:1 C5:1.5 D5:.5 F5:2 E5:1 D5:1 C5:1 G4:1 B4:2 D5:2',
      (m) => {
        const ch = [['A2','E3','A3','E3'], ['F2','C3','F3','C3'], ['C3','G3','C4','G3'], ['G2','D3','G3','D3']][m % 4];
        return ch.concat(ch);
      },
      () => [[0, 'hat'], [1, 'hat'], [2, 'hat'], [3, 'hat'], [2, 'snare']],
      132),
  };

  function pulseWave(d) {
    const n = 32, real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * d);
    return ctx.createPeriodicWave(real, imag);
  }

  function noiseHit(t, d, v, f, dest, ftype, fTo) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = ftype || 'highpass'; fl.frequency.setValueAtTime(f, t);
    if (fTo) fl.frequency.exponentialRampToValueAtTime(fTo, t + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02);
  }

  function playEv(ev, t) {
    if (ev.v === 'hat') return noiseHit(t, 0.04, 0.03, 7000, bus, 'highpass');
    if (ev.v === 'snare') return noiseHit(t, 0.09, 0.06, 1800, bus, 'bandpass');
    const d = Math.max(0.04, ev.d * spb * 0.92);
    const o = ctx.createOscillator(), g = ctx.createGain();
    if (ev.v === 'lead') o.setPeriodicWave(pulse); else o.type = 'triangle';
    o.frequency.value = ev.f;
    const vol = ev.v === 'lead' ? 0.075 : 0.17;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.setValueAtTime(vol, t + Math.max(0.008, d - 0.03));
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + d + 0.02);
  }

  function pump() {
    if (!ctx || !track) return;
    const horizon = ctx.currentTime + 0.25;
    for (;;) {
      const ev = track.ev[idx];
      const t = loopStart + ev.b * spb;
      if (t > horizon) break;
      if (t >= ctx.currentTime - 0.05) playEv(ev, t);
      idx++;
      if (idx >= track.ev.length) { idx = 0; loopStart += track.len * spb; spb = 60 / (track.bpm * tempoMul); }
    }
  }

  function tone(f, d, o) {
    if (!ctx || !sfxOn) return;
    o = o || {};
    const t = ctx.currentTime + (o.at || 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
    const v = o.v || 0.1;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    osc.connect(g); g.connect(sfxBus); osc.start(t); osc.stop(t + d + 0.02);
  }
  function noise(d, o) {
    if (!ctx || !sfxOn) return;
    o = o || {};
    noiseHit(ctx.currentTime + (o.at || 0), d, o.v || 0.1, o.f || 1000, sfxBus, o.ft || 'lowpass', o.to);
  }
  function arp(notes, step, o) {
    notes.forEach((f, i) => { if (f) tone(f, o && o.d ? o.d : step * 1.6, Object.assign({ at: i * step }, o)); });
  }

  const SFX = {
    move() { tone(260, 0.03, { v: 0.04 }); },
    rotate() { tone(520, 0.035, { v: 0.06 }); tone(780, 0.04, { v: 0.06, at: 0.035 }); },
    lock() { noise(0.08, { v: 0.1, f: 400 }); tone(130, 0.09, { type: 'triangle', v: 0.2, to: 70 }); },
    clear(n) {
      const seqs = { 1: [659, 988], 2: [659, 784, 988], 3: [523, 659, 784, 1047], 4: [523, 659, 784, 1047, 1319, 1047, 1319, 1568] };
      arp(seqs[n] || seqs[1], n === 4 ? 0.07 : 0.06, { v: 0.1 });
      if (n === 4) noise(0.5, { v: 0.12, f: 6000, ft: 'lowpass', to: 400 });
    },
    stage() { arp([523, 659, 784, 1047, 0, 784, 1047, 1319, 1568], 0.1, { v: 0.1 }); },
    over() { arp([392, 349, 330, 294, 262, 196, 131], 0.17, { v: 0.11, d: 0.2 }); },
    rocket() { noise(2.6, { v: 0.14, f: 300, ft: 'lowpass', to: 2500 }); },
    beep() { tone(660, 0.1, { v: 0.1 }); },
    click() { tone(900, 0.03, { v: 0.05 }); },
  };

  return {
    SFX,
    unlock() {
      if (ctx) { if (ctx.state === 'suspended' && !held) ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      pulse = pulseWave(0.25);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    },
    setMode(m) { mode = m; },
    setSfx(on) { sfxOn = on; },
    setTempoLevel(l) { tempoMul = 1 + Math.min(l, 18) * 0.025; },
    start() {
      if (!ctx || mode === 'OFF') return;
      this.stop();
      bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);
      track = TRACKS[mode]; idx = 0;
      spb = 60 / (track.bpm * tempoMul);
      loopStart = ctx.currentTime + 0.08;
      timer = setInterval(pump, 30); pump();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      track = null;
      if (bus && ctx) {
        const b = bus; b.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => { try { b.disconnect(); } catch (e) { /* ignore */ } }, 300);
      }
      bus = null;
    },
    suspend() { held = true; if (ctx) ctx.suspend(); },
    resume() { held = false; if (ctx) ctx.resume(); },
  };
})();
const SFX = Snd.SFX;

/* ===========================================================
 *  화면 크기 / 스프라이트 (모두 동적)
 * =========================================================== */
const bcv = $('board'), fcv = $('fx'), ncv = $('next'), acv = $('attract');
const bctx = bcv.getContext('2d'), fctx = fcv.getContext('2d'), nctx = ncv.getContext('2d'), actx = acv.getContext('2d');

let cs = 24;          // 블록 1칸 (기기 픽셀)
let ncs = 12;         // NEXT 미리보기 1칸 (기기 픽셀)
let dpr = 1;
let CELLPX = 24;      // 블록 1칸 (CSS px) — 터치 거리 계산용
let sprites = [];

function makeSprite(col, s) {
  const c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const b = Math.max(2, Math.round(s * 0.15));
  g.fillStyle = col; g.fillRect(0, 0, s, s);
  const poly = (fill, pts) => { g.fillStyle = fill; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); };
  poly('rgba(255,255,255,.55)', [0, 0, s, 0, s - b, b, b, b]);          // 위
  poly('rgba(255,255,255,.28)', [0, 0, b, b, b, s - b, 0, s]);          // 왼쪽
  poly('rgba(0,0,0,.30)', [s, 0, s, s, s - b, s - b, s - b, b]);        // 오른쪽
  poly('rgba(0,0,0,.50)', [0, s, s, s, s - b, s - b, b, s - b]);        // 아래
  const gl = Math.max(2, Math.round(s * 0.16));
  g.fillStyle = 'rgba(255,255,255,.45)'; g.fillRect(b + 1, b + 1, gl, gl);
  g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 1; g.strokeRect(0.5, 0.5, s - 1, s - 1);
  return c;
}
function buildSprites() { sprites = PIECE_COLORS.concat([DEAD_COLOR]).map((c) => makeSprite(c, cs)); }

function fit() {
  const root = $('app'), wrap = $('wrap');
  const W = wrap.clientWidth || window.innerWidth, H = wrap.clientHeight || window.innerHeight;
  dpr = window.devicePixelRatio || 1;
  const land = W > H * 1.05;
  let f, cell;
  if (!land) {
    f = Math.max(10, Math.min(W / 26, H / 54));
    const hdrH = Math.round(f * 5.8), ftrH = Math.round(f * 6.4);
    cell = Math.min((H - hdrH - ftrH) / 20, (W - f * 1.6) / 10);
    root.style.setProperty('--hdrH', hdrH + 'px');
    root.style.setProperty('--ftrH', ftrH + 'px');
  } else {
    f = Math.max(10, Math.min(W / 58, H / 26));
    cell = Math.min((H - f) / 20, (W * 0.46) / 10);
  }
  cs = Math.max(8, Math.floor(cell * dpr));
  CELLPX = cs / dpr;
  root.style.setProperty('--cell', CELLPX + 'px');
  root.style.setProperty('--f', f + 'px');
  wrap.classList.toggle('land', land);

  bcv.width = fcv.width = cs * COLS; bcv.height = fcv.height = cs * ROWS;
  ncs = Math.max(6, Math.floor(Math.min(cs * 0.55, f * 1.6 * dpr)));
  ncv.width = ncs * 4; ncv.height = ncs * 3;
  ncv.style.width = (ncs * 4 / dpr) + 'px'; ncv.style.height = (ncs * 3 / dpr) + 'px';

  const sc = $('screens');
  acv.width = Math.max(64, Math.round((sc.clientWidth || W) * dpr));
  acv.height = Math.max(64, Math.round((sc.clientHeight || H) * dpr));
  att.length = 0; for (let i = 0; i < 12; i++) att.push(newAtt(true));

  buildSprites(); drawNext();
}

/* ===========================================================
 *  게임 상태
 * =========================================================== */
const G = {
  state: 'title',       // title | are | playing | clearing | event | dying | over | entry | paused
  pausedFrom: null,
  grid: [], piece: null, next: 0, prev: -1, pieceStats: [0, 0, 0, 0, 0, 0, 0],
  score: 0, lines: 0, level: 0, startLevel: 0, nextLevelAt: 10,
  gravCount: 0, ground: 0, timer: 0,
  clearRows: [], clearDur: 32, flash: 0,
  event: null, dieT: 0, lastEntry: null,
};

const emptyGrid = () => Array.from({ length: ROWS }, () => Array(COLS).fill(0));
function rotateCW(m) {
  const n = m.length, r = m.map((row) => row.slice());
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) r[y][x] = m[n - 1 - x][y];
  return r;
}
function collide(m, px, py) {
  for (let y = 0; y < m.length; y++) for (let x = 0; x < m[y].length; x++) {
    if (!m[y][x]) continue;
    const gx = px + x, gy = py + y;
    if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
    if (gy >= 0 && G.grid[gy][gx]) return true;
  }
  return false;
}
function randType() {   // NES 방식: 한 번 재추첨
  let r = rnd(8);
  if (r === 7 || r === G.prev) r = rnd(7);
  G.prev = r; return r;
}

/* ---------- HUD ---------- */
const bars = $('bars').children;
for (let i = 0; i < 7; i++) bars[i].style.background = PIECE_COLORS[i];
function updateBars() {
  const mx = Math.max(1, ...G.pieceStats);
  for (let i = 0; i < 7; i++) bars[i].style.height = Math.max(3, Math.round((G.pieceStats[i] / mx) * 100)) + '%';
}
function hud() {
  $('score').textContent = pad(G.score, 7);
  $('high').textContent = pad(Math.max(G.score, topScore()), 7);
  $('lines').textContent = pad(G.lines, 3);
  $('round').textContent = pad(G.level + 1, 2);
  $('left').textContent = pad(Math.max(0, G.nextLevelAt - G.lines), 2);
}
function labels() {
  $('tLevel').textContent = 'ROUND ' + (store.settings.startLevel + 1);
  $('tMusic').textContent = 'MUSIC ' + store.settings.music;
  $('btnSnd').textContent = 'SND ' + (store.settings.sfx ? 'ON' : 'OFF');
  $('btnMus').textContent = 'MUS ' + store.settings.music;
  $('tTop').textContent = pad(topScore(), 7);
}
let toastTimer = null;
function toast(text, ms) {
  const t = $('toast');
  t.classList.remove('show'); void t.offsetWidth;
  t.textContent = text; t.classList.add('show');
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function hideToast() { clearTimeout(toastTimer); $('toast').classList.remove('show'); }
function shake() { const w = $('boardWrap'); w.classList.remove('shake'); void w.offsetWidth; w.classList.add('shake'); }
function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }

/* ---------- 화면 전환 ---------- */
const SCREENS = { title: 'sTitle', help: 'sHelp', records: 'sRecords', entry: 'sEntry', over: 'sOver', pause: 'sPause' };
function show(name) {
  Object.keys(SCREENS).forEach((k) => $(SCREENS[k]).classList.toggle('on', k === name));
}

/* ---------- 화면 꺼짐 방지 ---------- */
let wake = null;
async function wakeOn() { try { if ('wakeLock' in navigator && !wake) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; } }
function wakeOff() { try { if (wake) wake.release(); } catch (e) { /* ignore */ } wake = null; }

/* ===========================================================
 *  게임 진행
 * =========================================================== */
function startGame() {
  Snd.unlock();
  G.grid = emptyGrid(); G.piece = null; G.prev = -1;
  G.score = 0; G.lines = 0; G.pieceStats = [0, 0, 0, 0, 0, 0, 0];
  G.startLevel = store.settings.startLevel; G.level = G.startLevel;
  G.nextLevelAt = G.startLevel * 10 + 10;
  G.flash = 0; G.event = null; G.lastEntry = null;
  G.next = randType();
  store.stats.games++; save();
  fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fcv.width, fcv.height);
  drawNext(); hud(); labels(); updateBars();
  show(null);
  G.state = 'are'; G.timer = 50;
  toast('READY?', 800);
  Snd.setTempoLevel(G.level); Snd.start();
  wakeOn();
}

function spawn() {
  const t = G.next; G.next = randType(); drawNext();
  G.pieceStats[t]++; updateBars();
  const m = SHAPES[TYPES[t]].map((r) => r.slice());
  const first = m.findIndex((r) => r.some(Boolean));
  G.piece = { t, m, x: Math.floor((COLS - m.length) / 2), y: -first };
  G.gravCount = 0; G.ground = 0;
  if (collide(G.piece.m, G.piece.x, G.piece.y)) { die(); return; }
  G.state = 'playing';
}

function tryMove(dx, dy) {
  const p = G.piece;
  if (!collide(p.m, p.x + dx, p.y + dy)) { p.x += dx; p.y += dy; return true; }
  return false;
}
function movePiece(dx) { if (G.state === 'playing' && tryMove(dx, 0)) SFX.move(); }
function rotatePiece() {
  if (G.state !== 'playing') return;
  const p = G.piece;
  if (p.t === 1) return;                       // O는 회전 없음
  const m2 = rotateCW(p.m);
  const kicks = p.t === 0 ? [0, -1, 1, -2, 2] : [0, -1, 1];
  for (const k of kicks) {
    if (!collide(m2, p.x + k, p.y)) { p.m = m2; p.x += k; SFX.rotate(); return; }
  }
}
function softStep() {
  if (G.state !== 'playing') return;
  if (tryMove(0, 1)) { G.score += 1; G.gravCount = 0; hud(); }
  else lockPiece();
}
function hardDrop() {
  if (G.state !== 'playing') return;
  let n = 0; while (tryMove(0, 1)) n++;
  G.score += n * 2; hud(); shake(); lockPiece();
}

function stepPlaying() {
  const g = GRAVITY[Math.min(G.level, 29)];
  if (collide(G.piece.m, G.piece.x, G.piece.y + 1)) {
    G.ground++; G.gravCount = 0;
    if (G.ground >= Math.max(g, 12)) lockPiece();
  } else {
    G.ground = 0; G.gravCount++;
    if (G.gravCount >= g) { G.gravCount = 0; G.piece.y++; }
  }
}

function lockPiece() {
  const p = G.piece; let over = false;
  p.m.forEach((row, y) => row.forEach((v, x) => {
    if (!v) return;
    const gy = p.y + y, gx = p.x + x;
    if (gy < 0) over = true; else G.grid[gy][gx] = p.t + 1;
  }));
  G.piece = null; SFX.lock();
  if (over) { die(); return; }
  const rows = [];
  for (let r = 0; r < ROWS; r++) if (G.grid[r].every(Boolean)) rows.push(r);
  if (rows.length) {
    G.state = 'clearing'; G.clearRows = rows; G.timer = 0;
    G.clearDur = rows.length === 4 ? 46 : 32;
    SFX.clear(rows.length);
    if (rows.length === 4) { G.flash = 44; toast('TETRIS!', 1300); vibrate([40, 30, 80]); }
    else if (rows.length >= 2) { toast(rows.length === 2 ? 'DOUBLE' : 'TRIPLE', 700); vibrate(30); }
  } else { G.state = 'are'; G.timer = 12; }
}

function stepClearing() {
  G.timer++;
  if (G.timer < G.clearDur) return;
  const rows = G.clearRows.slice().sort((a, b) => a - b);
  rows.forEach((r) => { G.grid.splice(r, 1); G.grid.unshift(Array(COLS).fill(0)); });
  const n = rows.length;
  G.score += LINE_SCORE[n] * (G.level + 1);
  G.lines += n;
  if (n === 4) store.stats.tetrises++;
  let leveled = false;
  while (G.lines >= G.nextLevelAt) { G.level++; G.nextLevelAt += 10; leveled = true; }
  G.clearRows = []; hud();
  if (leveled) startEvent(); else { G.state = 'are'; G.timer = 14; }
}

/* ---------- ROUND CLEAR 이벤트 ---------- */
function startEvent() {
  Snd.setTempoLevel(G.level);
  store.stats.bestLevel = Math.max(store.stats.bestLevel, G.level + 1); save();
  const rocket = G.level % 5 === 0;
  const bonus = 500 * G.level + (rocket ? 1000 * (G.level / 5) : 0);
  G.score += bonus; hud();
  G.state = 'event';
  if (rocket) {
    G.event = { type: 'rocket', t: 0, dur: 280, p: [], bonus,
      stars: Array.from({ length: 26 }, () => ({ x: rnd(80), y: rnd(160) })) };
    toast('ROCKET\nBONUS!', 1400);
  } else {
    G.event = { type: 'stage', t: 0, dur: 150, p: [], bonus };
    SFX.stage();
    toast('ROUND ' + G.level + '\nCLEAR!', 2200);
  }
  vibrate([60, 40, 60]);
}
function burst(ev) {
  const cx = 14 + Math.random() * 52, cy = 24 + Math.random() * 60, n = 26;
  const base = rnd(7);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, sp = 0.6 + Math.random() * 0.9;
    ev.p.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.3, life: 38 + rnd(16),
      col: PIECE_COLORS[(base + (i % 2)) % 7], s: Math.random() < 0.4 ? 2.4 : 1.6 });
  }
  SFX.click();
}
function stepEvent() {
  const ev = G.event; ev.t++;
  if (ev.type === 'stage') {
    if (ev.t < 90 && ev.t % 26 === 1) burst(ev);
    ev.p.forEach((q) => { q.x += q.vx; q.y += q.vy; q.vy += 0.035; q.life--; });
    ev.p = ev.p.filter((q) => q.life > 0);
  } else {
    if (ev.t === 1) toast('3', 0);
    if (ev.t === 30) toast('2', 0);
    if (ev.t === 60) toast('1', 0);
    if ([1, 30, 60].includes(ev.t)) SFX.beep();
    if (ev.t === 90) { toast('LIFT OFF!', 1500); SFX.rocket(); vibrate([80, 40, 120]); }
    if (ev.t === 240) toast('+' + ev.bonus, 1200);
    ev.lift = ev.t < 90 ? 0 : 0.0082 * Math.pow(ev.t - 90, 2);
    if (ev.t >= 90) {
      const ry = 118 - ev.lift * 0.8;
      ev.p.push({ x: 39 + Math.random() * 6, y: ry + 22, vx: (Math.random() - 0.5) * 0.8, vy: 0.5 + Math.random() * 0.6, life: 24,
        col: Math.random() < 0.5 ? '#9aa0c8' : '#d0d4ee', s: 2.5 });
    }
    ev.p.forEach((q) => { q.x += q.vx; q.y += q.vy; q.life--; });
    ev.p = ev.p.filter((q) => q.life > 0);
  }
  if (ev.t >= ev.dur) endEvent();
}
function endEvent() {
  G.event = null; fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fcv.width, fcv.height); hideToast();
  G.state = 'are'; G.timer = 24;
}

/* ---------- 게임 오버 ---------- */
function die() {
  G.state = 'dying'; G.dieT = 0; G.piece = null;
  Snd.stop(); SFX.over(); vibrate(200);
}
function stepDying() {
  G.dieT++;
  if (G.dieT >= ROWS * 2 + 40) finishDie();
}
function qualifies(s) {
  return s > 0 && (store.scores.length < 10 || s > store.scores[store.scores.length - 1].score);
}
function finishDie() {
  store.stats.lines += G.lines; save(); wakeOff();
  $('oScore').textContent = pad(G.score, 7);
  $('oInfo').textContent = 'ROUND ' + pad(G.level + 1, 2) + '  LINES ' + pad(G.lines, 3);
  if (qualifies(G.score)) {
    G.state = 'entry';
    const rank = store.scores.filter((e) => e.score >= G.score).length + 1;
    $('eRank').textContent = 'RANK ' + rank;
    $('eScore').textContent = pad(G.score, 7);
    ent = store.settings.name.split('');
    renderEntry(); show('entry');
  } else { G.state = 'over'; hud(); show('over'); }
}

/* ---------- 이니셜 입력 ---------- */
let ent = ['A', 'A', 'A'];
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function renderEntry() { ent.forEach((c, i) => { $('L' + i).textContent = c; }); }
function cycle(i, d) {
  const k = (ABC.indexOf(ent[i]) + d + 26) % 26;
  ent[i] = ABC[k]; renderEntry();
}
function submitEntry() {
  const name = ent.join('');
  const e = { name, score: G.score, lines: G.lines, level: G.level, ts: Date.now() };
  store.scores.push(e);
  store.scores.sort((a, b) => b.score - a.score);
  store.scores = store.scores.slice(0, 10);
  store.settings.name = name; G.lastEntry = e; save();
  G.state = 'over'; labels(); hud();
  openRecords('game');
}

/* ---------- 기록 화면 ---------- */
function openRecords(from) {
  const s = $('sRecords'); s.dataset.from = from;
  const L = $('recList');
  L.innerHTML = store.scores.length
    ? store.scores.map((e, i) =>
        `<div class="rec${e === G.lastEntry ? ' hl' : ''}"><span>${String(i + 1).padStart(2, '0')}</span><span>${String(e.name).replace(/[^A-Z]/g, '')}</span><span>${pad(e.score, 7)}</span><span>R${pad(e.level + 1, 2)}</span></div>`).join('')
    : '<div class="none">NO RECORDS YET</div>';
  const st = store.stats;
  $('recStats').textContent = `GAMES ${st.games}  LINES ${st.lines}  TETRIS ${st.tetrises}  BEST ROUND ${st.bestLevel}`;
  $('btnReset').textContent = 'RESET';
  show('records');
}

/* ---------- 일시정지 ---------- */
function pauseGame() {
  if (!['playing', 'clearing', 'are', 'event'].includes(G.state)) return;
  G.pausedFrom = G.state; G.state = 'paused'; tp = null;
  show('pause'); Snd.suspend();
}
function resumeGame() {
  if (G.state !== 'paused') return;
  show(null); G.state = G.pausedFrom; Snd.resume();
}
function toTitle() {
  Snd.stop(); wakeOff(); hideToast();
  G.state = 'title'; G.event = null; G.flash = 0; G.piece = null; G.grid = emptyGrid();
  fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fcv.width, fcv.height);
  labels(); hud(); show('title');
}

/* ===========================================================
 *  렌더링
 * =========================================================== */
function drawNext() {
  nctx.fillStyle = '#000'; nctx.fillRect(0, 0, ncv.width, ncv.height);
  const m = SHAPES[TYPES[G.next]];
  let r0 = 9, r1 = -1, c0 = 9, c1 = -1;
  m.forEach((row, y) => row.forEach((v, x) => { if (v) { r0 = Math.min(r0, y); r1 = Math.max(r1, y); c0 = Math.min(c0, x); c1 = Math.max(c1, x); } }));
  const ox = Math.floor((ncv.width - (c1 - c0 + 1) * ncs) / 2), oy = Math.floor((ncv.height - (r1 - r0 + 1) * ncs) / 2);
  m.forEach((row, y) => row.forEach((v, x) => {
    if (v) nctx.drawImage(sprites[G.next], ox + (x - c0) * ncs, oy + (y - r0) * ncs, ncs, ncs);
  }));
}

function drawBoard() {
  const w = cs * COLS, h = cs * ROWS;
  bctx.fillStyle = '#000'; bctx.fillRect(0, 0, w, h);
  bctx.strokeStyle = 'rgba(110,120,255,.10)'; bctx.lineWidth = 1; bctx.beginPath();
  for (let c = 1; c < COLS; c++) { bctx.moveTo(c * cs + 0.5, 0); bctx.lineTo(c * cs + 0.5, h); }
  for (let r = 1; r < ROWS; r++) { bctx.moveTo(0, r * cs + 0.5); bctx.lineTo(w, r * cs + 0.5); }
  bctx.stroke();
  const clearing = G.state === 'clearing' || (G.state === 'paused' && G.pausedFrom === 'clearing');
  for (let r = 0; r < ROWS; r++) {
    const isClr = clearing && G.clearRows.includes(r);
    for (let c = 0; c < COLS; c++) {
      const v = G.grid[r][c]; if (!v) continue;
      if (isClr) {
        const wipeStart = G.clearDur === 46 ? 20 : 12;
        if (G.timer < wipeStart) {
          if (Math.floor(G.timer / 4) % 2 === 1) { bctx.fillStyle = '#fff'; bctx.fillRect(c * cs, r * cs, cs, cs); continue; }
        } else if (Math.abs(c - 4.5) <= (G.timer - wipeStart) / 2) continue;
      }
      bctx.drawImage(sprites[v - 1], c * cs, r * cs);
    }
  }
  const p = G.piece;
  if (p) p.m.forEach((row, y) => row.forEach((v, x) => {
    if (v && p.y + y >= 0) bctx.drawImage(sprites[p.t], (p.x + x) * cs, (p.y + y) * cs);
  }));
  if (G.state === 'dying') {
    const rows = Math.min(ROWS, Math.floor(G.dieT / 2));
    for (let r = ROWS - rows; r < ROWS; r++) for (let c = 0; c < COLS; c++) bctx.drawImage(sprites[7], c * cs, r * cs);
  }
}

const ROCKET = [
  '....a....', '...aca...', '..accca..', '..accca..', '..acdca..',
  '..accca..', '..accca..', '.aaaaaaa.', 'acaaaaaca', 'aca...aca',
];
const ROCKET_COL = { a: '#ff3b30', c: '#f2f2f2', d: '#19d3f3' };
function drawRocket(ev) {
  const g = fctx;
  const grad = g.createLinearGradient(0, 0, 0, 160); grad.addColorStop(0, '#04041c'); grad.addColorStop(1, '#1d1d78');
  g.fillStyle = grad; g.fillRect(0, 0, 80, 160);
  const lift = ev.lift || 0;
  g.fillStyle = '#fff';
  ev.stars.forEach((s) => g.fillRect(s.x, (s.y + lift * 0.5) % 160, 1, 1));
  const gy = 140 + lift * 0.8;
  if (gy < 160) {
    g.fillStyle = '#4a4e86'; g.fillRect(0, gy, 80, 24);
    g.fillStyle = '#8b8fd8'; g.fillRect(0, gy, 80, 2); g.fillRect(14, gy - 24, 3, 24); g.fillRect(10, gy - 24, 7, 2);
  }
  ev.p.forEach((q) => { g.fillStyle = q.col; g.fillRect(q.x, q.y, q.s, q.s); });
  const shakeX = ev.t > 60 && ev.t < 130 ? (ev.t % 2 ? 1 : -1) : 0;
  const x0 = 31 + shakeX, y0 = Math.round(118 - lift * 0.8);
  ROCKET.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return; g.fillStyle = ROCKET_COL[ch]; g.fillRect(x0 + i * 2, y0 + j * 2, 2, 2);
  }));
  if (ev.t >= 60) {
    const fl = 6 + (ev.t % 3) * 3;
    g.fillStyle = '#ff9f0a'; g.fillRect(x0 + 6, y0 + 20, 6, fl);
    g.fillStyle = '#ffe14a'; g.fillRect(x0 + 8, y0 + 20, 2, Math.max(2, fl - 4));
  }
}
function drawFx() {
  fctx.setTransform(1, 0, 0, 1, 0, 0); fctx.clearRect(0, 0, fcv.width, fcv.height);
  const k = fcv.width / 80; fctx.setTransform(k, 0, 0, k, 0, 0);
  const ev = G.event;
  if (ev) {
    if (ev.type === 'rocket') drawRocket(ev);
    else {
      fctx.fillStyle = 'rgba(0,0,24,.55)'; fctx.fillRect(0, 0, 80, 160);
      ev.p.forEach((q) => { fctx.fillStyle = q.col; fctx.fillRect(q.x, q.y, q.s, q.s); });
    }
  } else if (G.flash > 0 && Math.floor(G.flash / 4) % 2 === 0) {
    fctx.fillStyle = 'rgba(255,255,255,.38)'; fctx.fillRect(0, 0, 80, 160);
  }
}

/* ---------- 타이틀 어트랙트 ---------- */
const att = [];
function newAtt(init) {
  const t = rnd(7); let m = SHAPES[TYPES[t]];
  for (let r = rnd(4); r > 0; r--) m = rotateCW(m);
  const cols = Math.max(1, Math.floor(acv.width / cs) - 3);
  return { t, m, x: rnd(cols) * cs, y: init ? rnd(acv.height) - 4 * cs : -4 * cs, v: (0.5 + Math.random() * 0.9) * dpr };
}
function drawAttract() {
  actx.fillStyle = '#05051f'; actx.fillRect(0, 0, acv.width, acv.height);
  actx.globalAlpha = 0.55;
  att.forEach((a, i) => {
    a.y += a.v; if (a.y > acv.height + cs) att[i] = newAtt(false);
    a.m.forEach((row, y) => row.forEach((v, x) => { if (v) actx.drawImage(sprites[a.t], a.x + x * cs, Math.floor(a.y) + y * cs); }));
  });
  actx.globalAlpha = 1;
}

/* ===========================================================
 *  메인 루프 (고정 60Hz)
 * =========================================================== */
function update() {
  if (G.flash > 0 && G.state !== 'paused') G.flash--;
  switch (G.state) {
    case 'are': if (--G.timer <= 0) { hideToast(); spawn(); } break;
    case 'playing': stepPlaying(); break;
    case 'clearing': stepClearing(); break;
    case 'event': stepEvent(); break;
    case 'dying': stepDying(); break;
    default: break;
  }
}
function render() {
  if (G.state === 'title') { drawAttract(); return; }
  drawBoard(); drawFx();
}
let last = performance.now(), acc = 0;
const STEP = 1000 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = now - last; last = now; if (dt > 100) dt = 100;
  acc += dt;
  while (acc >= STEP) { acc -= STEP; update(); }
  render();
}

/* ===========================================================
 *  입력: 터치 / 포인터
 *   탭 = 회전 | 좌우 스와이프 = 이동(손가락 1:1) | 아래 드래그 = 소프트드롭 | 빠른 아래 플릭 = 하드드롭
 * =========================================================== */
let tp = null;
addEventListener('pointerdown', (e) => {
  Snd.unlock();
  if (e.target.closest('button')) return;
  if (G.state === 'event' && G.event && G.event.t > 45) { endEvent(); return; }
  if (G.state !== 'playing') return;
  tp = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ax: e.clientX, ay: e.clientY, t: performance.now(), moved: false };
});
addEventListener('pointermove', (e) => {
  if (!tp || e.pointerId !== tp.id || G.state !== 'playing') return;
  const stepX = CELLPX * 0.9, stepY = CELLPX * 1.15;
  if (Math.hypot(e.clientX - tp.sx, e.clientY - tp.sy) > 10) tp.moved = true;
  const dx = e.clientX - tp.ax, dy = e.clientY - tp.ay;
  if (Math.abs(dx) >= stepX && Math.abs(dx) >= Math.abs(dy)) {
    const n = Math.trunc(Math.abs(dx) / stepX), dir = Math.sign(dx);
    for (let i = 0; i < n; i++) movePiece(dir);
    tp.ax += dir * n * stepX; tp.ay = e.clientY;
  } else if (dy >= stepY && dy > Math.abs(dx) * 1.2) {
    const n = Math.trunc(dy / stepY);
    for (let i = 0; i < n && G.state === 'playing'; i++) softStep();
    tp.ay += n * stepY; tp.ax = e.clientX;
  }
});
function endPointer(e) {
  if (!tp || e.pointerId !== tp.id) return;
  const t = tp; tp = null;
  if (G.state !== 'playing') return;
  const dt = performance.now() - t.t, dx = e.clientX - t.sx, dy = e.clientY - t.sy;
  if (e.type === 'pointerup') {
    if (!t.moved && dt < 350) rotatePiece();
    else if (dy > CELLPX * 4 && dt < 300 && dy > Math.abs(dx) * 1.5) hardDrop();
  }
}
addEventListener('pointerup', endPointer);
addEventListener('pointercancel', endPointer);
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- 키보드 (PC) ---------- */
addEventListener('keydown', (e) => {
  Snd.unlock();
  const k = e.key;
  const isP = k === 'p' || k === 'P' || k === 'Escape';
  if (G.state === 'title') { if (k === 'Enter' || k === ' ') { e.preventDefault(); startGame(); } return; }
  if (G.state === 'paused') { if (isP || k === 'Enter') resumeGame(); return; }
  if (G.state !== 'playing') { if (isP) pauseGame(); return; }
  switch (k) {
    case 'ArrowLeft': movePiece(-1); break;
    case 'ArrowRight': movePiece(1); break;
    case 'ArrowDown': softStep(); break;
    case 'ArrowUp': case 'z': case 'Z': case 'x': case 'X': if (!e.repeat) rotatePiece(); break;
    case ' ': if (!e.repeat) hardDrop(); break;
    default: if (isP) pauseGame(); return;
  }
  e.preventDefault();
});

/* ---------- 버튼 액션 ---------- */
const MUSIC = ['A', 'B', 'OFF'];
function setMusic(m) {
  store.settings.music = m; Snd.setMode(m); save(); labels();
  if (['playing', 'clearing', 'are', 'event'].includes(G.state)) { Snd.stop(); Snd.start(); }
}
const isStandalone = () => (window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)) || navigator.standalone;
const fsEl = () => document.documentElement;
const canFs = () => !!(fsEl().requestFullscreen || fsEl().webkitRequestFullscreen);
let deferredInstall = null, resetArmed = 0;
const ACTIONS = {
  start: () => startGame(),
  title: () => toTitle(),
  help: () => show('help'),
  back: () => show('title'),
  records: () => openRecords('title'),
  recordsGame: () => openRecords('game'),
  'lvl-': () => { store.settings.startLevel = (store.settings.startLevel + 9) % 10; save(); labels(); },
  'lvl+': () => { store.settings.startLevel = (store.settings.startLevel + 1) % 10; save(); labels(); },
  'mus-': () => setMusic(MUSIC[(MUSIC.indexOf(store.settings.music) + 2) % 3]),
  'mus+': () => setMusic(MUSIC[(MUSIC.indexOf(store.settings.music) + 1) % 3]),
  snd: () => { store.settings.sfx = !store.settings.sfx; Snd.setSfx(store.settings.sfx); save(); labels(); },
  pause: () => { if (G.state === 'paused') resumeGame(); else pauseGame(); },
  resume: () => resumeGame(),
  up: (b) => cycle(+b.dataset.i, 1),
  dn: (b) => cycle(+b.dataset.i, -1),
  entryok: () => submitEntry(),
  fs: () => {
    try {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      const p = (fsEl().requestFullscreen || fsEl().webkitRequestFullscreen).call(fsEl());
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  },
  reset: () => {
    const now = Date.now();
    if (now - resetArmed < 3000) {
      store.scores = []; store.stats = JSON.parse(JSON.stringify(DEFAULTS.stats)); save(); labels(); G.lastEntry = null; openRecords('title'); resetArmed = 0;
    } else { resetArmed = now; $('btnReset').textContent = 'SURE?'; }
  },
  install: async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
    deferredInstall = null; $('btnInstall').hidden = true;
  },
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  Snd.unlock(); SFX.click();
  const fn = ACTIONS[b.dataset.act]; if (fn) fn(b);
});
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('btnInstall').hidden = false; });

/* ---------- 화면/가시성 ---------- */
let fitTimer = null;
const refit = () => { fit(); clearTimeout(fitTimer); fitTimer = setTimeout(fit, 250); };   // 회전 직후 크기 재측정
addEventListener('resize', refit);
addEventListener('orientationchange', refit);
document.addEventListener('fullscreenchange', refit);
if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => fit()).observe($('wrap'));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame(); else if (['playing', 'clearing', 'are', 'event'].includes(G.state)) wakeOn();
});

/* ---------- 시작 ---------- */
Snd.setMode(store.settings.music); Snd.setSfx(store.settings.sfx);
G.grid = emptyGrid(); G.next = rnd(7);
$('btnFs').hidden = !(canFs() && !isStandalone());
fit(); labels(); hud(); updateBars();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
