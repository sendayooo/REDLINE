(() => {
'use strict';
const cv = document.getElementById('game'), ctx = cv.getContext('2d');
const W = 960, H = 640, M = 64, TAU = Math.PI * 2;
cv.width = W; cv.height = H;
const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
const lightC = mk(), lx = lightC.getContext('2d'), floorC = mk();
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let PILLARS = [];
const mkObs = (a, ks) => a.map(([x, y], i) => ({ x: x - 24, y: y - 24, w: 48, h: 48, k: ks[i % ks.length] }));
const TORCH = [[92, 92], [W - 92, 92], [92, H - 92], [W - 92, H - 92]];
let def, cur = 'chumbo', PCOL, PAUSE; const won = {};
const keys = {}, mouse = { x: W / 2, y: H / 2, l: false, r: false };
let state = 'menu', time = 0, shake = 0, flash = 0, stateT = 0;
let P, B, pb = [], eb = [], haz = [], impacts = [], parts = [], ghosts = [];

/* ---------- Setup ---------- */
function hash(a, b) { let h = (a * 374761393 + b * 668265263) ^ (a << 5); h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
function buildFloor() {
  const g = floorC.getContext('2d');
  for (let y = 0; y < H; y += 32) for (let x = 0; x < W; x += 32) {
    const h = hash(x, y), s = Math.floor(30 + h * 14), wall = x < M || y < M || x >= W - M || y >= H - M;
    g.fillStyle = def.tile(s, wall);
    g.fillRect(x, y, 32, 32);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + 31, 32, 1); g.fillRect(x + 31, y, 1, 32);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x, y, 32, 1);
    if (h > .8) { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + 6, y + 8, 10, 2); g.fillRect(x + 14, y + 10, 2, 8); }
  }
  if (def.deco) def.deco(g); g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(M, M, W - 2 * M, 8); g.fillRect(M, M, 8, H - 2 * M);
}


/* ---------- Utilidades ---------- */

function blocked(x, y) {
  if (x < M || y < M || x > W - M || y > H - M) return true;
  return PILLARS.some(p => x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h);
}


function aim() { return Math.atan2(P.y - B.y, P.x - B.x); }

function rayLen(x, y, dx, dy, r) {
  const tx = dx > 0 ? (W - M - r - x) / dx : dx < 0 ? (M + r - x) / dx : 1e9;
  const ty = dy > 0 ? (H - M - r - y) / dy : dy < 0 ? (M + r - y) / dy : 1e9;
  return Math.max(0, Math.min(tx, ty, 600));
}


/* ---------- Ataques do boss (geradores: yield = esperar segundos) ---------- */
function* warn(kind, d) {
  d *= B.phase === 3 ? .75 : 1;
  const t = { kind, t: d, max: d, ang: aim(), len: 0, radius: kind === 'ring' ? 310 + B.phase * 25 : 460, half: .7 }; B.tele = t; sound.play('warn'); yield d; B.tele = null; return t;
}
// Dispersões acertam a região inteira no mesmo instante, sem frente lenta.
function areaHit(x, y, radius, ang = 0, half = Math.PI, col = '#ff8040') {
  impacts.push({ x, y, radius, ang, half, col, life: .22 });
  const dx = P.x - x, dy = P.y - y, distance = Math.hypot(dx, dy);
  const delta = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - ang), Math.cos(Math.atan2(dy, dx) - ang)));
  const reachesPlayer = distance <= radius + P.r && (half >= Math.PI || delta <= half + Math.asin(Math.min(1, P.r / Math.max(distance, 1))));
  if (reachesPlayer) {
    // Um cone que alcança um dash recente devolve a recarga, inclusive se o dash evita o dano.
    const sinceDash = run.elapsed - P.lastDashAt;
    if (half < Math.PI && state === 'play' && !B.dead && P.hp > 0 && !P.dashRefunded && sinceDash >= 0 && sinceDash <= .5 + 1e-9) {
      P.dashCd = 0; P.dashRefunded = true;
      ringFx(P.x, P.y, 45, '#99eeff'); sound.play('switch');
    }
    hurt();
  }
  sound.play('blast'); shake = Math.max(shake, 6);
}
function* cone(n, bursts) {
  for (let i = 0; i < bursts; i++) {
    const tele = yield* warn('cone', i ? .32 : .48);
    areaHit(B.x, B.y, tele.radius, tele.ang, tele.half, PCOL[B.phase]);
    burst(B.x, B.y, 12, PCOL[B.phase], 240, 4); yield .16;
    if (state !== 'play' || B.dead) return;
  }
}
function* ring(n, waves) {
  for (let w = 0; w < waves; w++) {
    const tele = yield* warn('ring', w ? .36 : .5);
    areaHit(B.x, B.y, tele.radius, 0, Math.PI, PCOL[B.phase]);
    yield .22;
    if (state !== 'play' || B.dead) return;
  }
}
function* rain(n, delay, cnt) {
  for (let i = 0; i < n; i++) {
    let x = i % 2 ? rnd(M + 70, W - M - 70) : P.x + rnd(-70, 70), y = i % 2 ? rnd(M + 70, H - M - 70) : P.y + rnd(-70, 70);
    haz.push({ x: clamp(x, M + 60, W - M - 60), y: clamp(y, M + 60, H - M - 60), r: 58, t: 0, delay, cnt }); yield .18;
  }
  yield delay + .3;
}
function* charge(strong) {
  const t = yield* warn('charge', .9);
  B.chAng = t.ang; B.cvx = Math.cos(t.ang) * 620; B.cvy = Math.sin(t.ang) * 620;
  B.chLeft = rayLen(B.x, B.y, Math.cos(t.ang), Math.sin(t.ang), B.r); B.chBoss = strong; B.charging = true;
  while (B.charging) yield .02;
  yield .3;
}
function* spiral() {
  yield* warn('pulse', .38);
  for (let i = 0; i < 36; i++) { for (let a = 0; a < 3; a++) shootE(B.x, B.y, i * .35 + a * TAU / 3, 185); yield .07; }
}
function* combo() { yield* cone(2, 2); yield* ring(18, 3); }
const ATT = {
  1: [() => cone(3, 3), () => ring(14, 2), () => rain(5, .65, 8), () => charge(false)],
  2: [() => rain(6, 1, 6), () => charge(false), () => cone(3, 3), () => ring(16, 2)],
  3: [() => spiral(), () => rain(8, .8, 10), () => charge(true), () => combo()]
};
function pickAttack() {
  const l = def.att[B.phase]; let i; do { i = Math.floor(Math.random() * l.length); } while (i === B.last && l.length > 1);
  B.last = i; return l[i]();
}
function phaseOf(f) { return f > .65 ? 1 : f > .30 ? 2 : 3; }

/* ---------- Atualização ---------- */


function updateHaz(dt) {
  for (let i = haz.length - 1; i >= 0; i--) {
    const h = haz[i]; if (!h) break; if (!h.notified) { h.notified = true; sound.play('warn'); } h.t += dt;
    if (h.t >= h.delay) { sound.play('blast');
      burst(h.x, h.y, 22, '#ff6030', 300, 5, .6); ringFx(h.x, h.y, h.r, '#ffaa50'); shake = Math.max(shake, 5);
      // Toda a explosão aplica dano dentro de h.r neste quadro.
      burst(h.x, h.y, h.cnt * 2, PCOL[B.phase], 360, 4);
      if (Math.hypot(P.x - h.x, P.y - h.y) < h.r + P.r * .4) hurt();
      if (state !== 'play' || B.dead) return; haz.splice(i, 1);
    }
  }
}
function updateFx(dt) {
  for (let i = impacts.length - 1; i >= 0; i--) { impacts[i].life -= dt; if (impacts[i].life <= 0) impacts.splice(i, 1); }
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
    if (p.k) p.r = p.max * (1 - p.life / p.mx); else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96; }
  }
  for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].life -= dt; if (ghosts[i].life <= 0) ghosts.splice(i, 1); }
  shake *= Math.pow(.002, dt); if (shake < .1) shake = 0;
}


/* ---------- Renderização ---------- */
const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
function txt(s, x, y, size, col, al = 'center') { ctx.font = `bold ${size}px monospace`; ctx.textAlign = al; ctx.fillStyle = '#000'; ctx.fillText(s, x + 2, y + 2); ctx.fillStyle = col; ctx.fillText(s, x, y); }
function spot(g, x, y, r, a) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }

function drawPillars() {
  for (const p of PILLARS) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(p.x + 6, p.y + 10, p.w, p.h);
    if (p.k === 'cactus') { R(p.x + 16, p.y - 20, 16, p.h + 20, '#2f7a3a'); R(p.x + 2, p.y - 4, 14, 8, '#2f7a3a'); R(p.x + 2, p.y - 16, 8, 14, '#2f7a3a'); R(p.x + 32, p.y + 4, 14, 8, '#2f7a3a'); R(p.x + 38, p.y - 8, 8, 14, '#2f7a3a'); R(p.x + 20, p.y - 20, 4, p.h + 20, '#4aa05a'); }
    else if (p.k === 'barrel') { R(p.x, p.y - 8, p.w, p.h + 8, '#6d4524'); R(p.x, p.y - 8, p.w, 8, '#9a6a3a'); R(p.x, p.y + 6, p.w, 4, '#2a2a2a'); R(p.x, p.y + 28, p.w, 4, '#2a2a2a'); }
    else if (p.k === 'mach') { R(p.x, p.y - 6, p.w, p.h + 6, '#2c3440'); R(p.x, p.y - 6, p.w, 10, '#4a5668'); for (let i = 0; i < 4; i++) R(p.x + i * 14, p.y + 24, 8, 8, '#d8b020'); }
    else if (p.k === 'shroom') { R(p.x + 14, p.y, 20, p.h, '#cdbf9a'); ctx.fillStyle = '#3a8a7a'; ctx.beginPath(); ctx.ellipse(p.x + 24, p.y - 2, 34, 20, 0, Math.PI, TAU); ctx.fill(); R(p.x + 8, p.y - 12, 6, 5, '#c8fff0'); R(p.x + 28, p.y - 18, 7, 5, '#c8fff0'); }
    else if (p.k === 'crys') { ctx.fillStyle = '#6a46d0'; ctx.beginPath(); ctx.moveTo(p.x + 24, p.y - 26); ctx.lineTo(p.x + 48, p.y + 24); ctx.lineTo(p.x + 24, p.y + 48); ctx.lineTo(p.x, p.y + 24); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#a384ff'; ctx.beginPath(); ctx.moveTo(p.x + 24, p.y - 26); ctx.lineTo(p.x + 24, p.y + 48); ctx.lineTo(p.x, p.y + 24); ctx.closePath(); ctx.fill(); }
    else if (p.k === 'col') { R(p.x, p.y, p.w, p.h, '#3a3638'); R(p.x, p.y - 6, p.w, 8, '#6a6466'); R(p.x + 6, p.y - 14, 14, 8, '#6a6466'); R(p.x + 4, p.y + 6, 6, p.h - 10, '#4a4648'); }
    else { R(p.x, p.y, p.w, p.h, '#2c2e3d'); R(p.x, p.y - 10, p.w, 12, '#555a74'); R(p.x + 4, p.y + 6, 6, p.h - 10, '#3a3d50'); R(p.x, p.y + p.h - 4, p.w, 4, '#1c1d28'); }
  }
}


function drawChumbo() {
  const sh = B.tele ? rnd(-2, 2) : 0, bx = B.x + sh, by = B.y + Math.sin(B.t * 3) * 3, hit = B.hitT > 0, ec = PCOL[B.phase];
  const c = (col) => hit ? '#fff' : col;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(B.x, B.y + 62, 62, 16, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(Math.round(bx), Math.round(by));
  R(-34, 36, 24, 22, c('#16171d')); R(10, 36, 24, 22, c('#16171d'));
  R(-42, -34, 84, 76, '#0e0f14'); R(-38, -30, 76, 68, c('#2a2d38'));
  R(-26, -18, 52, 36, c('#3b3f4d')); R(-22, -14, 4, 4, '#777'); R(18, -14, 4, 4, '#777'); R(-22, 10, 4, 4, '#777'); R(18, 10, 4, 4, '#777');
  const pulse = 8 + Math.sin(B.t * 6) * 2; R(-pulse / 2, -pulse / 2, pulse, pulse, ec);
  R(-62, -36, 26, 28, c('#343746')); R(36, -36, 26, 28, c('#343746'));
  R(-58, -50, 6, 16, c('#555a6b')); R(-48, -46, 6, 12, c('#555a6b')); R(52, -50, 6, 16, c('#555a6b')); R(42, -46, 6, 12, c('#555a6b'));
  R(-22, -62, 44, 36, c('#1b1c24')); R(-14, -50, 28, 14, '#08080b');
  R(-12, -46, 9, 5, ec); R(3, -46, 9, 5, ec); R(-8, -38, 16, 2, '#400');
  ctx.rotate(aim()); R(18, -7, 48, 14, c('#555a6b')); R(60, -9, 10, 18, c('#2a2d38')); R(66, -4, 6, 8, B.tele ? ec : '#111');
  ctx.restore();
}


function drawParts() {
  for (const p of parts) {
    ctx.globalAlpha = clamp(p.life / (p.mx || p.max), 0, 1);
    if (p.k) { ctx.strokeStyle = p.col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke(); }
    else { ctx.fillStyle = p.col; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.sz, p.sz); }
  }
  ctx.globalAlpha = 1;
}
function drawLight() {
  lx.globalCompositeOperation = 'source-over'; lx.clearRect(0, 0, W, H); lx.fillStyle = def.dark; lx.fillRect(0, 0, W, H);
  lx.globalCompositeOperation = 'destination-out';
  spot(lx, P.x, P.y, 230, .9); spot(lx, B.x, B.y, 250 + B.phase * 20, .85);
  TORCH.forEach(([x, y], i) => spot(lx, x, y, 170 + Math.sin(time * 9 + i * 2) * 12, .8));
  ctx.drawImage(lightC, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(B.x, B.y, 0, B.x, B.y, 240); g.addColorStop(0, PCOL[B.phase] + '33'); g.addColorStop(1, '#00000000'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}
function drawTorches() {
  for (const [x, y] of TORCH) { R(x - 8, y, 16, 10, '#2a2a33'); R(x - 5, y - 4, 10, 6, '#3a3a45'); const f = Math.sin(time * 12 + x) * 2; R(x - 4, y - 14 + f, 8, 10, def.flame); R(x - 2, y - 11 + f, 4, 6, '#ffe070'); }
}
function heart(x, y, full) {
  const m = [[0, 1, 1, 0, 1, 1, 0], [1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [0, 1, 1, 1, 1, 1, 0], [0, 0, 1, 1, 1, 0, 0], [0, 0, 0, 1, 0, 0, 0]];
  m.forEach((r, j) => r.forEach((v, i) => { if (v) R(x + i * 4, y + j * 4, 4, 4, full ? '#e8303a' : '#3a2025'); }));
}

function overlay(title, sub, col) {
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
  txt(title, W / 2, H / 2 - 20, 54, col); txt(sub, W / 2, H / 2 + 30, 20, '#ddd');
}
function drawCrosshair() {
  const x = mouse.x, y = mouse.y; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 15, y); ctx.moveTo(x, y - 15); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 15); ctx.stroke();
}


/* ---------- Pistoleiro Fantasma ---------- */
function* fast(n, two) {
  for (let i = 0; i < n; i++) {
    const tele = yield* warn('line', .2); const a = Math.atan2(P.y + P.vy * .22 - B.y, P.x + P.vx * .22 - B.x), sp = 480 + B.phase * 55;
    if (two) for (const o of [-1, 1]) shootE(B.x + Math.cos(a + 1.57) * 16 * o, B.y + Math.sin(a + 1.57) * 16 * o, a, sp, 5, '#7fe8ff');
    else shootE(B.x, B.y, a, sp, 5, '#7fe8ff');
    for (const offset of [-.18, .18]) shootE(B.x, B.y, a + offset, sp * .86, 7, '#7fe8ff');
    burst(B.x, B.y, 5, '#bff', 150, 3, .2); yield .08;
  }
}
function* ricochet(n) {
  yield* warn('pulse', .32);
  for (let i = 0; i < n; i++) { shootE(B.x, B.y, aim() + rnd(-.9, .9), 360, 8, '#9ff'); const b = eb[eb.length - 1]; b.bn = 4; b.life = 7; yield .13; }
  yield .4;
}
function* mark(n) {
  for (let i = 0; i < n; i++) {
    const x = P.x, y = P.y; haz.push({ x, y, r: 26, t: 0, delay: .9, cnt: 0 }); yield .9;
    shootE(B.x, B.y, Math.atan2(y - B.y, x - B.x), 700, 5, '#ffffff'); yield .35;
  }
}
function* spray() { yield* ring(24, 3); }
function* duel() {
  B.duel = 1; B.tele = null; B.parried = false; yield .9; yield rnd(.4, .9);
  B.duelGo = true; sound.play('duel'); yield B.phase === 3 ? .4 : .55;
  B.duelGo = false; B.duel = 2; shake = 10; flash = .15; burst(B.x, B.y, 12, '#fff', 300, 3, .3);
  const ok = B.parried || P.dashT > 0;
  if (ok) { B.parried = true; damageBoss(100); if (B.dead) return; B.hitT = .3; B.vuln = .65; burst(B.x, B.y, 30, '#7fe8ff', 350, 5, .6); ringFx(B.x, B.y, 90, '#7fe8ff'); }
  else hurt(2);
  yield .35; B.duel = 0; yield ok ? .65 : .15;
}
function drawGhost() {
  const hit = B.hitT > 0, ec = PCOL[B.phase], c = k => hit ? '#fff' : k;
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(B.x, B.y + 50, 40, 12, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(Math.round(B.x), Math.round(B.y + Math.sin(B.t * 3) * 3));
  R(-28, -26, 56, 58, c('#2a2540')); for (let i = -3; i < 3; i++) R(i * 9 + 2, 32, 7, 8 + ((i & 1) ? 10 : 0), c('#2a2540'));
  R(-12, -24, 24, 36, c('#e8e4d0')); for (let i = 0; i < 4; i++) R(-9, -20 + i * 8, 18, 2, '#403a30');
  R(-9, -42, 18, 16, c('#e8e4d0')); R(-6, -38, 5, 5, ec); R(2, -38, 5, 5, ec); R(-3, -30, 6, 3, '#403a30');
  R(-24, -46, 48, 6, c('#3a2a1a')); R(-13, -62, 26, 18, c('#3a2a1a')); R(-13, -50, 26, 4, '#a03030');
  ctx.rotate(aim()); for (const o of (B.phase >= 2 ? [-9, 9] : [8])) { R(14, o - 3, 22, 6, '#cfd8dc'); R(32, o - 2, 8, 4, ec); R(12, o, 6, 8, '#6d4c41'); }
  ctx.restore();
}
function fxGhost() {
  if (B.duelA > .01) {
    lx.globalCompositeOperation = 'source-over'; lx.clearRect(0, 0, W, H); lx.fillStyle = `rgba(0,0,0,${.8 * B.duelA})`; lx.fillRect(0, 0, W, H);
    lx.globalCompositeOperation = 'destination-out'; spot(lx, B.x, B.y, 110, 1); spot(lx, P.x, P.y, 110, 1); ctx.drawImage(lightC, 0, 0);
    if (B.duelGo) txt('!', B.x, B.y - 80, 64, '#ff3030');
    if (B.duel === 2) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(P.x, P.y); ctx.stroke(); }
  }
}

/* ---------- Carrasco Colossal ---------- */
function* swing(two, rec = 1.3) {
  const t = yield* warn('arc', .95); sound.play('impact'); const d = Math.atan2(P.y - B.y, P.x - B.x) - t.ang;
  B.swAng = t.ang; B.swT = .22; shake = 12; burst(B.x + Math.cos(t.ang) * 140, B.y + Math.sin(t.ang) * 140, 20, '#ffb080', 300, 5, .5);
  if (Math.hypot(P.x - B.x, P.y - B.y) < 200 && Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < .95) hurt();
  if (two) { yield .3; yield* swing(false, rec); return; }
  B.vuln = rec; yield rec;
}
function* slam(r, cnt) { haz.push({ x: B.x, y: B.y, r, t: 0, delay: 1.1, cnt }); yield 1.2; B.vuln = 1.2; yield 1.2; }
function* cracks(lines) {
  for (let l = 0; l < lines; l++) {
    const a = aim() + (l - (lines - 1) / 2) * .5;
    for (let i = 1; i <= 7; i++) { const x = B.x + Math.cos(a) * i * 78, y = B.y + Math.sin(a) * i * 78; if (!blocked(x, y)) haz.push({ x, y, r: 38, t: 0, delay: .65, cnt: B.phase === 3 ? 4 : 0 }); }
  }
  yield 1.9; B.vuln = .8; yield .8;
}
function* swingCharge() { yield* swing(false, .2); yield* charge(true); }
function drawKnight() {
  const by = B.y + Math.sin(B.t * 2) * 2 + (B.vuln > 0 ? 8 : 0), hit = B.hitT > 0, ec = B.vuln > 0 ? '#aa9' : PCOL[B.phase], c = k => hit ? '#fff' : k;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(B.x, B.y + 62, 70, 16, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(Math.round(B.x), Math.round(by));
  R(-30, 34, 22, 28, c('#1a1a22')); R(8, 34, 22, 28, c('#1a1a22'));
  R(-44, -34, 88, 74, '#0c0c10'); R(-40, -30, 80, 66, c('#3a3d4c')); R(-30, -20, 60, 40, c('#4b4f62')); R(-4, -20, 8, 40, '#2a2c38');
  R(-66, -42, 30, 30, c('#4b4f62')); R(36, -42, 30, 30, c('#4b4f62')); R(-62, -58, 6, 16, '#8a8fa6'); R(-50, -52, 6, 10, '#8a8fa6'); R(56, -58, 6, 16, '#8a8fa6'); R(44, -52, 6, 10, '#8a8fa6');
  R(-20, -74, 40, 42, c('#2e303c')); R(-14, -58, 28, 8, '#060608'); R(-11, -56, 8, 4, ec); R(3, -56, 8, 4, ec); R(-28, -88, 8, 22, '#c9c2a8'); R(20, -88, 8, 22, '#c9c2a8');
  let sa = aim(); if (B.tele && B.tele.kind === 'arc') sa = B.tele.ang - 1.2; else if (B.swT > 0) sa = B.swAng - 1 + (1 - B.swT / .22) * 2;
  ctx.rotate(sa); R(10, -5, 16, 10, '#5a3a2a'); R(24, -14, 6, 28, '#8a8fa6'); R(30, -6, 110, 12, c('#b8c0d8')); R(30, -2, 110, 3, '#fff');
  ctx.restore();
}

/* ---------- Definições dos bosses ---------- */
const ORDER = ['chumbo', 'fantasma', 'colosso', 'matriarca', 'fungo', 'imperatriz'];
const BOSSES = {
  chumbo: { name: 'Carrasco de Chumbo', desc: ['Arena de pedra. Cones, anéis e', 'chuva de fogo em 3 fases.'], hp: 4200, r: 50, pcol: ['', '#ff9a2a', '#ff3a3a', '#ff35c8'], pause: [0, .4, .27, .16], att: ATT,
    obs: mkObs([[240, 200], [720, 200], [240, 440], [720, 440]], ['pil']), tile: (s, w) => w ? `rgb(${s + 16},${s + 12},${s + 22})` : `rgb(${s},${s + 2},${s + 10})`, dark: 'rgba(3,3,10,.74)', flame: '#ff9a2a', draw: drawChumbo },
  fantasma: { name: 'Pistoleiro Fantasma', desc: ['Cidade fantasma. Tiros precisos,', 'ricochetes e duelo.'], hp: 3800, r: 36, pcol: ['', '#7fe8ff', '#4fd0ff', '#d0fbff'], pause: [0, .3, .2, .12],
    att: { 1: [() => fast(6, true), () => ricochet(5), () => cone(2, 2), () => mark(2), duel], 2: [() => fast(8, true), () => ricochet(7), () => cone(3, 2), () => mark(3), duel], 3: [() => fast(10, true), spray, () => ricochet(8), () => mark(3), duel] },
    obs: mkObs([[280, 210], [680, 210], [280, 430], [680, 430]], ['cactus', 'barrel']), tile: (s, w) => w ? `rgb(${s + 70},${s + 35},${s + 5})` : `rgb(${s + 95},${s + 75},${s + 40})`, dark: 'rgba(25,12,6,.55)', flame: '#ffcf70', draw: drawGhost, fx: fxGhost,
    upd(dt) { if (B.duelGo && P.dashT > 0) B.parried = true; B.duelA += ((B.duel ? 1 : 0) - B.duelA) * Math.min(1, dt * 6); } },
  colosso: { name: 'Carrasco Colossal', desc: ['Castelo em ruínas. Golpes pesados:', 'ataque quando ele se cansa.'], hp: 3300, r: 56, pcol: ['', '#ff3030', '#ff5020', '#ff0080'], pause: [0, 1.0, .8, .6],
    att: { 1: [() => swing(false), () => slam(150, 14), () => cracks(1)], 2: [() => swing(true), () => slam(170, 16), () => cracks(2), () => charge(false)], 3: [() => swing(true), () => slam(230, 22), () => cracks(3), () => charge(true), swingCharge] },
    obs: mkObs([[230, 200], [730, 200], [230, 440], [730, 440]], ['col']), tile: (s, w) => w ? `rgb(${s + 22},${s + 8},${s + 4})` : `rgb(${s + 6},${s - 2},${s - 2})`, dark: 'rgba(14,2,2,.72)', flame: '#ff4010', draw: drawKnight }
};


/* ---------- Matriarca Mecânica ---------- */
function* missiles(n) {
  yield* warn('pulse', .38);
  for (let i = 0; i < n; i++) { shootE(B.x, B.y, aim() + rnd(-1.2, 1.2), 150, 7, '#ffcc40'); const b = eb[eb.length - 1]; b.hm = 1.7; b.life = 5.5; b.hl = 2.8; yield .3; }
  yield 1.2;
}
function* laser(dual) {
  const dir = Math.random() < .5 ? 1 : -1, st = aim() - dir * .85;
  B.lz = { a: st, end: st + dir * 1.7, dir, spd: B.phase === 3 ? 1.35 : .95, on: false, dual };
  sound.play('warn'); yield B.phase === 3 ? .75 : .95; B.lz.on = true; sound.play('impact');
  while (B.lz.a !== B.lz.end) yield .05;
  B.lz = null; B.core = 2.4; yield 2.4;
}
function* smash(n) {
  for (let i = 0; i < n; i++) {
    haz.push({ x: P.x, y: P.y, r: 70, t: 0, delay: .85, cnt: 0 });
    if (B.phase > 1) haz.push({ x: clamp(P.x + rnd(-130, 130), M + 40, W - M - 40), y: clamp(P.y + rnd(-130, 130), M + 40, H - M - 40), r: 70, t: 0, delay: .85, cnt: 0 });
    yield .7;
  }
  yield .6; B.core = 2.2; yield 2.2;
}
function* mixed() { yield* missiles(3); yield* smash(2); }
const laserHit = a => { const dx = P.x - B.x, dy = P.y - B.y, c = Math.cos(a), sn = Math.sin(a); return dx * c + dy * sn > 0 && Math.abs(dx * sn - dy * c) < P.r + 9; };
function drawMech() {
  const open = B.core > 0, hit = B.hitT > 0, ec = PCOL[B.phase], c = k => hit ? '#fff' : k, o = open ? 14 : 0, sw = Math.sin(B.t * 2) * 5;
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(B.x, B.y + 62, 74, 16, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(Math.round(B.x), Math.round(B.y + Math.sin(B.t * 2.5) * 2));
  R(-54, 34, 36, 28, c('#222a33')); R(18, 34, 36, 28, c('#222a33')); for (let i = 0; i < 4; i++) { R(-50 + i * 9, 40, 4, 16, '#111'); R(22 + i * 9, 40, 4, 16, '#111'); }
  R(-50, -36, 100, 78, '#10141a'); R(-46, -32, 92, 70, c('#3b4756'));
  R(-14, -14, 28, 28, '#05080c'); if (open) { const pu = 6 + Math.sin(B.t * 8) * 2; R(-pu, -pu, pu * 2, pu * 2, ec); R(-4, -4, 8, 8, '#fff'); }
  R(-46 - o, -32, 46, 70, c('#5b6878')); R(0 + o, -32, 46, 70, c('#5b6878')); R(-40 - o, -24, 5, 5, '#222'); R(35 + o, -24, 5, 5, '#222'); R(-40 - o, 24, 5, 5, '#222'); R(35 + o, 24, 5, 5, '#222');
  R(-18, -60, 36, 26, c('#2e3742')); R(-12, -52, 24, 6, ec);
  R(-80, -36, 28, 22, c('#4a5668')); R(52, -36, 28, 22, c('#4a5668')); R(-76, -14, 14, 50 + sw, c('#3b4756')); R(62, -14, 14, 50 - sw, c('#3b4756')); R(-82, 36 + sw, 26, 12, '#222a33'); R(56, 36 - sw, 26, 12, '#222a33');
  ctx.restore();
}
function fxMech() {
  const L = B.lz; if (!L) return;
  ctx.save(); ctx.beginPath(); ctx.rect(M, M, W - 2 * M, H - 2 * M); ctx.clip();
  for (const o of (L.dual ? [0, Math.PI] : [0])) {
    const line = (a) => { ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(B.x + Math.cos(a) * 1100, B.y + Math.sin(a) * 1100); ctx.stroke(); };
    if (!L.on) { ctx.strokeStyle = 'rgba(255,80,60,.55)'; ctx.lineWidth = 2; line(L.a + o); line(L.end + o); }
    else { ctx.strokeStyle = 'rgba(255,60,40,.5)'; ctx.lineWidth = 26; line(L.a + o); ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; line(L.a + o); }
  }
  ctx.restore();
}

/* ---------- Rei Fungo ---------- */
function* toxic(n, r) { sound.play('warn');
  for (let i = 0; i < n; i++) { B.zn.push({ x: i % 2 ? rnd(M + r, W - M - r) : clamp(P.x + P.vx * .3, M + r, W - M - r), y: i % 2 ? rnd(M + r, H - M - r) : clamp(P.y + P.vy * .3, M + r, H - M - r), r, t: 0, warn: .55, life: 8 }); while (B.zn.length > 9) B.zn.shift(); yield .35; }
  yield 1;
}
function* spores(n) {
  yield* warn('pulse', .38);
  for (let i = 0; i < n; i++) { shootE(B.x, B.y, aim() + rnd(-1.3, 1.3), 225, 10, '#a8ff50'); const b = eb[eb.length - 1]; b.hm = 1.8; b.life = 7; b.hl = 2.5; yield .16; }
  yield 1;
}
function* roots(n) {
  for (let i = 0; i < n; i++) { haz.push({ x: clamp(P.x + rnd(-45, 45), M + 40, W - M - 40), y: clamp(P.y + rnd(-45, 45), M + 40, H - M - 40), r: 65, t: 0, delay: .5, cnt: 0 }); yield .5; }
  yield .8;
}
function* summon(n) { yield* warn('pulse', .38); for (let i = 0; i < n; i++) if (B.mi.length < 8) B.mi.push({ x: B.x + rnd(-60, 60), y: B.y + 50, r: 15, hp: 64 }); yield 1.2; }
function drawKing() {
  const hit = B.hitT > 0, ec = PCOL[B.phase], c = k => hit ? '#fff' : k;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(B.x, B.y + 62, 62, 14, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(Math.round(B.x), Math.round(B.y + Math.sin(B.t * 2.5) * 3));
  for (let i = -3; i <= 3; i++) R(i * 12 - 4, 48, 8, 12 + ((i & 1) ? 8 : 0), c('#4a3d2a'));
  R(-34, -10, 68, 60, c('#6b5a40')); R(-26, -6, 52, 52, c('#8a7656'));
  const sw = Math.sin(B.t * 2) * 5; R(-64, -4 + sw, 30, 14, c('#6b5a40')); R(34, -4 - sw, 30, 14, c('#6b5a40')); R(-70, 6 + sw, 10, 18, c('#4a3d2a')); R(60, 6 - sw, 10, 18, c('#4a3d2a'));
  ctx.fillStyle = c('#7a2a6a'); ctx.beginPath(); ctx.ellipse(0, -32, 60, 36, 0, Math.PI, TAU); ctx.fill(); R(-60, -34, 120, 8, c('#5a1f4e'));
  ctx.fillStyle = c('#e8c8f0'); for (const [x, y, r] of [[-32, -50, 7], [10, -62, 9], [36, -46, 6]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  R(-16, -22, 10, 8, ec); R(6, -22, 10, 8, ec); R(-10, 0, 20, 4, '#201018');
  ctx.fillStyle = ec; for (let i = 0; i < 6; i++) ctx.fillRect(Math.sin(B.t * 1.3 + i * 1.7) * 70, -70 - ((B.t * 30 + i * 20) % 60), 3, 3);
  ctx.restore();
}
function fxFungo() {
  for (const z of B.zn) {
    const on = z.t > z.warn, fade = clamp((z.warn + z.life - z.t) / .8, 0, 1);
    if (!on) { ctx.strokeStyle = 'rgba(168,255,80,.6)'; ctx.setLineDash([8, 8]); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = `rgba(110,220,50,${(.3 + .08 * Math.sin(time * 6)) * fade})`; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill(); ctx.strokeStyle = `rgba(200,255,100,${.8 * fade})`; ctx.lineWidth = 3; ctx.stroke(); }
  }
  for (const m of B.mi) { ctx.save(); ctx.translate(Math.round(m.x), Math.round(m.y)); R(-4, -2, 8, 12, '#ddd'); R(-12, -12, 24, 11, '#c04060'); R(-6, -9, 4, 4, '#fff'); R(3, -7, 3, 3, '#fff'); R(-3, 2, 2, 2, '#111'); R(2, 2, 2, 2, '#111'); ctx.restore(); }
}

/* ---------- Imperatriz do Vazio ---------- */
function* portals(n, vol) {
  while (B.pt.length > 3) B.pt.shift();
  for (let i = 0; i < n; i++) {
    const by = P.y < H / 2 ? H - M - 30 : M + 30, bx = rnd(M + 40, W - M - 40);
    B.pt.push({ ax: clamp(B.x + rnd(-200, 200), M + 40, W - M - 40), ay: clamp(B.y + rnd(70, 140), M + 30, H - M - 30), bx, by, ang: Math.atan2(P.y - by, P.x - bx) + rnd(-.25, .25), t: 0, life: 8 }); yield .3;
  }
  yield .4;
  for (let k = 0; k < vol; k++) { for (const p of B.pt) for (let j = -1; j <= 1; j++) shootE(B.x, B.y, Math.atan2(p.ay - B.y, p.ax - B.x) + j * .02, 180, 6, '#c080ff'); yield .5; }
  yield 1.2;
}
function* splitters(n) {
  yield* warn('pulse', .38);
  for (let i = 0; i < n; i++) { shootE(B.x, B.y, aim() + rnd(-.5, .5), 150, 9, '#d0a0ff'); eb[eb.length - 1].spt = 1.0; yield .5; }
  yield 1;
}
function* nova(n) {
  const o = rnd(0, 1);
  for (let i = 0; i < n; i++) { const a = i * TAU / n + o; haz.push({ x: clamp(P.x + Math.cos(a) * 130, M + 40, W - M - 40), y: clamp(P.y + Math.sin(a) * 130, M + 40, H - M - 40), r: 70, t: 0, delay: .9, cnt: 8 }); yield .3; }
  yield 1.2;
}
function* wave(n) {
  yield* warn('pulse', .32);
  for (let k = 0; k < n; k++) {
    const vert = k % 2 === 0, gap = vert ? rnd(M + 80, W - M - 190) : rnd(M + 80, H - M - 190), flip = (k >> 1) % 2 === 0;
    if (vert) { const y0 = flip ? M + 8 : H - M - 8; for (let x = M + 14; x < W - M; x += 28) if (x < gap || x > gap + 110) eb.push({ x, y: y0, vx: 0, vy: flip ? 140 : -140, r: 7, col: '#c080ff', life: 8 }); }
    else { const x0 = flip ? M + 8 : W - M - 8; for (let y = M + 14; y < H - M; y += 28) if (y < gap || y > gap + 110) eb.push({ x: x0, y, vx: flip ? 140 : -140, vy: 0, r: 7, col: '#c080ff', life: 8 }); }
    yield 1.4;
  }
  yield 1;
}
function* dimension() { yield* portals(2, 2); yield* wave(2); yield* splitters(3); }
function drawEmp() {
  const hit = B.hitT > 0, ec = PCOL[B.phase], c = k => hit ? '#fff' : k;
  ctx.fillStyle = 'rgba(80,40,160,.3)'; ctx.beginPath(); ctx.ellipse(B.x, B.y + 56, 50, 12, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(Math.round(B.x), Math.round(B.y + Math.sin(B.t * 2) * 4));
  ctx.fillStyle = c('#1a1040'); ctx.beginPath(); ctx.moveTo(-18, -20); ctx.lineTo(18, -20); ctx.lineTo(56, 54); ctx.lineTo(-56, 54); ctx.closePath(); ctx.fill();
  for (let i = 0; i < 9; i++) { ctx.fillStyle = `rgba(255,255,255,${.4 + .5 * Math.sin(B.t * 3 + i)})`; ctx.fillRect(((i * 37) % 80) - 40, ((i * 53) % 60) - 6, 2, 2); }
  R(-14, -24, 28, 40, c('#2a1a60')); R(-16, -56, 32, 34, c('#10082a')); R(-10, -48, 20, 22, c('#f0e0ff')); R(-7, -40, 4, 6, ec); R(3, -40, 4, 6, ec);
  R(-12, -66, 4, 12, ec); R(8, -66, 4, 12, ec); R(-2, -72, 4, 16, ec);
  for (const s of [-1, 1]) { const x = s * (58 + Math.sin(B.t * 2 + s) * 6), y = -6; R(s > 0 ? 14 : -44, -16, 30, 8, c('#2a1a60')); ctx.strokeStyle = ec; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, 12, 17, 0, 0, TAU); ctx.stroke(); R(x - 3, y - 3, 6, 6, '#fff'); }
  ctx.restore();
}
function fxVoid() {
  for (const p of B.pt) {
    const k = Math.min(1, p.t / .8), fade = clamp((p.life - p.t) / .6, 0, 1); ctx.globalAlpha = fade;
    ctx.strokeStyle = 'rgba(200,160,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(p.ax, p.ay); ctx.lineTo(p.bx, p.by); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#60e0ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(p.ax, p.ay, 22 * k, 22 * k, 0, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#ff70e0'; ctx.beginPath(); ctx.ellipse(p.bx, p.by, 22 * k, 22 * k, 0, 0, TAU); ctx.stroke();

    ctx.globalAlpha = 1;
  }
}

/* ---------- Definições dos novos bosses ---------- */
Object.assign(BOSSES, {
  matriarca: { name: 'Matriarca Mecânica', desc: ['Fábrica. Blindada: só o núcleo', 'aberto sofre dano de verdade.'], hp: 3000, r: 56, pcol: ['', '#ffb030', '#ff6020', '#ff2030'], pause: [0, 1.2, .9, .6],
    att: { 1: [() => missiles(3), () => laser(false), () => smash(2), () => rain(3, 1.6, 8)], 2: [() => missiles(5), () => laser(false), () => smash(3), () => rain(5, 1.5, 10)], 3: [() => missiles(6), () => laser(true), mixed, () => rain(6, 1.3, 10)] },
    obs: mkObs([[260, 170], [700, 170], [260, 470], [700, 470]], ['mach']), tile: (s, w) => w ? `rgb(${s + 10},${s + 14},${s + 22})` : `rgb(${s - 6},${s - 2},${s + 6})`, dark: 'rgba(4,6,10,.7)', flame: '#ffb030', draw: drawMech, fx: fxMech,
    dmg: () => B.core > 0 ? 1.8 : .25, clr() { B.lz = null; },
    deco(g) { for (const y of [210, 420]) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(M, y, W - 2 * M, 34); for (let x = M; x < W - M; x += 28) { g.fillStyle = '#b8a020'; g.fillRect(x, y + 4, 10, 5); g.fillRect(x + 14, y + 24, 10, 5); } }
      for (const [x, y] of [[130, 330], [830, 330]]) { g.fillStyle = 'rgba(0,0,0,.4)'; for (let k = 0; k < 8; k++) { g.save(); g.translate(x, y); g.rotate(k * TAU / 8); g.fillRect(-6, -34, 12, 68); g.restore(); } g.beginPath(); g.arc(x, y, 24, 0, TAU); g.fill(); } },
    upd(dt) { B.core -= dt; const L = B.lz; if (L && L.on) { L.a += L.dir * L.spd * dt; if (L.dir * (L.a - L.end) >= 0) L.a = L.end; if (laserHit(L.a) || (L.dual && laserHit(L.a + Math.PI))) hurt(); } } },
  fungo: { name: 'Rei Fungo', desc: ['Caverna tóxica. O chão se contamina:', 'Esporos e criaturas hostis.'], hp: 4400, r: 52, pcol: ['', '#a8ff50', '#d0ff30', '#ff70e0'], pause: [0, .35, .22, .14],
    att: { 1: [() => toxic(4, 105), () => spores(7), () => roots(6), () => summon(3), () => rain(5, .7, 8)], 2: [() => toxic(6, 115), () => spores(9), () => roots(5), () => summon(3), () => rain(4, 1.8, 10)], 3: [() => toxic(8, 120), () => spores(12), () => roots(7), () => summon(4), () => rain(5, 1.6, 10)] },
    obs: mkObs([[250, 200], [710, 200], [250, 440], [710, 440]], ['shroom']), tile: (s, w) => w ? `rgb(${s + 8},${s - 4},${s + 10})` : `rgb(${s - 10},${s + 2},${s - 2})`, dark: 'rgba(2,8,6,.72)', flame: '#9aff60', draw: drawKing, fx: fxFungo,
    clr() { B.zn.length = 0; B.mi.length = 0; },
    upd(dt) {
      for (let i = B.zn.length - 1; i >= 0; i--) { const z = B.zn[i]; z.t += dt; if (z.t > z.warn + z.life) B.zn.splice(i, 1); else if (z.t > z.warn && Math.hypot(P.x - z.x, P.y - z.y) < z.r + 2) { hurt(); if (state !== 'play') return; } }
      for (let i = B.mi.length - 1; i >= 0; i--) {
        const m = B.mi[i], a = Math.atan2(P.y - m.y, P.x - m.x); m.x += Math.cos(a) * (125 + B.phase * 15) * dt; m.y += Math.sin(a) * (125 + B.phase * 15) * dt; resolve(m);
        if (Math.hypot(P.x - m.x, P.y - m.y) < m.r + P.r * .7) { hurt(); if (state !== 'play') return; m.hp = 0; }
        if (m.hp <= 0) { burst(m.x, m.y, 14, '#a8ff50', 220, 4, .5); B.mi.splice(i, 1); }
      } } },
  imperatriz: { name: 'Imperatriz do Vazio', desc: ['Templo cósmico. Portais redirecionam', 'e distorções dimensionais.'], hp: 4100, r: 40, pcol: ['', '#c080ff', '#ff80e0', '#ffffff'], pause: [0, .35, .22, .12],
    att: { 1: [() => portals(1, 3), () => splitters(3), () => nova(5), () => wave(2)], 2: [() => portals(2, 3), () => splitters(4), () => nova(6), () => wave(3), () => portals(2, 2)], 3: [() => portals(3, 4), () => splitters(5), () => nova(8), () => wave(4), dimension] },
    obs: mkObs([[300, 210], [660, 210], [300, 430], [660, 430]], ['crys']), tile: (s, w) => w ? `rgb(${s - 4},${s - 6},${s + 22})` : `rgb(${s - 12},${s - 14},${s + 10})`, dark: 'rgba(4,2,16,.62)', flame: '#c080ff', draw: drawEmp, fx: fxVoid,
    clr() { B.pt.length = 0; },
    deco(g) { for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(200,200,255,${rnd(.1, .6)})`; g.fillRect(rnd(M, W - M), rnd(M, H - M), 2, 2); }
      for (const [x, y, rx] of [[170, 150, 40], [790, 170, 34], [160, 500, 36], [800, 490, 44]]) { g.fillStyle = 'rgba(60,40,120,.5)'; g.beginPath(); g.ellipse(x, y, rx, rx * .4, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(150,110,255,.3)'; g.fillRect(x - rx, y - 2, rx * 2, 3); } },
    upd(dt) {
      for (let i = B.pt.length - 1; i >= 0; i--) {
        const p = B.pt[i]; p.t += dt; if (p.t > p.life) { B.pt.splice(i, 1); continue; }
        if (p.t > .8) for (const b of eb) if (!b.tp && Math.hypot(b.x - p.ax, b.y - p.ay) < 22) { const sp = Math.hypot(b.vx, b.vy); b.x = p.bx + Math.cos(p.ang) * 20; b.y = p.by + Math.sin(p.ang) * 20; b.vx = Math.cos(p.ang) * sp; b.vy = Math.sin(p.ang) * sp; b.tp = true; burst(p.ax, p.ay, 6, '#c080ff', 150, 3, .3); burst(p.bx, p.by, 6, '#ff80e0', 150, 3, .3); }
      }
      for (let i = eb.length - 1; i >= 0; i--) { const b = eb[i]; if (b.spt !== undefined) { b.spt -= dt; if (b.spt <= 0) { haz.push({ x: b.x, y: b.y, r: 115, t: 0, delay: .35, cnt: 6 }); eb.splice(i, 1); } } }
    } }
});

/* ---------- Seleção de boss ---------- */

function inCard(i) { const r = cardRect(i); return mouse.x > r.x && mouse.x < r.x + r.w && mouse.y > r.y && mouse.y < r.y + r.h; }
function preview(id, cx, cy) {
  const sB = B, sD = def, sP = PCOL; def = BOSSES[id]; PCOL = def.pcol;
  B = { x: 0, y: 0, t: time, hitT: 0, phase: 1, tele: null, vuln: 0, swT: 0, r: def.r };
  ctx.save(); ctx.translate(cx, cy); ctx.scale(.5, .5); def.draw(); ctx.restore();
  B = sB; def = sD; PCOL = sP;
}

function pickCard() { ORDER.forEach((id, i) => { if (inCard(i)) start(id); }); }

/* ---------- Arsenal, progresso e áudio ---------- */
const SAVE_KEY = 'arena-bosses-arsenal-v1';
const WEAPONS = [
  { name: 'METRALHADORA', short: 'AUTO', damage: 8, cd: .095, speed: 820, range: 850, spread: .035, pellets: 1, color: '#ffcf63', kick: 1.3 },
  { name: 'ESCOPETA', short: 'ESCOPETA', damage: 12, cd: .8, speed: 720, range: 350, spread: .30, pellets: 8, color: '#ff9966', kick: 5 },
  { name: 'RIFLE', short: 'RIFLE', damage: 100, cd: 1.25, speed: 1450, range: 1100, spread: 0, pellets: 1, color: '#79e8ff', kick: 4 },
  { name: 'LANÇA-FOGUETES', short: 'FOGUETE', damage: 140, cd: 1.9, speed: 370, range: 720, spread: 0, pellets: 1, color: '#bbff82', kick: 6, blast: 100 }
];
let saved = { records: {}, audio: { music: .35, sfx: .65, muted: false } };
try {
  const raw = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (raw && typeof raw === 'object') {
    for (const id of ORDER) {
      const r = raw.records && raw.records[id];
      if (r && Number.isFinite(r.bestTime) && r.bestTime >= 0 && Number.isFinite(r.leastDamage) && r.leastDamage >= 0)
        saved.records[id] = { bestTime: r.bestTime, leastDamage: r.leastDamage, flawless: r.flawless === true, wins: Math.max(1, Math.floor(r.wins) || 1) };
    }
    if (raw.audio) for (const key of ['music', 'sfx']) if (Number.isFinite(raw.audio[key])) saved.audio[key] = clamp(raw.audio[key], 0, 1);
    saved.audio.muted = raw.audio?.muted === true;
  }
} catch { /* Storage may be blocked or contain an old save. */ }
for (const id of ORDER) if (saved.records[id]) won[id] = true;
let run = { elapsed: 0, damage: 0, recorded: false }, musicClock = 0, musicStep = 0;
function saveProgress() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch { /* Play remains available. */ } }
function formatTime(t) { return Math.floor(t / 60) + ':' + (t % 60).toFixed(1).padStart(4, '0'); }
function recordWin() {
  if (run.recorded) return;
  run.recorded = true; won[cur] = true;
  const old = saved.records[cur];
  saved.records[cur] = { bestTime: Math.min(old?.bestTime ?? Infinity, run.elapsed), leastDamage: Math.min(old?.leastDamage ?? Infinity, run.damage), flawless: !!old?.flawless || run.damage === 0, wins: (old?.wins || 0) + 1 };
  saveProgress();
}
const sound = {
  ac: null, master: null, fx: null, music: null, noise: null, voices: 0, last: {},
  init() {
    try {
      if (!this.ac) {
        const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return;
        this.ac = new Audio(); this.master = this.ac.createGain(); this.fx = this.ac.createGain(); this.music = this.ac.createGain();
        const comp = this.ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5;
        this.fx.connect(this.master); this.music.connect(this.master); this.master.connect(comp); comp.connect(this.ac.destination);
        this.noise = this.ac.createBuffer(1, this.ac.sampleRate, this.ac.sampleRate);
        const data = this.noise.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.apply();
      }
      if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    } catch { /* Audio unavailable: keep playing silently. */ }
  },
  apply() {
    if (!this.ac) return;
    this.master.gain.setTargetAtTime(saved.audio.muted ? 0 : .55, this.ac.currentTime, .02);
    this.fx.gain.setTargetAtTime(saved.audio.sfx, this.ac.currentTime, .02);
  },
  note(freq, duration, type = 'sine', volume = .1, end = freq, music = false, delay = 0) {
    if (!this.ac || this.ac.state !== 'running' || this.voices >= 28 || saved.audio.muted) return;
    const t = this.ac.currentTime + delay, g = this.ac.createGain(); let source;
    if (type === 'noise') {
      source = this.ac.createBufferSource(); source.buffer = this.noise;
      const filter = this.ac.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = freq; source.connect(filter); filter.connect(g);
      source.onended = () => { this.voices--; source.disconnect(); filter.disconnect(); g.disconnect(); };
    } else {
      source = this.ac.createOscillator(); source.type = type; source.frequency.setValueAtTime(freq, t); source.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration); source.connect(g);
      source.onended = () => { this.voices--; source.disconnect(); g.disconnect(); };
    }
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.001, volume), t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
    g.connect(music ? this.music : this.fx); this.voices++; source.start(t); source.stop(t + duration + .02);
  },
  play(kind) {
    if (!this.ac) return;
    const now = this.ac.currentTime, limits = { hit: .07, armor: .12, enemy: .13, blast: .12, warn: .12 };
    if (now - (this.last[kind] ?? -100) < (limits[kind] || .035)) return; this.last[kind] = now;
    const n = (...a) => this.note(...a);
    if (kind === 'gun0') { n(1800, .065, 'noise', .12); n(130, .07, 'triangle', .10, 60); }
    else if (kind === 'gun1') { n(2300, .19, 'noise', .3); n(110, .17, 'triangle', .28, 35); }
    else if (kind === 'gun2') { n(2000, .12, 'sawtooth', .12, 90); n(3200, .15, 'noise', .22); }
    else if (kind === 'gun3') { n(500, .3, 'noise', .25); n(180, .3, 'triangle', .22, 45); }
    else if (kind === 'blast' || kind === 'impact') { n(750, .3, 'noise', .25); n(75, .3, 'sine', .28, 25); }
    else if (kind === 'dash') n(170, .18, 'triangle', .18, 750);
    else if (kind === 'hurt') { n(160, .28, 'sawtooth', .2, 40); n(800, .15, 'noise', .15); }
    else if (kind === 'hit') n(520, .04, 'triangle', .07, 220);
    else if (kind === 'armor') n(1800, .08, 'sine', .09, 1100);
    else if (kind === 'warn') { n(440, .12, 'sine', .14); n(660, .12, 'sine', .13, 660, false, .14); }
    else if (kind === 'duel') { n(1400, .23, 'square', .16, 850); }
    else if (kind === 'enemy') n(260, .08, 'triangle', .10, 120);
    else if (kind === 'teleport') n(240, .45, 'sine', .2, 1400);
    else if (kind === 'phase') { n(90, .65, 'sawtooth', .17, 220); n(650, .4, 'noise', .12); }
    else if (kind === 'win') [262, 330, 392, 523].forEach((f, i) => n(f, .45, 'triangle', .20, f, false, i * .16));
    else if (kind === 'lose') [220, 185, 147, 110].forEach((f, i) => n(f, .4, 'triangle', .17, f, false, i * .16));
    else if (kind === 'switch') n(600, .055, 'sine', .08, 900);
  },
  update(dt) {
    if (!this.ac) return;
    const active = state === 'play' && !B.dead, duck = B.duel ? (B.duelGo ? .08 : .025) : 1;
    this.music.gain.setTargetAtTime(active ? saved.audio.music * duck : 0, this.ac.currentTime, .12);
    if (!active || saved.audio.muted || saved.audio.music <= 0) return;
    musicClock -= dt; if (musicClock > 0) return;
    const themes = { chumbo: [73.42, .23, 'sawtooth'], fantasma: [82.41, .30, 'triangle'], colosso: [65.41, .32, 'sine'], matriarca: [61.74, .20, 'square'], fungo: [87.31, .34, 'sine'], imperatriz: [98, .27, 'triangle'] };
    const [root, beat, type] = themes[cur], step = musicStep++ % 16, scale = [0, 7, 10, 7, 3, 7, 12, 10];
    musicClock += beat / (1 + (B.phase - 1) * .06);
    this.note(root * Math.pow(2, scale[step % 8] / 12), .22, type, .10, root, true);
    if (step % 4 === 0) { this.note(90, .18, 'sine', .25, 30, true); this.note(root * 4, .8, 'sine', .06, root * 4, true); }
    if (step % 2) this.note(2300, .045, 'noise', .05, 2300, true);
    if (step % 4 === 2) this.note(850, .09, 'noise', .08, 850, true);
  }
};
function setupAudio() {
  const panel = document.getElementById('audio-panel'), toggle = document.getElementById('audio-toggle');
  let wasPlaying = false;
  function close() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); if (wasPlaying && state === 'pause') state = 'play'; wasPlaying = false; toggle.focus(); }
  function open() { sound.init(); panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); wasPlaying = state === 'play'; if (wasPlaying) state = 'pause'; clearInput(); document.getElementById('music-volume').focus(); }
  toggle.addEventListener('click', () => panel.hidden ? open() : close());
  document.getElementById('audio-close').addEventListener('click', close);
  for (const name of ['music', 'sfx']) {
    const input = document.getElementById(name + '-volume'), output = document.getElementById(name + '-value');
    input.value = Math.round(saved.audio[name] * 100); output.textContent = input.value + '%';
    input.addEventListener('input', () => { saved.audio[name] = +input.value / 100; output.textContent = input.value + '%'; sound.apply(); saveProgress(); });
  }
  const mute = document.getElementById('muted'); mute.checked = saved.audio.muted;
  mute.addEventListener('change', () => { saved.audio.muted = mute.checked; sound.apply(); saveProgress(); });
  window.addEventListener('keydown', e => { if (e.code === 'KeyO' && !e.repeat) { e.preventDefault(); panel.hidden ? open() : close(); } else if (e.code === 'Escape' && !panel.hidden) { e.stopImmediatePropagation(); close(); } }, true);
}
function clearInput() { mouse.l = mouse.r = false; for (const k in keys) keys[k] = false; }
function reset(id) {
  if (id) cur = id; def = BOSSES[cur]; PCOL = def.pcol; PAUSE = def.pause; PILLARS = def.obs; buildFloor();
  P = { x: W / 2, y: H - 130, r: 11, hp: 5, inv: 0, vx: 0, vy: 0, dashT: 0, dashCd: 0, lastDashAt: -Infinity, dashRefunded: false, dvx: 0, dvy: 0, fireCd: 0, rec: 0, flashT: 0, walk: 0, face: -Math.PI / 2, weapon: 0, cooldowns: [0, 0, 0, 0], swapCd: 0 };
  B = { x: W / 2, y: 170, r: def.r, hp: def.hp, max: def.hp, shown: def.hp, vuln: 0, swT: 0, lz: null, core: 0, zn: [], mi: [], pt: [], duel: 0, duelA: 0, duelGo: false, parried: false, phase: 1, gen: null, wait: 1.8, hitT: 0, dead: false, deathT: 0, charging: false, cvx: 0, cvy: 0, chLeft: 0, chBoss: false, tele: null, phaseMsg: 0, last: -1, t: 0, tp: null, moveTarget: null, moveCd: 0 };
  pb = []; eb = []; haz = []; impacts = []; parts = []; ghosts = []; shake = 0; flash = 0; stateT = 0;
  run = { elapsed: 0, damage: 0, recorded: false }; musicClock = 0; musicStep = 0; clearInput();
}
function start(id) { sound.init(); reset(id); state = 'play'; cv.focus(); }
function clearBossAttacks() {
  B.gen = null; B.charging = false; B.tele = null; B.duel = 0; B.duelGo = false; B.duelA = 0; B.tp = null;
  B.lz = null; B.zn.length = 0; B.mi.length = 0; B.pt.length = 0; B.swT = 0;
  if (def.clr) def.clr(); eb.length = 0; haz.length = 0; impacts.length = 0;
}
function killBoss() {
  if (B.dead) return;
  B.hp = 0; B.dead = true; B.deathT = 0; clearBossAttacks(); pb.length = 0; shake = 20; flash = .4; recordWin(); sound.play('blast');
}
function damageBoss(amount, effects = true) {
  if (B.dead || state !== 'play') return;
  B.hp = Math.max(0, B.hp - amount * (B.vuln > 0 ? 1.6 : 1) * (def.dmg ? def.dmg() : 1)); B.hitT = .08;
  if (effects) sound.play(cur === 'matriarca' && B.core <= 0 ? 'armor' : 'hit');
  if (B.hp <= 0) killBoss();
}
function hurt(n = 1) {
  if (P.inv > 0 || state !== 'play' || B.dead || P.hp <= 0) return false;
  run.damage += Math.min(n, P.hp); P.hp = Math.max(0, P.hp - n); P.inv = .85; shake = Math.max(shake, 12); flash = .35;
  sound.play('hurt'); burst(P.x, P.y, 16, '#ff4040', 200, 4);
  if (P.hp <= 0) { state = 'lose'; stateT = 0; burst(P.x, P.y, 40, '#cc3333', 300, 5); clearBossAttacks(); pb.length = 0; clearInput(); sound.play('lose'); }
  return true;
}
function burst(x, y, n, col, sp, sz, life = .5) {
  n = Math.min(n, 650 - parts.length);
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(sp * .3, sp); parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * .5, life), max: life, sz: rnd(sz * .6, sz), col }); }
}
function ringFx(x, y, max, col) { if (parts.length < 700) parts.push({ k: 1, x, y, r: 4, max, life: .4, mx: .4, col }); }
function shootE(x, y, a, sp, r = 6, col = '#ff7a2a') { if (B.dead) return; sound.play('enemy'); eb.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: Math.max(7, r), col, life: 8 }); }
function safeSpot(x, y, r, distance = 0) {
  return x >= M + r && x <= W - M - r && y >= M + r && y <= H - M - r && Math.hypot(x - P.x, y - P.y) >= distance && !PILLARS.some(p => Math.hypot(x - clamp(x, p.x, p.x + p.w), y - clamp(y, p.y, p.y + p.h)) < r - .01);
}
function resolve(e) {
  for (let pass = 0; pass < 3; pass++) {
    e.x = clamp(e.x, M + e.r, W - M - e.r); e.y = clamp(e.y, M + e.r, H - M - e.r);
    for (const p of PILLARS) {
      const cx = clamp(e.x, p.x, p.x + p.w), cy = clamp(e.y, p.y, p.y + p.h), dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy);
      if (d >= e.r) continue;
      if (d > .001) { e.x = cx + dx / d * e.r; e.y = cy + dy / d * e.r; }
      else { const choices = [[Math.abs(e.x - p.x), p.x - e.r, e.y], [Math.abs(e.x - p.x - p.w), p.x + p.w + e.r, e.y], [Math.abs(e.y - p.y), e.x, p.y - e.r], [Math.abs(e.y - p.y - p.h), e.x, p.y + p.h + e.r]].sort((a,b) => a[0]-b[0]); e.x = choices[0][1]; e.y = choices[0][2]; }
    }
  }
}
function choosePosition(minDistance = 180) {
  for (let i = 0; i < 50; i++) { const x = rnd(M + B.r + 10, W - M - B.r - 10), y = rnd(M + B.r + 10, H - M - B.r - 10); if (safeSpot(x, y, B.r, minDistance)) return { x, y }; }
  return { x: B.x, y: B.y };
}
function walkBoss(tx, ty, speed, dt) {
  const a = Math.atan2(ty - B.y, tx - B.x), step = Math.min(speed * dt, Math.hypot(tx - B.x, ty - B.y));
  const oldX = B.x, oldY = B.y; B.x += Math.cos(a) * step; B.y += Math.sin(a) * step; resolve(B);
  if (Math.hypot(B.x-oldX, B.y-oldY) < step * .3 && step > .1) {
    B.x += Math.cos(a + Math.PI / 2) * step; B.y += Math.sin(a + Math.PI / 2) * step; resolve(B);
  }
}
function moveBoss(dt) {
  if (B.lz || B.duel || B.vuln > 0 || B.core > 0 || B.swT > 0 || B.phaseMsg > 0) return;
  // Fixar a origem apenas durante o preparo de uma área de dano.
  if (B.tele && ['cone', 'ring', 'charge', 'arc'].includes(B.tele.kind)) return;
  B.moveCd -= dt;
  if (cur === 'imperatriz') {
    if (B.moveCd <= 0) {
      const dest = choosePosition(180);
      burst(B.x, B.y, 25, '#c080ff', 180, 4);
      B.x = dest.x; B.y = dest.y; B.moveCd = rnd(1.4, 2.3) / (1 + B.phase * .12);
      burst(B.x, B.y, 20, '#ff80e0', 200, 4); sound.play('teleport');
    }
    const a = aim() + Math.PI / 2;
    walkBoss(B.x + Math.cos(a) * 100, B.y + Math.sin(a) * 100, 115 + B.phase * 15, dt);
    return;
  }
  if (cur === 'colosso') { if (Math.hypot(P.x-B.x,P.y-B.y)>140) walkBoss(P.x,P.y,75+B.phase*12,dt); return; }
  if (cur === 'fantasma') {
    const a = aim(), d = Math.hypot(P.x-B.x,P.y-B.y), radial = d < 270 ? -1 : d > 360 ? .6 : 0, side = Math.sin(B.t * .35) > 0 ? 1 : -1;
    walkBoss(B.x + Math.cos(a)*radial*100 + Math.cos(a+Math.PI/2)*side*80, B.y + Math.sin(a)*radial*100 + Math.sin(a+Math.PI/2)*side*80, 175 + B.phase * 12, dt); return;
  }
  if (!B.moveTarget || B.moveCd <= 0 || Math.hypot(B.x-B.moveTarget.x,B.y-B.moveTarget.y) < 15) { B.moveTarget = choosePosition(cur === 'fungo' ? 210 : 240); B.moveCd = cur === 'matriarca' ? 7 : 4; }
  walkBoss(B.moveTarget.x, B.moveTarget.y, cur === 'matriarca' ? 45 : cur === 'fungo' ? 105 + B.phase * 12 : 125, dt);
}
function updateBoss(dt) {
  B.t += dt; B.hitT -= dt; B.phaseMsg -= dt; B.shown += (B.hp - B.shown) * Math.min(1, dt * 4);
  if (B.hp <= 0 && !B.dead) killBoss();
  if (B.dead) {
    B.deathT += dt;
    if (Math.random() < dt * 18) { const x = B.x + rnd(-50, 50), y = B.y + rnd(-50, 50); burst(x,y,14,'#ffb040',260,5,.8); ringFx(x,y,50,'#ffa040'); shake = Math.max(shake,6); }
    if (B.deathT > 3) { burst(B.x,B.y,80,'#fff',500,6,1); state='win'; stateT=0; sound.play('win'); clearInput(); }
    return;
  }
  B.vuln -= dt; B.swT -= dt;
  const ph = phaseOf(B.hp / B.max);
  if (ph > B.phase) {
    clearBossAttacks(); B.phase=ph; B.last=-1; B.vuln=0; B.core=0; B.wait=1.7; B.phaseMsg=1.7;
    shake=16; flash=.3; burst(B.x,B.y,60,PCOL[ph],420,6,1); ringFx(B.x,B.y,200,PCOL[ph]); sound.play('phase');
  }
  if (def.upd) def.upd(dt); if (state !== 'play' || B.dead) return;
  if (B.tele) {
    B.tele.t -= dt;
    if (B.tele.t > .3 && ['cone','line','charge','arc'].includes(B.tele.kind)) B.tele.ang=aim();
    B.tele.len=rayLen(B.x,B.y,Math.cos(B.tele.ang),Math.sin(B.tele.ang),B.r);
  }
  if (B.charging) {
    const st=Math.min(620*dt,B.chLeft), steps=Math.max(1,Math.ceil(st/6));
    for (let i=0;i<steps;i++) {
      const nx=B.x+Math.cos(B.chAng)*st/steps, ny=B.y+Math.sin(B.chAng)*st/steps;
      if (!safeSpot(nx,ny,B.r)) { B.chLeft=0; break; }
      B.x=nx; B.y=ny; B.chLeft-=st/steps;
      if (Math.hypot(P.x-B.x,P.y-B.y)<B.r+P.r*.7) hurt();
      if (state!=='play') return;
    }
    burst(B.x,B.y+20,1,'#aaa',60,4,.4);
    if (B.chLeft<=.5) { B.charging=false; shake=14; sound.play('impact'); ringFx(B.x,B.y,90,'#fff'); burst(B.x,B.y,24,'#bbb',260,5); if(B.chBoss) areaHit(B.x,B.y,90,0,Math.PI,PCOL[B.phase]); }
  } else moveBoss(dt);
  if (B.wait>0) { B.wait-=dt; return; }
  if (B.charging || B.tp) return;
  if (!B.gen) B.gen=pickAttack();
  const gen = B.gen, r=gen.next();
  if (B.dead || state!=='play') return;
  if (r.done) { B.gen=null; B.wait=PAUSE[B.phase]; } else B.wait=r.value;
}
function switchWeapon(index) {
  if (state !== 'play' || B.dead || index === P.weapon) return;
  P.weapon = (index + WEAPONS.length) % WEAPONS.length; P.swapCd = .16; sound.play('switch');
}
function fire() {
  const w = WEAPONS[P.weapon]; P.cooldowns[P.weapon]=w.cd; P.fireCd=w.cd;
  for(let i=0;i<w.pellets;i++) {
    const a=P.face+(w.pellets>1 ? (i/(w.pellets-1)-.5)*w.spread*2+rnd(-.018,.018) : rnd(-w.spread,w.spread));
    pb.push({x:P.x,y:P.y,vx:Math.cos(a)*w.speed,vy:Math.sin(a)*w.speed,life:w.range/w.speed,damage:w.damage,weapon:P.weapon,range:w.range,travel:0,blast:w.blast||0,color:w.color,r:P.weapon===3?5:2});
  }
  P.rec=1; P.flashT=.06; P.x-=Math.cos(P.face)*w.kick; P.y-=Math.sin(P.face)*w.kick; resolve(P); shake=Math.max(shake,P.weapon===0?1.2:3);
  burst(P.x+Math.cos(P.face)*28,P.y+Math.sin(P.face)*28,P.weapon===1?10:3,w.color,160,3,.2); sound.play('gun'+P.weapon);
}
function updatePlayer(dt) {
  let ax=(keys.KeyD?1:0)-(keys.KeyA?1:0), ay=(keys.KeyS?1:0)-(keys.KeyW?1:0); const l=Math.hypot(ax,ay); if(l){ax/=l;ay/=l;}
  P.face=Math.atan2(mouse.y-P.y,mouse.x-P.x); P.inv-=dt; P.dashCd-=dt; P.flashT-=dt; P.rec=Math.max(0,P.rec-dt*8); P.swapCd=Math.max(0,P.swapCd-dt);
  P.cooldowns=P.cooldowns.map(c=>Math.max(0,c-dt)); P.fireCd=P.cooldowns[P.weapon];
  if((mouse.r||keys.Space)&&P.dashCd<=0&&P.dashT<=0) { P.dvx=l?ax:Math.cos(P.face); P.dvy=l?ay:Math.sin(P.face); P.dashT=.18; P.dashCd=1.1; P.lastDashAt=run.elapsed; P.dashRefunded=false; P.inv=Math.max(P.inv,.3); shake=Math.max(shake,3); ringFx(P.x,P.y,40,'#99ccff'); sound.play('dash'); }
  if(P.dashT>0){P.dashT=Math.max(0,P.dashT-dt);P.vx=P.dvx*720;P.vy=P.dvy*720;if(ghosts.length<30)ghosts.push({x:P.x,y:P.y,a:P.face,life:.25});}
  else {const k=Math.min(1,dt*14);P.vx+=(ax*230-P.vx)*k;P.vy+=(ay*230-P.vy)*k;}
  let belt=0;if(cur==='matriarca'&&!B.dead&&P.dashT<=0){if(P.y>210&&P.y<244)belt=65;if(P.y>420&&P.y<454)belt=-65;}
  P.x+=(P.vx+belt)*dt;P.y+=P.vy*dt;resolve(P);P.walk+=Math.hypot(P.vx,P.vy)*dt*.08;
  if(mouse.l&&P.fireCd<=0&&P.swapCd<=0&&P.dashT<=0&&!B.dead)fire();
}
function hitMinion(m,damage) {
  m.hp-=damage;burst(m.x,m.y,4,'#a8ff50',140,3,.3);
  if(m.hp<=0){const i=B.mi.indexOf(m);if(i>=0)B.mi.splice(i,1);burst(m.x,m.y,14,'#a8ff50',200,4);}
}
function explode(b) {
  ringFx(b.x,b.y,b.blast,b.color);burst(b.x,b.y,35,'#ffb35b',280,5,.6);shake=Math.max(shake,7);sound.play('blast');
  // A rocket has no separate contact damage: exactly one area hit per target.
  for(const m of [...B.mi])if(Math.hypot(m.x-b.x,m.y-b.y)<b.blast+m.r)hitMinion(m,b.damage);
  if(!B.dead&&Math.hypot(B.x-b.x,B.y-b.y)<b.blast+B.r*.9)damageBoss(b.damage);
}
function updateBullets(dt) {
  for(let i=pb.length-1;i>=0;i--){
    const b=pb[i];if(!b)continue;const speed=Math.hypot(b.vx,b.vy),steps=Math.max(1,Math.ceil(speed*dt/5));let consumed=false;
    for(let s=0;s<steps&&!consumed;s++){
      const distance=Math.min(speed*dt/steps,b.range-b.travel);b.x+=b.vx/speed*distance;b.y+=b.vy/speed*distance;b.travel+=distance;b.life-=dt/steps;
      const wall=blocked(b.x,b.y),minion=B.mi.find(m=>Math.hypot(b.x-m.x,b.y-m.y)<m.r+b.r),boss=!B.dead&&Math.hypot(b.x-B.x,b.y-B.y)<B.r*.9+b.r,expired=b.travel>=b.range-.01;
      if(wall||minion||boss||expired){
        consumed=true;
        if(b.blast)explode(b);
        else if(!wall&&!expired){const fall=b.weapon===1?clamp(1-(b.travel-80)/300,.2,1):1;if(minion)hitMinion(minion,b.damage*fall);else if(boss)damageBoss(b.damage*fall);burst(b.x,b.y,5,b.color,170,3,.25);}
        else burst(b.x,b.y,3,b.color,100,2,.2);
      }
    }
    if(B.dead)return;
    if(consumed)pb.splice(i,1);else if(b.blast)burst(b.x,b.y,1,'#ffaa50',30,3,.18);
  }
  for(let i=eb.length-1;i>=0;i--){
    const b=eb[i];if(!b)continue;
    if(b.hm&&b.life>b.hl){const sp=Math.hypot(b.vx,b.vy),a=Math.atan2(b.vy,b.vx),d=Math.atan2(P.y-b.y,P.x-b.x)-a,na=a+clamp(Math.atan2(Math.sin(d),Math.cos(d)),-b.hm*dt,b.hm*dt);b.vx=Math.cos(na)*sp;b.vy=Math.sin(na)*sp;}
    b.life-=dt;let remove=b.life<=0;const steps=Math.max(1,Math.ceil(Math.hypot(b.vx,b.vy)*dt/5));
    for(let j=0;j<steps&&!remove;j++){
      const ox=b.x,oy=b.y;b.x+=b.vx*dt/steps;b.y+=b.vy*dt/steps;
      if(blocked(b.x,b.y)){
        if(b.bn>0){const bx=blocked(b.x,oy),by=blocked(ox,b.y);if(bx||!by)b.vx=-b.vx;if(by||!bx)b.vy=-b.vy;b.x=ox;b.y=oy;b.bn--;burst(b.x,b.y,3,'#fff',90,2,.2);}
        else remove=true;
      }else if(Math.hypot(b.x-P.x,b.y-P.y)<b.r+P.r*.75&&hurt())remove=true;
      if(state!=='play')return;
    }
    if(remove){burst(b.x,b.y,3,b.col,90,2,.2);eb.splice(i,1);}
  }
}
function update(dt) {
  if(!B.dead)run.elapsed+=dt;
  updatePlayer(dt); updateBoss(dt); if(state!=='play')return;
  if(!B.dead){updateBullets(dt);if(state!=='play')return;if(!B.dead)updateHaz(dt);}
  updateFx(dt);
}
/* ---------- Apresentação e informações de combate ---------- */
function drawWeapon(index, x, y, scale=1) {
  const w=WEAPONS[index];ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
  R(-16,-4,25,8,'#5e6d80');R(-10,4,7,7,'#293343');R(8,-2,index===2?22:12,4,w.color);
  if(index===1){R(-18,-5,8,10,'#a97651');R(6,2,14,3,w.color);}
  if(index===2){R(-2,-9,13,4,'#a5c8d4');R(3,-5,3,3,'#293343');}
  if(index===3){R(-20,-7,38,14,'#607e4e');R(14,-5,8,10,w.color);R(-23,-6,4,12,'#b8d39a');}
  ctx.restore();
}
function drawPlayer() {
  for(const g of ghosts){ctx.globalAlpha=g.life*2;R(g.x-8,g.y-14,16,26,'#6cf');}ctx.globalAlpha=1;
  ctx.fillStyle='rgba(0,0,0,.45)';ctx.beginPath();ctx.ellipse(P.x,P.y+13,11,5,0,0,TAU);ctx.fill();
  if(P.inv>0&&P.dashT<=0&&((time*20)|0)%2)ctx.globalAlpha=.35;if(P.dashT>0)ctx.globalAlpha=.7;
  ctx.save();ctx.translate(Math.round(P.x),Math.round(P.y));const w=Math.round(Math.sin(P.walk*2)*3);
  R(-6,4,5,8+w,'#2b3a55');R(1,4,5,8-w,'#2b3a55');R(-8,-6,16,12,'#4a6a8a');R(-8,-6,16,3,'#6a8aaa');R(-5,-13,10,8,'#d9b38c');R(-6,-16,12,5,'#2e3b4e');
  ctx.rotate(P.face);if(Math.cos(P.face)<0)ctx.scale(1,-1);drawWeapon(P.weapon,16-P.rec*4,2,.65);
  if(P.flashT>0){R(30,-4,12,8,WEAPONS[P.weapon].color);R(34,-2,10,4,'#fff');}ctx.restore();ctx.globalAlpha=1;
}
function drawProjectiles() {
  for(const b of eb){ctx.fillStyle='#160d20';ctx.beginPath();ctx.arc(b.x,b.y,b.r+2,0,TAU);ctx.fill();ctx.fillStyle=b.col;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,TAU);ctx.fill();R(b.x-1.5,b.y-1.5,3,3,'#fff');}
  for(const b of pb){ctx.save();ctx.translate(b.x,b.y);ctx.rotate(Math.atan2(b.vy,b.vx));R(b.weapon===2?-22:-8,-2,b.weapon===2?28:12,4,b.color);if(b.blast){R(-8,-5,12,10,'#729257');R(4,-3,6,6,b.color);R(-14,-2,6,4,'#ffae55');}ctx.restore();}
}
function drawArena() {
  if(cur==='matriarca'){
    for(const [y,dir] of [[210,1],[420,-1]]){
      R(M,y,W-M*2,34,'#1a222c');
      for(let x=M;x<W-M;x+=32){const px=x+((B.t*45*dir)%32);ctx.strokeStyle='#c6a954';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(px-dir*5,y+10);ctx.lineTo(px+dir*4,y+17);ctx.lineTo(px-dir*5,y+24);ctx.stroke();}
      R(M,y,W-M*2,2,'#806b33');R(M,y+32,W-M*2,2,'#806b33');
    }
  }
}
function drawTele() {
  const t=B.tele;if(!t)return;const k=clamp(1-t.t/t.max,0,1),col=t.kind==='line'?'#7fe8ff':t.kind==='arc'?'#ffad63':t.kind==='charge'?'#ff637d':'#ffd477';
  ctx.save();ctx.strokeStyle=col;ctx.lineWidth=2;ctx.setLineDash([8,5]);
  ctx.fillStyle=t.kind==='line'?'rgba(100,220,255,.14)':'rgba(255,110,55,.12)';
  if(t.kind==='cone'||t.kind==='arc'){
    const radius=t.kind==='arc'?200:t.radius,angle=t.kind==='arc'?.95:t.half;
    ctx.beginPath();ctx.moveTo(B.x,B.y);ctx.arc(B.x,B.y,radius,t.ang-angle,t.ang+angle);ctx.closePath();ctx.fill();ctx.stroke();
  }else if(t.kind==='charge'){
    ctx.save();ctx.translate(B.x,B.y);ctx.rotate(t.ang);ctx.fillRect(0,-B.r,t.len+B.r,B.r*2);ctx.strokeRect(0,-B.r,t.len+B.r,B.r*2);
    for(let x=40;x<t.len;x+=55){ctx.beginPath();ctx.moveTo(x-8,-8);ctx.lineTo(x,0);ctx.lineTo(x-8,8);ctx.stroke();}ctx.restore();
  }else if(t.kind==='line'){
    ctx.beginPath();ctx.moveTo(B.x,B.y);ctx.lineTo(B.x+Math.cos(t.ang)*1000,B.y+Math.sin(t.ang)*1000);ctx.stroke();
  }else if(t.kind==='ring'){ctx.beginPath();ctx.arc(B.x,B.y,t.radius,0,TAU);ctx.fill();ctx.stroke();}
  ctx.setLineDash([]);ctx.lineWidth=4;ctx.beginPath();ctx.arc(B.x,B.y,B.r+13,-Math.PI/2,-Math.PI/2+TAU*k);ctx.stroke();
  ctx.restore();
}
function drawHaz() {
  for(const h of haz){const k=clamp(h.t/h.delay,0,1);ctx.fillStyle='rgba(255,85,45,.10)';ctx.beginPath();ctx.arc(h.x,h.y,h.r,0,TAU);ctx.fill();
    ctx.strokeStyle='#ff9369';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.stroke();ctx.setLineDash([]);ctx.lineWidth=4;ctx.beginPath();ctx.arc(h.x,h.y,h.r,-Math.PI/2,-Math.PI/2+k*TAU);ctx.stroke();
    ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(h.x-6,h.y-6);ctx.lineTo(h.x+6,h.y+6);ctx.moveTo(h.x+6,h.y-6);ctx.lineTo(h.x-6,h.y+6);ctx.stroke();
  }
}
function drawBoss() {
  def.draw();
  if(B.vuln>0||B.core>0){ctx.strokeStyle='#77ffe1';ctx.lineWidth=2;ctx.beginPath();ctx.arc(B.x,B.y,B.r+8,0,TAU);ctx.stroke();}
}
function drawImpacts() {
  for (const h of impacts) {
    ctx.save(); ctx.globalAlpha = h.life / .22 * .7; ctx.fillStyle = h.col;
    ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.arc(h.x, h.y, h.radius, h.ang - h.half, h.ang + h.half); ctx.closePath(); ctx.fill(); ctx.restore();
  }
}
function drawUI() {
  R(0,0,W,60,'#0a0d16');R(0,H-63,W,63,'#0a0d16');
  for(let i=0;i<5;i++)heart(18+i*33,18,i<P.hp);
  const bx=215,bw=530;txt(def.name.toUpperCase(),W/2,23,15,'#e0e6f0');R(bx-2,31,bw+4,17,'#000');R(bx,33,bw,13,'#30212c');R(bx,33,bw*clamp(B.shown/B.max,0,1),13,'#ffffff70');R(bx,33,bw*clamp(B.hp/B.max,0,1),13,PCOL[B.phase]);R(bx+bw*.65,31,2,17,'#111');R(bx+bw*.30,31,2,17,'#111');
  txt('FASE '+B.phase+' / 3',W/2,72,12,PCOL[B.phase]);txt(Math.ceil(B.hp)+' / '+B.max,755,44,11,'#c7d0dd','left');
  const cd=clamp(1-P.dashCd/1.1,0,1);txt('DASH',22,H-39,12,'#9cf','left');R(22,H-30,108,7,'#23324a');R(22,H-30,108*cd,7,cd>=1?'#66ddff':'#376384');txt(formatTime(run.elapsed),22,H-9,11,'#9eaec4','left');
  for(let i=0;i<4;i++){const x=160+i*159,w=WEAPONS[i],active=i===P.weapon;R(x,H-55,150,47,active?'#243448':'#141d2c');if(active){ctx.strokeStyle=w.color;ctx.lineWidth=1;ctx.strokeRect(x+.5,H-54.5,149,46);}drawWeapon(i,x+27,H-36,.65);txt((i+1)+' '+w.short,x+52,H-34,11,active?w.color:'#8593a7','left');const ready=1-P.cooldowns[i]/w.cd;R(x+52,H-23,87,3,'#354055');R(x+52,H-23,87*clamp(ready,0,1),3,w.color);if(active&&P.cooldowns[i]>.05)txt(P.cooldowns[i].toFixed(1)+'s',x+138,H-10,9,'#b4c1d0','right');}
  txt('1–4 / RODA',W-20,H-37,11,'#a3b2c8','right');txt('ESC PAUSA',W-20,H-18,11,'#718098','right');
  if(B.phaseMsg>0)txt('FASE '+B.phase,W/2,H/2+10,48,PCOL[B.phase]);
  if(flash>0){ctx.fillStyle=`rgba(255,65,45,${flash*.4})`;ctx.fillRect(0,0,W,H);}
}
function cardRect(i) { return {x:40+(i%3)*295,y:111+Math.floor(i/3)*244,w:280,h:229}; }
function drawSelect() {
  ctx.fillStyle='#090d16';ctx.fillRect(0,0,W,H);txt('ESCOLHA SEU BOSS',W/2,49,33,'#ffba69');txt('6 ARENAS  /  4 ARMAS  /  3 FASES',W/2,77,13,'#a2b1c7');
  ORDER.forEach((id,i)=>{const d=BOSSES[id],r=cardRect(i),hover=inCard(i),rec=saved.records[id];R(r.x,r.y,r.w,r.h,hover?'#1f2d40':'#141d2b');R(r.x,r.y,r.w,3,d.pcol[1]);ctx.strokeStyle=hover?'#d9e5f5':rec?'#497960':'#293548';ctx.lineWidth=1;ctx.strokeRect(r.x,r.y,r.w,r.h);
    preview(id,r.x+r.w/2,r.y+63);txt(String(i+1).padStart(2,'0'),r.x+15,r.y+25,15,'#64758f','left');if(rec)txt(rec.flawless?'SEM DANO':'DERROTADO',r.x+r.w-12,r.y+24,10,rec.flawless?'#ffe28b':'#93e8b1','right');
    txt(d.name,r.x+r.w/2,r.y+122,16,'#ecf1f8');d.desc.forEach((s,k)=>txt(s,r.x+r.w/2,r.y+145+k*16,12,'#a3b3ca'));
    txt(rec?'RECORDE '+formatTime(rec.bestTime)+'  |  DANO '+rec.leastDamage:d.hp+' PV  ·  SEM RECORDE',r.x+r.w/2,r.y+201,11,rec?'#a3e1ba':'#72839d');
  });txt('CLIQUE OU TECLE 1–6 PARA COMEÇAR',W/2,H-22,13,'#9bacbf');
}
function render() {
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(rnd(-shake,shake),rnd(-shake,shake));
  ctx.drawImage(floorC,0,0);drawArena();drawPillars();drawTorches();if(!(B.dead&&B.deathT>2.8))drawBoss();if(P.hp>0)drawPlayer();drawLight();
  // Danger indicators stay above the darkness and scenery for readability.
  if(def.fx)def.fx();drawHaz();drawTele();drawProjectiles();drawParts();drawImpacts();ctx.restore();drawUI();
  if(state==='menu'){
    R(0,0,W,H,'#080d17ec');txt('ARSENAL',W/2,139,14,'#91a7c6');txt('ARENA DOS BOSSES',W/2,199,49,'#ffb35f');txt('Seis desafios. Quatro armas. Uma chance de dominar a arena.',W/2,236,15,'#a8b9d0');
    for(let i=0;i<4;i++){drawWeapon(i,330+i*100,296,1.3);}
    txt('WASD mover  ·  Mouse mirar e atirar',W/2,366,17,'#e0e8f4');txt('Espaço / botão direito: dash  ·  1–4 / roda: armas',W/2,397,15,'#c3d0e2');txt('Esc: pausa  ·  O: áudio  ·  R: reiniciar após a luta',W/2,428,13,'#869bb7');
    R(295,475,370,49,'#26364b');txt('CLIQUE OU ENTER PARA JOGAR',W/2,506,18,'#ffe0ad');txt('TECLADO + MOUSE',W/2,561,11,'#687e9d');
  }else if(state==='select')drawSelect();
  else if(state==='pause')overlay('PAUSADO','Esc: continuar  |  R: reiniciar  |  M: trocar boss','#e0e8f4');
  else if(state==='win'){overlay('VITÓRIA!',def.name+' caiu.','#9befbc');txt('TEMPO '+formatTime(run.elapsed)+'   •   DANO '+run.damage+(run.damage===0?'   •   SEM DANO!':''),W/2,H/2+70,17,'#ffe3a1');txt('R: jogar novamente  |  M: escolher boss',W/2,H/2+110,16,'#c5d2e2');}
  else if(state==='lose')overlay('VOCÊ MORREU','R: tentar de novo  |  M: escolher boss','#ff718a');
  drawCrosshair();
}

/* ---------- Controles e loop ---------- */
function setMouse(e) { const r=cv.getBoundingClientRect();mouse.x=(e.clientX-r.left)*W/r.width;mouse.y=(e.clientY-r.top)*H/r.height; }
setupAudio();
window.addEventListener('keydown',e=>{
  if(!document.getElementById('audio-panel').hidden)return;
  if(e.target instanceof HTMLInputElement)return;
  if(['Space','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();
  if(e.code==='KeyO')return;
  sound.init();keys[e.code]=true;
  if(e.code==='Escape'&&!e.repeat){if(state==='play'){state='pause';clearInput();}else if(state==='pause')state='play';}
  if(e.code==='KeyR'&&!e.repeat&&['win','lose','pause'].includes(state))start(cur);
  if(e.code==='KeyM'&&!e.repeat&&['win','lose','pause'].includes(state)){state='select';clearInput();}
  if(state==='select'&&/^Digit[1-6]$/.test(e.code)&&!e.repeat){const id=ORDER[+e.code[5]-1];if(id)start(id);return;}
  if(state==='play'&&/^Digit[1-4]$/.test(e.code))switchWeapon(+e.code[5]-1);
  if(e.code==='Enter'&&state==='menu')state='select';
});
window.addEventListener('keyup',e=>{keys[e.code]=false;});
cv.addEventListener('mousemove',setMouse);
cv.addEventListener('mousedown',e=>{
  if(!document.getElementById('audio-panel').hidden)return;
  sound.init();setMouse(e);
  if(e.button===0){if(state==='menu')state='select';else if(state==='select')pickCard();else if(state==='play')mouse.l=true;}
  if(e.button===2&&state==='play')mouse.r=true;
});
window.addEventListener('mouseup',e=>{if(e.button===0)mouse.l=false;if(e.button===2)mouse.r=false;});
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('wheel',e=>{e.preventDefault();if(state==='play'&&document.getElementById('audio-panel').hidden)switchWeapon(P.weapon+(e.deltaY>0?1:-1));},{passive:false});
window.addEventListener('blur',()=>{clearInput();if(state==='play')state='pause';});
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(state==='play')state='pause';}});
let last=performance.now();
function loop(n){const dt=Math.min(.033,(n-last)/1000);last=n;time+=dt;if(state==='play')update(dt);else if(state==='win'||state==='lose'){stateT+=dt;updateFx(dt);B.shown+=(B.hp-B.shown)*Math.min(1,dt*4);}flash=Math.max(0,flash-dt);sound.update(dt);render();requestAnimationFrame(loop);}
reset('chumbo');requestAnimationFrame(loop);
})();
