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
let P, B, pb = [], eb = [], haz = [], parts = [], ghosts = [];

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
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(M, M, W - 2 * M, 8); g.fillRect(M, M, 8, H - 2 * M);
}
function reset(id) {
  if (id) cur = id; def = BOSSES[cur]; PCOL = def.pcol; PAUSE = def.pause; PILLARS = def.obs; buildFloor();
  P = { x: W / 2, y: H - 130, r: 11, hp: 5, inv: 0, vx: 0, vy: 0, dashT: 0, dashCd: 0, dvx: 0, dvy: 0, fireCd: 0, rec: 0, flashT: 0, walk: 0, face: -Math.PI / 2 };
  B = { x: W / 2, y: 170, r: def.r, hp: def.hp, max: def.hp, shown: def.hp, vuln: 0, swT: 0, duel: 0, duelA: 0, duelGo: false, parried: false, phase: 1, gen: null, wait: 1.8, hitT: 0, dead: false, deathT: 0,
        charging: false, cvx: 0, cvy: 0, chLeft: 0, chBoss: false, tele: null, phaseMsg: 0, last: -1, t: 0 };
  pb = []; eb = []; haz = []; parts = []; ghosts = []; shake = 0; flash = 0; stateT = 0;
}
function start(id) { reset(id); state = 'play'; }

/* ---------- Utilidades ---------- */
function resolve(e) {
  e.x = clamp(e.x, M + e.r, W - M - e.r); e.y = clamp(e.y, M + e.r, H - M - e.r);
  for (const p of PILLARS) {
    const cx = clamp(e.x, p.x, p.x + p.w), cy = clamp(e.y, p.y, p.y + p.h), dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy);
    if (d < e.r) { if (d === 0) { e.y = p.y - e.r; continue; } e.x = cx + dx / d * e.r; e.y = cy + dy / d * e.r; }
  }
}
function blocked(x, y) {
  if (x < M || y < M || x > W - M || y > H - M) return true;
  return PILLARS.some(p => x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h);
}
function burst(x, y, n, col, sp, sz, life = .5) {
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), s = rnd(sp * .3, sp); parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * .5, life), max: life, sz: rnd(sz * .6, sz), col }); }
}
function ringFx(x, y, max, col) { parts.push({ k: 1, x, y, r: 4, max, life: .4, mx: .4, col }); }
function aim() { return Math.atan2(P.y - B.y, P.x - B.x); }
function shootE(x, y, a, sp, r = 6, col = '#ff7a2a') { eb.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, col, life: 8 }); }
function rayLen(x, y, dx, dy, r) {
  const tx = dx > 0 ? (W - M - r - x) / dx : dx < 0 ? (M + r - x) / dx : 1e9;
  const ty = dy > 0 ? (H - M - r - y) / dy : dy < 0 ? (M + r - y) / dy : 1e9;
  return Math.max(0, Math.min(tx, ty, 600));
}
function hurt(n = 1) {
  if (P.inv > 0 || state !== 'play') return false;
  P.hp -= n; P.inv = 1.4; shake = Math.max(shake, 12); flash = .35; burst(P.x, P.y, 16, '#ff4040', 200, 4);
  if (P.hp <= 0) { state = 'lose'; stateT = 0; burst(P.x, P.y, 40, '#cc3333', 300, 5); eb.length = 0; haz.length = 0; }
  return true;
}

/* ---------- Ataques do boss (geradores: yield = esperar segundos) ---------- */
function* warn(kind, d) {
  d *= B.phase === 3 ? .75 : 1;
  const t = { kind, t: d, max: d, ang: aim(), len: 0 }; B.tele = t; yield d; B.tele = null; return t;
}
function* cone(n, bursts) {
  yield* warn('cone', .7);
  for (let i = 0; i < bursts; i++) {
    const a = aim(); for (let k = -n; k <= n; k++) shootE(B.x, B.y, a + k * .17, 215 + B.phase * 12);
    burst(B.x, B.y, 8, '#ffb040', 160, 3); yield .38;
  }
}
function* ring(n, waves) {
  yield* warn('ring', .8);
  for (let w = 0; w < waves; w++) {
    for (let i = 0; i < n; i++) shootE(B.x, B.y, i * TAU / n + w * Math.PI / n, 160 + B.phase * 10);
    ringFx(B.x, B.y, 70, '#ff8040'); yield .6;
  }
}
function* rain(n, delay, cnt) {
  for (let i = 0; i < n; i++) {
    let x = i % 2 ? rnd(M + 70, W - M - 70) : P.x + rnd(-70, 70), y = i % 2 ? rnd(M + 70, H - M - 70) : P.y + rnd(-70, 70);
    haz.push({ x: clamp(x, M + 60, W - M - 60), y: clamp(y, M + 60, H - M - 60), r: 58, t: 0, delay, cnt }); yield .28;
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
  yield* warn('ring', .7);
  for (let i = 0; i < 36; i++) { for (let a = 0; a < 3; a++) shootE(B.x, B.y, i * .35 + a * TAU / 3, 185); yield .07; }
}
function* combo() { yield* cone(2, 2); yield* ring(18, 3); }
const ATT = {
  1: [() => cone(2, 3), () => ring(14, 2)],
  2: [() => rain(6, 1, 6), () => charge(false), () => cone(3, 3), () => ring(16, 2)],
  3: [() => spiral(), () => rain(8, .8, 10), () => charge(true), () => combo()]
};
function pickAttack() {
  const l = def.att[B.phase]; let i; do { i = Math.floor(Math.random() * l.length); } while (i === B.last && l.length > 1);
  B.last = i; return l[i]();
}
function phaseOf(f) { return f > .65 ? 1 : f > .30 ? 2 : 3; }

/* ---------- Atualização ---------- */
function updateBoss(dt) {
  B.t += dt; B.hitT -= dt; B.phaseMsg -= dt; B.shown += (B.hp - B.shown) * Math.min(1, dt * 4);
  if (B.hp <= 0 && !B.dead) { B.dead = true; B.deathT = 0; B.gen = null; B.charging = false; B.tele = null; B.duel = 0; B.duelGo = false; eb.length = 0; haz.length = 0; shake = 20; flash = .4; }
  if (B.dead) {
    B.deathT += dt;
    if (Math.random() < dt * 18) { const x = B.x + rnd(-50, 50), y = B.y + rnd(-50, 50); burst(x, y, 14, Math.random() < .5 ? '#ffb040' : '#ff4020', 260, 5, .8); ringFx(x, y, 50, '#ffa040'); shake = Math.max(shake, 6); }
    if (B.deathT > 3) { burst(B.x, B.y, 80, '#fff', 500, 6, 1); state = 'win'; stateT = 0; won[cur] = true; }
    return;
  }
  B.vuln -= dt; B.swT -= dt; if (def.upd) def.upd(dt);
  const ph = phaseOf(B.hp / B.max);
  if (ph > B.phase) {
    B.phase = ph; B.duel = 0; B.duelGo = false; B.vuln = 0; B.gen = null; B.charging = false; B.tele = null; eb.length = 0; haz.length = 0; B.wait = 1.7; B.phaseMsg = 2.2;
    shake = 16; flash = .3; burst(B.x, B.y, 60, PCOL[ph], 420, 6, 1); ringFx(B.x, B.y, 200, PCOL[ph]);
  }
  if (B.tele) {
    B.tele.t -= dt;
    if (B.tele.kind === 'cone' || B.tele.kind === 'line' || ((B.tele.kind === 'charge' || B.tele.kind === 'arc') && B.tele.t > .3)) B.tele.ang = aim();
    B.tele.len = rayLen(B.x, B.y, Math.cos(B.tele.ang), Math.sin(B.tele.ang), B.r);
  }
  if (B.charging) {
    const st = Math.min(620 * dt, B.chLeft); B.x += Math.cos(B.chAng) * st; B.y += Math.sin(B.chAng) * st; B.chLeft -= st;
    burst(B.x, B.y + 20, 1, '#aaa', 60, 4, .4);
    if (Math.hypot(P.x - B.x, P.y - B.y) < B.r + P.r * .7) hurt();
    if (B.chLeft <= 0.5) {
      B.charging = false; shake = 14; ringFx(B.x, B.y, 90, '#fff'); burst(B.x, B.y, 24, '#bbb', 260, 5);
      if (B.chBoss) for (let i = 0; i < 12; i++) shootE(B.x, B.y, i * TAU / 12, 170);
    }
  } else {
    B.x += (W / 2 + Math.sin(B.t * .6) * 140 - B.x) * dt * .8; B.y += (160 + Math.sin(B.t * .9) * 25 - B.y) * dt * .8;
  }
  if (B.wait > 0) { B.wait -= dt; return; }
  if (B.charging) return;
  if (!B.gen) B.gen = pickAttack();
  const r = B.gen.next();
  if (r.done) { B.gen = null; B.wait = PAUSE[B.phase]; } else B.wait = r.value;
}
function fire() {
  P.fireCd = .095; const a = P.face + rnd(-.04, .04), mx = P.x + Math.cos(P.face) * 28, my = P.y + Math.sin(P.face) * 28;
  pb.push({ x: mx, y: my, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, life: 1.2 });
  P.rec = 1; P.flashT = .05; P.x -= Math.cos(P.face) * 1.3; P.y -= Math.sin(P.face) * 1.3; shake = Math.max(shake, 1.2);
  burst(mx, my, 3, '#ffd060', 120, 2, .2);
}
function updatePlayer(dt) {
  let ax = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), ay = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  const l = Math.hypot(ax, ay); if (l) { ax /= l; ay /= l; }
  P.face = Math.atan2(mouse.y - P.y, mouse.x - P.x);
  P.inv -= dt; P.fireCd -= dt; P.dashCd -= dt; P.flashT -= dt; P.rec = Math.max(0, P.rec - dt * 8);
  if ((mouse.r || keys.Space) && P.dashCd <= 0 && P.dashT <= 0) {
    P.dvx = l ? ax : Math.cos(P.face); P.dvy = l ? ay : Math.sin(P.face);
    P.dashT = .18; P.dashCd = 1.1; P.inv = Math.max(P.inv, .3); shake = Math.max(shake, 3); ringFx(P.x, P.y, 40, '#99ccff');
  }
  if (P.dashT > 0) { P.dashT -= dt; P.vx = P.dvx * 720; P.vy = P.dvy * 720; ghosts.push({ x: P.x, y: P.y, a: P.face, life: .25 }); }
  else { const k = Math.min(1, dt * 14); P.vx += (ax * 230 - P.vx) * k; P.vy += (ay * 230 - P.vy) * k; }
  P.x += P.vx * dt; P.y += P.vy * dt; resolve(P);
  P.walk += Math.hypot(P.vx, P.vy) * dt * .08;
  if (mouse.l && P.fireCd <= 0 && P.dashT <= 0 && !B.dead) fire();
}
function updateBullets(dt) {
  for (let i = pb.length - 1; i >= 0; i--) {
    const b = pb[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0 || blocked(b.x, b.y)) { burst(b.x, b.y, 4, '#ffcc66', 140, 2, .25); pb.splice(i, 1); continue; }
    if (!B.dead && Math.hypot(b.x - B.x, b.y - B.y) < B.r * .9) {
      B.hp = Math.max(0, B.hp - 8 * (B.vuln > 0 ? 1.6 : 1)); B.hitT = .08; burst(b.x, b.y, 5, '#ffffff', 220, 3, .3); pb.splice(i, 1);
      if (B.hp <= 0) {
        B.dead = true; B.deathT = 0; B.gen = null; B.charging = false; B.tele = null; eb.length = 0; haz.length = 0; shake = 20; flash = .4;
      }
    }
  }
  for (let i = eb.length - 1; i >= 0; i--) {
    const b = eb[i]; if (!b) break; b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.bn > 0 && b.life > 0 && blocked(b.x, b.y)) {
      const px = b.x - b.vx * dt, py = b.y - b.vy * dt, bx = blocked(b.x, py), by = blocked(px, b.y);
      if (bx || !by) b.vx = -b.vx; if (by || !bx) b.vy = -b.vy;
      b.x = px; b.y = py; b.bn--; burst(b.x, b.y, 4, '#ffffff', 120, 2, .25); continue;
    }
    if (b.life <= 0 || blocked(b.x, b.y)) { burst(b.x, b.y, 3, b.col, 90, 2, .25); eb.splice(i, 1); continue; }
    if (Math.hypot(b.x - P.x, b.y - P.y) < b.r + P.r * .75 && hurt()) eb.splice(i, 1);
  }
}
function updateHaz(dt) {
  for (let i = haz.length - 1; i >= 0; i--) {
    const h = haz[i]; if (!h) break; h.t += dt;
    if (h.t >= h.delay) {
      burst(h.x, h.y, 22, '#ff6030', 300, 5, .6); ringFx(h.x, h.y, h.r, '#ffaa50'); shake = Math.max(shake, 5);
      for (let k = 0; k < h.cnt; k++) shootE(h.x, h.y, k * TAU / h.cnt + rnd(0, .3), 140, 5);
      if (Math.hypot(P.x - h.x, P.y - h.y) < h.r + P.r * .4) hurt();
      haz.splice(i, 1);
    }
  }
}
function updateFx(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
    if (p.k) p.r = p.max * (1 - p.life / p.mx); else { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96; }
  }
  for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].life -= dt; if (ghosts[i].life <= 0) ghosts.splice(i, 1); }
  shake *= Math.pow(.002, dt); if (shake < .1) shake = 0;
}
function update(dt) {
  updatePlayer(dt); updateBoss(dt); if (state !== 'play') return;
  updateBullets(dt); updateHaz(dt); updateFx(dt);
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
    else if (p.k === 'col') { R(p.x, p.y, p.w, p.h, '#3a3638'); R(p.x, p.y - 6, p.w, 8, '#6a6466'); R(p.x + 6, p.y - 14, 14, 8, '#6a6466'); R(p.x + 4, p.y + 6, 6, p.h - 10, '#4a4648'); }
    else { R(p.x, p.y, p.w, p.h, '#2c2e3d'); R(p.x, p.y - 10, p.w, 12, '#555a74'); R(p.x + 4, p.y + 6, 6, p.h - 10, '#3a3d50'); R(p.x, p.y + p.h - 4, p.w, 4, '#1c1d28'); }
  }
}
function drawTele() {
  const t = B.tele; if (!t) return; const k = 1 - t.t / t.max;
  ctx.save();
  if (t.kind === 'cone') {
    ctx.fillStyle = `rgba(255,70,40,${.1 + .22 * k})`; ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.arc(B.x, B.y, 420, t.ang - .62, t.ang + .62); ctx.closePath(); ctx.fill();
  } else if (t.kind === 'ring') {
    ctx.strokeStyle = `rgba(255,120,60,${.3 + .5 * k})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(B.x, B.y, 40 + (1 - k) * 90, 0, TAU); ctx.stroke();
  } else if (t.kind === 'charge') {
    ctx.translate(B.x, B.y); ctx.rotate(t.ang); ctx.fillStyle = `rgba(255,50,50,${.12 + .3 * k})`; ctx.fillRect(0, -B.r * .8, t.len + B.r, B.r * 1.6);
  } else if (t.kind === 'arc') {
    ctx.fillStyle = `rgba(255,50,40,${.12 + .3 * k})`; ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.arc(B.x, B.y, 200, t.ang - .95, t.ang + .95); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(255,120,80,${.4 + .5 * k})`; ctx.lineWidth = 3; ctx.stroke();
  } else if (t.kind === 'line') {
    ctx.strokeStyle = `rgba(120,230,255,${.2 + .6 * k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(B.x, B.y); ctx.lineTo(B.x + Math.cos(t.ang) * 900, B.y + Math.sin(t.ang) * 900); ctx.stroke();
  }
  ctx.restore();
}
function drawHaz() {
  for (const h of haz) {
    const k = h.t / h.delay; ctx.fillStyle = `rgba(255,50,30,${.08 + .3 * k})`; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(255,140,80,${.5 + .5 * k})`; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = `rgba(255,120,60,${.2 + .4 * k})`; ctx.beginPath(); ctx.arc(h.x, h.y, h.r * k, 0, TAU); ctx.fill();
  }
}
function drawBoss() { def.draw(); if (B.vuln > 0) txt('ABERTO!', B.x, B.y - B.r - 44, 16, '#6ff'); }
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
function drawPlayer() {
  for (const g of ghosts) { ctx.globalAlpha = g.life * 2; R(g.x - 8, g.y - 14, 16, 26, '#6cf'); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(P.x, P.y + 13, 11, 5, 0, 0, TAU); ctx.fill();
  if (P.inv > 0 && P.dashT <= 0 && ((time * 20) | 0) % 2) ctx.globalAlpha = .35;
  if (P.dashT > 0) ctx.globalAlpha = .7;
  ctx.save(); ctx.translate(Math.round(P.x), Math.round(P.y));
  const w = Math.round(Math.sin(P.walk * 2) * 3);
  R(-6, 4, 5, 8 + w, '#2b3a55'); R(1, 4, 5, 8 - w, '#2b3a55');
  R(-8, -6, 16, 12, '#4a6a8a'); R(-8, -6, 16, 3, '#6a8aaa');
  R(-5, -13, 10, 8, '#d9b38c'); R(-6, -16, 12, 5, '#2e3b4e');
  ctx.rotate(P.face); if (Math.cos(P.face) < 0) ctx.scale(1, -1);
  const rc = -P.rec * 4; R(2 + rc, -2, 16, 5, '#222'); R(10 + rc, 3, 4, 7, '#333'); R(18 + rc, -1, 10, 3, '#111'); R(-2 + rc, -1, 5, 6, '#3a2a1a');
  if (P.flashT > 0) { R(28, -4, 8, 8, '#ffe070'); R(32, -2, 8, 4, '#fff'); }
  ctx.restore(); ctx.globalAlpha = 1;
}
function drawProjectiles() {
  ctx.globalCompositeOperation = 'lighter';
  for (const b of eb) { ctx.fillStyle = 'rgba(255,90,30,.28)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 6, 0, TAU); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
  for (const b of eb) { ctx.fillStyle = '#3a0800'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1.5, 0, TAU); ctx.fill(); ctx.fillStyle = b.col; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffe0a0'; ctx.fillRect(b.x - 1.5, b.y - 1.5, 3, 3); }
  for (const b of pb) { ctx.fillStyle = '#ffe58a'; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx)); ctx.fillRect(-8, -1.5, 12, 3); ctx.restore(); }
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
function drawUI() {
  for (let i = 0; i < 5; i++) heart(20 + i * 36, 18, i < P.hp);
  const bx = 200, bw = 560;
  txt(def.name.toUpperCase(), W / 2, 28, 16, '#ddd');
  R(bx - 3, 34, bw + 6, 20, '#000'); R(bx, 37, bw, 14, '#2a1015');
  const f = B.hp / B.max, s = B.shown / B.max; R(bx, 37, bw * s, 14, '#ffffff66'); R(bx, 37, bw * f, 14, PCOL[B.phase]);
  R(bx + bw * .65, 34, 2, 20, '#000'); R(bx + bw * .30, 34, 2, 20, '#000');
  txt('FASE ' + B.phase + '/3', W / 2, 72, 14, PCOL[B.phase]);
  const cd = clamp(1 - P.dashCd / 1.1, 0, 1);
  txt('DASH', 20, H - 22, 14, '#9cf', 'left'); R(72, H - 34, 124, 14, '#000'); R(75, H - 31, 118, 8, '#1a2a3a'); R(75, H - 31, 118 * cd, 8, cd >= 1 ? '#66ddff' : '#3a7aa0');
  if (B.phaseMsg > 0) txt('FASE ' + B.phase, W / 2, H / 2 + 10, 56, PCOL[B.phase]);
  if (flash > 0) { ctx.fillStyle = `rgba(255,40,40,${flash * .5})`; ctx.fillRect(0, 0, W, H); }
}
function overlay(title, sub, col) {
  ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
  txt(title, W / 2, H / 2 - 20, 54, col); txt(sub, W / 2, H / 2 + 30, 20, '#ddd');
}
function drawCrosshair() {
  const x = mouse.x, y = mouse.y; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 15, y); ctx.lineTo(x - 5, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 15, y); ctx.moveTo(x, y - 15); ctx.lineTo(x, y - 5); ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 15); ctx.stroke();
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.save(); ctx.translate(rnd(-shake, shake), rnd(-shake, shake));
  ctx.drawImage(floorC, 0, 0); drawHaz(); drawTele(); drawPillars(); drawTorches();
  if (!(B.dead && B.deathT > 2.8)) drawBoss(); if (P.hp > 0) drawPlayer();
  drawLight(); drawProjectiles(); drawParts(); if (def.fx) def.fx();
  ctx.restore();
  drawUI();
  if (state === 'menu') { ctx.fillStyle = 'rgba(0,0,0,.75)'; ctx.fillRect(0, 0, W, H);
    txt('ARENA DOS BOSSES', W / 2, 200, 52, '#ff9a2a'); txt('Sobreviva à arena e derrote o boss', W / 2, 240, 18, '#bbb');
    txt('WASD mover  |  Mouse mirar  |  Botão esquerdo atirar', W / 2, 330, 18, '#ddd');
    txt('Botão direito: dash  |  Esc: pausar  |  R: reiniciar', W / 2, 360, 18, '#ddd');
    if ((time * 2 | 0) % 2) txt('CLIQUE PARA COMEÇAR', W / 2, 450, 28, '#fff'); }
  else if (state === 'select') drawSelect();
  else if (state === 'pause') overlay('PAUSADO', 'Esc: continuar  |  R: reiniciar  |  M: trocar boss', '#fff');
  else if (state === 'win') overlay('VITÓRIA!', def.name + ' caiu. R: reiniciar  |  M: escolher boss', '#6f6');
  else if (state === 'lose') overlay('VOCÊ MORREU', 'R: tentar de novo  |  M: escolher boss', '#f55');
  drawCrosshair();
}


/* ---------- Pistoleiro Fantasma ---------- */
function* fast(n, two) {
  for (let i = 0; i < n; i++) {
    yield* warn('line', .55); const a = aim(), sp = 330 + B.phase * 40;
    if (two) for (const o of [-1, 1]) shootE(B.x + Math.cos(a + 1.57) * 16 * o, B.y + Math.sin(a + 1.57) * 16 * o, a, sp, 5, '#7fe8ff');
    else shootE(B.x, B.y, a, sp, 5, '#7fe8ff');
    burst(B.x, B.y, 5, '#bff', 150, 3, .2); yield .12;
  }
}
function* ricochet(n) {
  yield* warn('ring', .6);
  for (let i = 0; i < n; i++) { shootE(B.x, B.y, aim() + rnd(-.7, .7), 250, 6, '#9ff'); const b = eb[eb.length - 1]; b.bn = 2; b.life = 6; yield .22; }
  yield .4;
}
function* mark(n) {
  for (let i = 0; i < n; i++) {
    const x = P.x, y = P.y; haz.push({ x, y, r: 26, t: 0, delay: .9, cnt: 0 }); yield .9;
    shootE(B.x, B.y, Math.atan2(y - B.y, x - B.x), 700, 5, '#ffffff'); yield .35;
  }
}
function* spray() {
  yield* warn('ring', .6);
  for (let w = 0; w < 5; w++) { for (let i = 0; i < 7; i++) shootE(B.x, B.y, w * .4 + i * TAU / 7, 220, 5, '#9ff'); yield .35; }
}
function* duel() {
  B.duel = 1; B.tele = null; B.parried = false; yield .9; yield rnd(.4, .9);
  B.duelGo = true; yield B.phase === 3 ? .4 : .55;
  B.duelGo = false; B.duel = 2; shake = 10; flash = .15; burst(B.x, B.y, 12, '#fff', 300, 3, .3);
  const ok = B.parried || P.dashT > 0;
  if (ok) { B.hp = Math.max(0, B.hp - 100); B.hitT = .3; B.vuln = 1.8; burst(B.x, B.y, 30, '#7fe8ff', 350, 5, .6); ringFx(B.x, B.y, 90, '#7fe8ff'); }
  else hurt(2);
  yield .35; B.duel = 0; yield ok ? 1.8 : .2;
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
  const t = yield* warn('arc', .95), d = Math.atan2(P.y - B.y, P.x - B.x) - t.ang;
  B.swAng = t.ang; B.swT = .22; shake = 12; burst(B.x + Math.cos(t.ang) * 140, B.y + Math.sin(t.ang) * 140, 20, '#ffb080', 300, 5, .5);
  if (Math.hypot(P.x - B.x, P.y - B.y) < 200 && Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < .95) hurt();
  if (two) { yield .3; yield* swing(false, rec); return; }
  B.vuln = rec; yield rec;
}
function* slam(r, cnt) { haz.push({ x: B.x, y: B.y, r, t: 0, delay: 1.1, cnt }); yield 1.2; B.vuln = 1.2; yield 1.2; }
function* cracks(lines) {
  for (let l = 0; l < lines; l++) {
    const a = aim() + (l - (lines - 1) / 2) * .5;
    for (let i = 1; i <= 7; i++) { const x = B.x + Math.cos(a) * i * 78, y = B.y + Math.sin(a) * i * 78; if (!blocked(x, y)) haz.push({ x, y, r: 38, t: 0, delay: .6 + i * .13, cnt: B.phase === 3 ? 4 : 0 }); }
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
const ORDER = ['chumbo', 'fantasma', 'colosso'];
const BOSSES = {
  chumbo: { name: 'Carrasco de Chumbo', desc: ['Arena de pedra. Cones, anéis e', 'chuva de fogo em 3 fases.'], hp: 1800, r: 50, pcol: ['', '#ff9a2a', '#ff3a3a', '#ff35c8'], pause: [0, 1.4, 1.0, .7], att: ATT,
    obs: mkObs([[240, 200], [720, 200], [240, 440], [720, 440]], ['pil']), tile: (s, w) => w ? `rgb(${s + 16},${s + 12},${s + 22})` : `rgb(${s},${s + 2},${s + 10})`, dark: 'rgba(3,3,10,.74)', flame: '#ff9a2a', draw: drawChumbo },
  fantasma: { name: 'Pistoleiro Fantasma', desc: ['Cidade fantasma. Tiros precisos,', 'ricochetes e DUELO: use o dash!'], hp: 1500, r: 36, pcol: ['', '#7fe8ff', '#4fd0ff', '#d0fbff'], pause: [0, 1.3, .9, .6],
    att: { 1: [() => fast(3, false), () => ricochet(5), () => cone(2, 2), () => mark(2), duel], 2: [() => fast(4, true), () => ricochet(7), () => cone(3, 2), () => mark(3), duel], 3: [() => fast(5, true), spray, () => ricochet(8), () => mark(3), duel] },
    obs: mkObs([[280, 210], [680, 210], [280, 430], [680, 430]], ['cactus', 'barrel']), tile: (s, w) => w ? `rgb(${s + 70},${s + 35},${s + 5})` : `rgb(${s + 95},${s + 75},${s + 40})`, dark: 'rgba(25,12,6,.55)', flame: '#ffcf70', draw: drawGhost, fx: fxGhost,
    upd(dt) { if (B.duelGo && P.dashT > 0) B.parried = true; B.duelA += ((B.duel ? 1 : 0) - B.duelA) * Math.min(1, dt * 6); } },
  colosso: { name: 'Carrasco Colossal', desc: ['Castelo em ruínas. Golpes pesados:', 'ataque quando ele se cansa.'], hp: 2200, r: 56, pcol: ['', '#ff3030', '#ff5020', '#ff0080'], pause: [0, 1.0, .8, .6],
    att: { 1: [() => swing(false), () => slam(150, 14), () => cracks(1)], 2: [() => swing(true), () => slam(170, 16), () => cracks(2), () => charge(false)], 3: [() => swing(true), () => slam(230, 22), () => cracks(3), () => charge(true), swingCharge] },
    obs: mkObs([[300, 230], [660, 230], [300, 420], [660, 420]], ['col']), tile: (s, w) => w ? `rgb(${s + 22},${s + 8},${s + 4})` : `rgb(${s + 6},${s - 2},${s - 2})`, dark: 'rgba(14,2,2,.72)', flame: '#ff4010', draw: drawKnight }
};

/* ---------- Seleção de boss ---------- */
function cardRect(i) { return { x: 45 + (i % 3) * 295, y: 100 + ((i / 3) | 0) * 255, w: 270, h: 235 }; }
function inCard(i) { const r = cardRect(i); return mouse.x > r.x && mouse.x < r.x + r.w && mouse.y > r.y && mouse.y < r.y + r.h; }
function preview(id, cx, cy) {
  const sB = B, sD = def, sP = PCOL; def = BOSSES[id]; PCOL = def.pcol;
  B = { x: 0, y: 0, t: time, hitT: 0, phase: 1, tele: null, vuln: 0, swT: 0, r: def.r };
  ctx.save(); ctx.translate(cx, cy); ctx.scale(.5, .5); def.draw(); ctx.restore();
  B = sB; def = sD; PCOL = sP;
}
function drawSelect() {
  ctx.fillStyle = '#0a0a10'; ctx.fillRect(0, 0, W, H);
  txt('ESCOLHA SEU BOSS', W / 2, 60, 36, '#ff9a2a'); txt('Clique ou tecle o número  |  ✔ = derrotado nesta sessão', W / 2, 88, 14, '#aaa');
  ORDER.forEach((id, i) => {
    const d = BOSSES[id], r = cardRect(i), hov = inCard(i);
    ctx.fillStyle = hov ? '#2a2a3a' : '#16161f'; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeStyle = won[id] ? '#55ff55' : hov ? '#fff' : '#444'; ctx.lineWidth = 3; ctx.strokeRect(r.x, r.y, r.w, r.h);
    preview(id, r.x + r.w / 2, r.y + 105);
    txt((i + 1) + '. ' + d.name, r.x + r.w / 2, r.y + 185, 16, '#fff'); d.desc.forEach((l, k) => txt(l, r.x + r.w / 2, r.y + 205 + k * 16, 12, '#aaa'));
    if (won[id]) txt('✔', r.x + r.w - 20, r.y + 28, 26, '#55ff55');
  });
}
function pickCard() { ORDER.forEach((id, i) => { if (inCard(i)) start(id); }); }

/* ---------- Controles e loop ---------- */
function setMouse(e) { const r = cv.getBoundingClientRect(); mouse.x = (e.clientX - r.left) * W / r.width; mouse.y = (e.clientY - r.top) * H / r.height; }
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'Escape' && !e.repeat) { if (state === 'play') state = 'pause'; else if (state === 'pause') state = 'play'; }
  if (e.code === 'KeyR' && ['win', 'lose', 'pause'].includes(state)) start(cur);
  if (e.code === 'KeyM' && ['win', 'lose', 'pause'].includes(state)) state = 'select';
  if (state === 'select' && /^Digit[1-9]$/.test(e.code)) { const id = ORDER[+e.code[5] - 1]; if (id) start(id); }
  if (e.code === 'Enter' && state === 'menu') state = 'select';
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
cv.addEventListener('mousemove', setMouse);
cv.addEventListener('mousedown', e => { setMouse(e); if (e.button === 0) { mouse.l = true; if (state === 'menu') state = 'select'; else if (state === 'select') pickCard(); } if (e.button === 2) mouse.r = true; });
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('blur', () => { mouse.l = mouse.r = false; for (const k in keys) keys[k] = false; if (state === 'play') state = 'pause'; });

let last = performance.now();
function loop(n) {
  const dt = Math.min(.033, (n - last) / 1000); last = n; time += dt;
  if (state === 'play') update(dt);
  else if (state === 'win' || state === 'lose') { stateT += dt; updateFx(dt); B.shown += (B.hp - B.shown) * Math.min(1, dt * 4); }
  flash = Math.max(0, flash - dt);
  render(); requestAnimationFrame(loop);
}
reset('chumbo'); requestAnimationFrame(loop);
})();
