/* Calles Muertas – Entrega 1 (prototipo)
 * Canvas 2D, sin dependencias. Movimiento con joystick táctil (o WASD/flechas),
 * disparo automático al zombi más cercano, zombis que persiguen por las calles.
 */
(function () {
  'use strict';

  // ---------- Configuración ----------
  const CFG = {
    street: 220,          // ancho de calle (pasillo)
    block: 420,           // tamaño de manzana
    blocks: 5,            // manzanas por lado
    cell: 40,             // celda de la grilla de navegación
    player: { r: 18, speed: 165, maxHp: 100, regen: 1.5, regenDelay: 3 },
    zombie: { r: 18, hp: 30, minSpeed: 55, maxSpeed: 88, dps: 14, max: 32 },
    weapon: { name: 'Pistola', damage: 10, fireRate: 4, mag: 12, reload: 1.4, range: 300, bulletSpeed: 950, spread: 0.04 },
    spawn: { start: 2.2, min: 0.7, ramp: 0.012, minDist: 520, maxDist: 900 }
  };

  // ---------- Utilidades ----------
  let seed = 20261110;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1, zoom = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    // El lado más corto muestra ~640 unidades de mundo: el rango del arma (300) queda dentro de la pantalla
    zoom = clamp(Math.min(W, H) / 640, 0.5, 1.4);
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 100));
  resize();

  // ---------- Mapa ----------
  const PERIOD = CFG.street + CFG.block;
  const WORLD = CFG.street + CFG.blocks * PERIOD;
  const ROOF_COLORS = ['#8a6f5a', '#6f7a86', '#9a8a6a', '#7a6a7e', '#5f7d6a', '#a07a5a', '#6a6a6a'];
  const buildings = [];
  const props = []; // autos/basureros: también son obstáculos
  function buildMap() {
    seed = 20261110;
    for (let by = 0; by < CFG.blocks; by++) for (let bx = 0; bx < CFG.blocks; bx++) {
      const x0 = CFG.street + bx * PERIOD, y0 = CFG.street + by * PERIOD, s = CFG.block;
      const r = rnd();
      if (r < 0.35) {
        buildings.push(mkB(x0, y0, s, s));
      } else if (r < 0.7) { // dos edificios con callejón
        const gap = 70, cut = s * (0.35 + rnd() * 0.3);
        if (rnd() < 0.5) { buildings.push(mkB(x0, y0, cut - gap / 2, s)); buildings.push(mkB(x0 + cut + gap / 2, y0, s - cut - gap / 2, s)); }
        else { buildings.push(mkB(x0, y0, s, cut - gap / 2)); buildings.push(mkB(x0, y0 + cut + gap / 2, s, s - cut - gap / 2)); }
      } else { // cuatro edificios
        const g = 70, h = (s - g) / 2;
        buildings.push(mkB(x0, y0, h, h)); buildings.push(mkB(x0 + h + g, y0, h, h));
        buildings.push(mkB(x0, y0 + h + g, h, h)); buildings.push(mkB(x0 + h + g, y0 + h + g, h, h));
      }
    }
    // autos abandonados en algunas calles
    for (let i = 0; i < 22; i++) {
      const horiz = rnd() < 0.5;
      const lane = Math.floor(rnd() * (CFG.blocks + 1));
      const along = CFG.street + rnd() * (WORLD - CFG.street * 2);
      const c = lane * PERIOD + CFG.street / 2 + (rnd() < 0.5 ? -45 : 45);
      const w = horiz ? 78 : 40, h = horiz ? 40 : 78;
      const x = horiz ? along : c - w / 2, y = horiz ? c - h / 2 : along;
      if (Math.hypot(x - WORLD / 2, y - WORLD / 2) < 300) continue;
      props.push({ x, y, w, h, kind: 'car', color: pick(['#b84a3a', '#3a6eb8', '#d8c24a', '#e0e0d8', '#4a8a5a']) });
    }
  }
  function mkB(x, y, w, h) {
    const b = { x, y, w, h, color: ROOF_COLORS[(rnd() * ROOF_COLORS.length) | 0], details: [] };
    const n = 1 + ((rnd() * 3) | 0);
    for (let i = 0; i < n; i++) b.details.push({ x: x + 20 + rnd() * (w - 70), y: y + 20 + rnd() * (h - 60), w: 26 + rnd() * 24, h: 20 + rnd() * 16 });
    return b;
  }
  buildMap();
  const solids = buildings.concat(props);

  // Grilla de navegación + campo de flujo (BFS desde el jugador)
  const GN = Math.ceil(WORLD / CFG.cell);
  const blocked = new Uint8Array(GN * GN);
  const flow = new Int32Array(GN * GN);
  (function () {
    const pad = 12;
    for (let gy = 0; gy < GN; gy++) for (let gx = 0; gx < GN; gx++) {
      const cx = (gx + 0.5) * CFG.cell, cy = (gy + 0.5) * CFG.cell;
      for (const s of solids) {
        if (cx > s.x - pad && cx < s.x + s.w + pad && cy > s.y - pad && cy < s.y + s.h + pad) { blocked[gy * GN + gx] = 1; break; }
      }
    }
  })();
  const queue = new Int32Array(GN * GN);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function cellOf(x, y) { return [clamp((x / CFG.cell) | 0, 0, GN - 1), clamp((y / CFG.cell) | 0, 0, GN - 1)]; }
  function computeFlow(px, py) {
    flow.fill(-1);
    let [sx, sy] = cellOf(px, py);
    let head = 0, tail = 0;
    const s = sy * GN + sx; flow[s] = 0; queue[tail++] = s;
    while (head < tail) {
      const c = queue[head++], cx = c % GN, cy = (c / GN) | 0, d = flow[c];
      for (let i = 0; i < 8; i++) {
        const nx = cx + DIRS[i][0], ny = cy + DIRS[i][1];
        if (nx < 0 || ny < 0 || nx >= GN || ny >= GN) continue;
        const n = ny * GN + nx;
        if (blocked[n] || flow[n] !== -1) continue;
        if (i >= 4 && (blocked[cy * GN + nx] || blocked[ny * GN + cx])) continue; // no cortar esquinas
        flow[n] = d + 1; queue[tail++] = n;
      }
    }
  }

  // Colisión círculo vs rectángulos
  function collide(e) {
    for (const s of solids) {
      const qx = clamp(e.x, s.x, s.x + s.w), qy = clamp(e.y, s.y, s.y + s.h);
      let dx = e.x - qx, dy = e.y - qy; const d2 = dx * dx + dy * dy;
      if (d2 < e.r * e.r) {
        if (d2 > 0.0001) { const d = Math.sqrt(d2), p = e.r - d; e.x += dx / d * p; e.y += dy / d * p; }
        else { // centro dentro: empujar por el lado más cercano
          const l = e.x - s.x, r = s.x + s.w - e.x, t = e.y - s.y, b = s.y + s.h - e.y, m = Math.min(l, r, t, b);
          if (m === l) e.x = s.x - e.r; else if (m === r) e.x = s.x + s.w + e.r; else if (m === t) e.y = s.y - e.r; else e.y = s.y + s.h + e.r;
        }
      }
    }
    e.x = clamp(e.x, e.r, WORLD - e.r); e.y = clamp(e.y, e.r, WORLD - e.r);
  }
  function pointInSolid(x, y) {
    if (x < 0 || y < 0 || x > WORLD || y > WORLD) return true;
    for (const s of buildings) if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h) return true;
    return false;
  }
  function lineOfSight(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(d / 14);
    for (let i = 1; i < steps; i++) { const t = i / steps; if (pointInSolid(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false; }
    return true;
  }

  // ---------- Sonido (WebAudio, sintetizado) ----------
  let actx = null, drone = null;
  function initAudio() {
    if (actx) { if (actx.state === 'suspended') actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      // ambiente tenso: dos osciladores graves desafinados + ruido filtrado suave
      const g = actx.createGain(); g.gain.value = 0.05; g.connect(actx.destination);
      const o1 = actx.createOscillator(), o2 = actx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = 55; o2.frequency.value = 55.7;
      const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
      o1.connect(f); o2.connect(f); f.connect(g); o1.start(); o2.start();
      const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = 0.12; lg.gain.value = 0.03;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      drone = g;
    } catch (e) { actx = null; }
  }
  function sfx(type) {
    if (!actx || actx.state !== 'running') return;
    const t = actx.currentTime, g = actx.createGain(); g.connect(actx.destination);
    if (type === 'shot') {
      const len = 0.08, buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      const s = actx.createBufferSource(); s.buffer = buf; const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      s.connect(f); f.connect(g); g.gain.value = 0.25; s.start(t);
    } else {
      const o = actx.createOscillator(); o.connect(g);
      if (type === 'hurt') { o.type = 'square'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.15); g.gain.setValueAtTime(0.08, t); }
      else if (type === 'kill') { o.type = 'triangle'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); g.gain.setValueAtTime(0.15, t); }
      else if (type === 'reload') { o.type = 'square'; o.frequency.setValueAtTime(900, t); g.gain.setValueAtTime(0.04, t); }
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.start(t); o.stop(t + 0.26);
    }
  }

  // ---------- Estado ----------
  const SHIRTS = ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad', '#e67e22', '#ecf0f1', '#34495e', '#d35400', '#16a085', '#e84393'];
  const PANTS = ['#2c3e50', '#5d4037', '#1f4e79', '#4a4a4a', '#6d5d3b', '#283593', '#3e2723'];
  const SKINS = ['#8fbf72', '#9cc27a', '#7fae6a', '#a8b878', '#88a868'];
  let state, running = false, paused = false, over = false;
  function newState() {
    const c = CFG.street / 2 + Math.floor(CFG.blocks / 2) * PERIOD;
    return {
      t: 0,
      player: { x: c, y: c, r: CFG.player.r, hp: CFG.player.maxHp, lastHit: -99, face: 0, aim: 0, walk: 0, moving: false, flash: 0 },
      zombies: [], bullets: [], particles: [], decals: [], flashes: [],
      kills: 0, shots: 0, hits: 0,
      weapon: { ammo: CFG.weapon.mag, cd: 0, reloading: 0 },
      spawnT: 1.0, flowT: 0, cam: { x: c, y: c }, shake: 0
    };
  }

  // ---------- Entrada ----------
  const keys = {};
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, dx: 0, dy: 0, active: false };
  const JOY_R = 60;
  canvas.addEventListener('pointerdown', e => {
    initAudio();
    if (joy.id !== null || !running || paused || over) return;
    joy.id = e.pointerId; joy.active = true; joy.ox = joy.x = e.clientX; joy.oy = joy.y = e.clientY; joy.dx = joy.dy = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const d = Math.hypot(dx, dy);
    if (d > JOY_R) { // la base sigue al dedo si se pasa
      joy.ox += dx / d * (d - JOY_R); joy.oy += dy / d * (d - JOY_R); dx = e.clientX - joy.ox; dy = e.clientY - joy.oy;
    }
    joy.x = e.clientX; joy.y = e.clientY; joy.dx = dx / JOY_R; joy.dy = dy / JOY_R;
    e.preventDefault();
  });
  function endJoy(e) { if (e.pointerId !== joy.id) return; joy.id = null; joy.active = false; joy.dx = joy.dy = 0; }
  canvas.addEventListener('pointerup', endJoy);
  canvas.addEventListener('pointercancel', endJoy);
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', e => e.preventDefault());

  // ---------- UI ----------
  const $ = id => document.getElementById(id);
  const ui = { hud: $('hud'), hpFill: $('hpFill'), hpText: $('hpText'), kills: $('kills'), ammo: $('ammo'), damage: $('damage'),
    menu: $('menu'), pause: $('pause'), gameover: $('gameover'), goKills: $('goKills'), goTime: $('goTime') };
  function start() {
    initAudio();
    state = newState(); computeFlow(state.player.x, state.player.y);
    running = true; paused = false; over = false;
    ui.menu.classList.add('hidden'); ui.pause.classList.add('hidden'); ui.gameover.classList.add('hidden'); ui.hud.classList.remove('hidden');
    joy.id = null; joy.active = false; joy.dx = joy.dy = 0;
    if (drone) drone.gain.value = 0.05;
  }
  function togglePause(force) {
    if (!running || over) return;
    paused = typeof force === 'boolean' ? force : !paused;
    ui.pause.classList.toggle('hidden', !paused);
    joy.id = null; joy.active = false; joy.dx = joy.dy = 0;
    if (actx) paused ? actx.suspend() : actx.resume();
  }
  function gameOver() {
    over = true;
    const s = Math.floor(state.t);
    ui.goKills.textContent = state.kills; ui.goTime.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    setTimeout(() => ui.gameover.classList.remove('hidden'), 700);
  }
  $('startBtn').addEventListener('click', start);
  $('restartBtn').addEventListener('click', start);
  $('restartBtn2').addEventListener('click', start);
  $('resumeBtn').addEventListener('click', () => togglePause(false));
  $('pauseBtn').addEventListener('click', () => togglePause());
  document.addEventListener('visibilitychange', () => { if (document.hidden && running && !over) togglePause(true); });
  let lastHud = '';
  function updateHud() {
    const p = state.player, w = state.weapon, hp = Math.ceil(p.hp);
    const ammoTxt = w.reloading > 0 ? 'Recargando…' : w.ammo + ' / ∞';
    const key = hp + '|' + state.kills + '|' + ammoTxt;
    if (key === lastHud) return; lastHud = key;
    ui.hpFill.style.width = (p.hp / CFG.player.maxHp * 100) + '%';
    ui.hpFill.classList.toggle('low', p.hp < 35);
    ui.hpText.textContent = hp;
    ui.kills.textContent = state.kills;
    ui.ammo.textContent = ammoTxt; ui.ammo.classList.toggle('reload', w.reloading > 0);
  }

  // ---------- Lógica ----------
  function spawnZombie() {
    const p = state.player, viewR = Math.hypot(W, H) / 2 / zoom + 40;
    for (let tries = 0; tries < 30; tries++) {
      const a = Math.random() * Math.PI * 2, d = rand(Math.max(CFG.spawn.minDist, viewR), Math.max(CFG.spawn.maxDist, viewR + 300));
      const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
      if (x < 30 || y < 30 || x > WORLD - 30 || y > WORLD - 30) continue;
      const [gx, gy] = cellOf(x, y), c = gy * GN + gx;
      if (blocked[c] || flow[c] < 0) continue;
      const diff = Math.min(state.t / 120, 1);
      state.zombies.push({
        x, y, r: CFG.zombie.r, hp: CFG.zombie.hp, maxHp: CFG.zombie.hp,
        speed: rand(CFG.zombie.minSpeed, CFG.zombie.maxSpeed) * (1 + diff * 0.25),
        shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: pick(['#3b2a1a', '#111', '#7a5a2a', '#999', null]),
        face: 0, walk: Math.random() * 6, hit: 0, kx: 0, ky: 0, groan: rand(2, 8)
      });
      return true;
    }
    return false;
  }
  function nearestTarget() {
    const p = state.player, R = CFG.weapon.range; let best = null, bd = R * R;
    for (const z of state.zombies) {
      const dx = z.x - p.x, dy = z.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 < bd && lineOfSight(p.x, p.y, z.x, z.y)) { bd = d2; best = z; }
    }
    return best;
  }
  function update(dt) {
    const S = state, p = S.player, w = S.weapon, WC = CFG.weapon;
    S.t += dt;
    if (!over) {
      // Movimiento
      let mx = 0, my = 0;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
      if (keys.KeyW || keys.ArrowUp) my -= 1; if (keys.KeyS || keys.ArrowDown) my += 1;
      if (joy.active) { mx += joy.dx; my += joy.dy; }
      let m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; m = 1; }
      if (m < 0.12) { mx = my = 0; m = 0; }
      p.moving = m > 0;
      if (p.moving) { p.x += mx * CFG.player.speed * dt; p.y += my * CFG.player.speed * dt; p.face = Math.atan2(my, mx); p.walk += dt * 9 * m; }
      collide(p);
      // Regeneración lenta
      if (S.t - p.lastHit > CFG.player.regenDelay) p.hp = Math.min(CFG.player.maxHp, p.hp + CFG.player.regen * dt);

      // Arma automática
      w.cd -= dt;
      if (w.reloading > 0) { w.reloading -= dt; if (w.reloading <= 0) { w.ammo = WC.mag; w.reloading = 0; } }
      const tgt = nearestTarget();
      if (tgt) {
        const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
        p.aim = a; p.hasTarget = true;
        if (w.cd <= 0 && w.reloading <= 0 && w.ammo > 0) {
          w.cd = 1 / WC.fireRate; w.ammo--; S.shots++;
          const sa = a + rand(-WC.spread, WC.spread);
          const mxp = p.x + Math.cos(a) * 30, myp = p.y + Math.sin(a) * 30;
          S.bullets.push({ x: mxp, y: myp, vx: Math.cos(sa) * WC.bulletSpeed, vy: Math.sin(sa) * WC.bulletSpeed, life: WC.range / WC.bulletSpeed + 0.05, px: mxp, py: myp });
          S.flashes.push({ x: mxp, y: myp, a, t: 0.06 });
          sfx('shot');
          if (w.ammo === 0) { w.reloading = WC.reload; sfx('reload'); }
        }
      } else {
        p.hasTarget = false; p.aim = p.face;
        if (w.ammo < WC.mag && w.reloading <= 0 && w.cd < -1.2) { w.reloading = WC.reload; sfx('reload'); } // recarga táctica
      }

      // Aparición de zombis
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        const n = S.t > 60 ? 2 : 1;
        for (let i = 0; i < n; i++) if (S.zombies.length < CFG.zombie.max) spawnZombie();
        S.spawnT = Math.max(CFG.spawn.min, CFG.spawn.start - S.t * CFG.spawn.ramp) * rand(0.7, 1.3);
      }
    }

    // Campo de flujo
    S.flowT -= dt;
    if (S.flowT <= 0) { computeFlow(p.x, p.y); S.flowT = 0.25; }

    // Zombis
    for (const z of S.zombies) {
      let tx, ty;
      const dxp = p.x - z.x, dyp = p.y - z.y, dp = Math.hypot(dxp, dyp);
      if (dp < 140 && lineOfSight(z.x, z.y, p.x, p.y)) { tx = dxp / dp; ty = dyp / dp; }
      else {
        const [gx, gy] = cellOf(z.x, z.y); let best = flow[gy * GN + gx], bx = 0, byy = 0;
        if (best < 0) best = 1e9;
        for (let i = 0; i < 8; i++) {
          const nx = gx + DIRS[i][0], ny = gy + DIRS[i][1];
          if (nx < 0 || ny < 0 || nx >= GN || ny >= GN) continue;
          const f = flow[ny * GN + nx];
          if (f >= 0 && f < best) { best = f; bx = DIRS[i][0]; byy = DIRS[i][1]; }
        }
        if (bx || byy) {
          const cx = (gx + bx + 0.5) * CFG.cell - z.x, cy = (gy + byy + 0.5) * CFG.cell - z.y, d = Math.hypot(cx, cy) || 1;
          tx = cx / d; ty = cy / d;
        } else { tx = dxp / (dp || 1); ty = dyp / (dp || 1); }
      }
      // separación entre zombis
      let sx = 0, sy = 0;
      for (const o of S.zombies) {
        if (o === z) continue;
        const ox = z.x - o.x, oy = z.y - o.y, d2 = ox * ox + oy * oy, rr = (z.r + o.r) * 1.1;
        if (d2 < rr * rr && d2 > 0.01) { const d = Math.sqrt(d2); sx += ox / d * (rr - d) / rr; sy += oy / d * (rr - d) / rr; }
      }
      const vx = tx + sx * 1.5, vy = ty + sy * 1.5, vm = Math.hypot(vx, vy) || 1;
      const hitSlow = z.hit > 0 ? 0.35 : 1;
      if (!over) { z.x += (vx / vm) * z.speed * hitSlow * dt + z.kx * dt; z.y += (vy / vm) * z.speed * hitSlow * dt + z.ky * dt; }
      z.kx *= Math.pow(0.001, dt); z.ky *= Math.pow(0.001, dt);
      z.face = Math.atan2(ty, tx); z.walk += dt * z.speed * 0.08; z.hit = Math.max(0, z.hit - dt);
      collide(z);
      // daño por contacto
      if (!over && dp < z.r + p.r + 4) {
        p.hp -= CFG.zombie.dps * dt;
        if (S.t - p.lastHit > 0.35) { sfx('hurt'); S.shake = 6; p.flash = 0.2; }
        if (S.t - p.lastHit > 0.1) ui.damage.style.opacity = 1;
        p.lastHit = S.t;
        if (p.hp <= 0) { p.hp = 0; gameOver(); }
      }
    }
    if (S.t - p.lastHit > 0.3) ui.damage.style.opacity = 0;
    p.flash = Math.max(0, p.flash - dt);

    // Balas
    for (const b of S.bullets) {
      b.px = b.x; b.py = b.y;
      const steps = 3;
      for (let k = 0; k < steps && b.life > 0; k++) {
        b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
        if (pointInSolid(b.x, b.y)) { b.life = 0; burst(b.x, b.y, '#d8d0b0', 4, 80); break; }
        for (const z of S.zombies) {
          if (z.hp <= 0) continue;
          const dx = z.x - b.x, dy = z.y - b.y;
          if (dx * dx + dy * dy < (z.r + 3) * (z.r + 3)) {
            z.hp -= CFG.weapon.damage; z.hit = 0.12; S.hits++;
            const bm = Math.hypot(b.vx, b.vy); z.kx += b.vx / bm * 160; z.ky += b.vy / bm * 160;
            burst(b.x, b.y, '#7a1a12', 6, 140);
            b.life = 0;
            if (z.hp <= 0) killZombie(z);
            break;
          }
        }
        if (b.life <= 0) break;
      }
      b.life -= dt;
    }
    S.bullets = S.bullets.filter(b => b.life > 0);
    S.zombies = S.zombies.filter(z => z.hp > 0);
    for (const q of S.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy *= 0.9; q.life -= dt; }
    S.particles = S.particles.filter(q => q.life > 0);
    for (const f of S.flashes) f.t -= dt;
    S.flashes = S.flashes.filter(f => f.t > 0);
    S.shake = Math.max(0, S.shake - dt * 30);

    // Cámara
    const k = 1 - Math.pow(0.0005, dt);
    S.cam.x += (p.x - S.cam.x) * k; S.cam.y += (p.y - S.cam.y) * k;
  }
  function burst(x, y, color, n, sp) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, s = rand(sp * 0.3, sp); state.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.2, 0.45), color, r: rand(1.5, 3.5) }); }
  }
  function killZombie(z) {
    state.kills++; sfx('kill');
    burst(z.x, z.y, '#6a140e', 14, 200);
    state.decals.push({ x: z.x, y: z.y, r: rand(14, 22), rot: Math.random() * 6, shirt: z.shirt, pants: z.pants, skin: z.skin, face: z.face });
    if (state.decals.length > 60) state.decals.shift();
  }

  // ---------- Dibujo ----------
  function drawMap(vx0, vy0, vx1, vy1) {
    // asfalto
    ctx.fillStyle = '#4b5052'; ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    // bordes del mundo
    ctx.fillStyle = '#1c201a';
    if (vx0 < 0) ctx.fillRect(vx0, vy0, -vx0, vy1 - vy0);
    if (vy0 < 0) ctx.fillRect(vx0, vy0, vx1 - vx0, -vy0);
    if (vx1 > WORLD) ctx.fillRect(WORLD, vy0, vx1 - WORLD, vy1 - vy0);
    if (vy1 > WORLD) ctx.fillRect(vx0, WORLD, vx1 - vx0, vy1 - WORLD);
    // líneas centrales discontinuas
    ctx.strokeStyle = '#d8c25a'; ctx.lineWidth = 4; ctx.setLineDash([28, 26]);
    ctx.beginPath();
    for (let i = 0; i <= CFG.blocks; i++) {
      const c = i * PERIOD + CFG.street / 2;
      if (c > vy0 - 10 && c < vy1 + 10) { ctx.moveTo(Math.max(0, vx0), c); ctx.lineTo(Math.min(WORLD, vx1), c); }
      if (c > vx0 - 10 && c < vx1 + 10) { ctx.moveTo(c, Math.max(0, vy0)); ctx.lineTo(c, Math.min(WORLD, vy1)); }
    }
    ctx.stroke(); ctx.setLineDash([]);
    // veredas (manzanas)
    for (let by = 0; by < CFG.blocks; by++) for (let bx = 0; bx < CFG.blocks; bx++) {
      const x = CFG.street + bx * PERIOD - 16, y = CFG.street + by * PERIOD - 16, s = CFG.block + 32;
      if (x > vx1 || y > vy1 || x + s < vx0 || y + s < vy0) continue;
      ctx.fillStyle = '#8d8a80'; ctx.fillRect(x, y, s, s);
      ctx.strokeStyle = '#6e6b62'; ctx.lineWidth = 3; ctx.strokeRect(x, y, s, s);
      ctx.fillStyle = '#5a5e55'; ctx.fillRect(x + 16, y + 16, CFG.block, CFG.block); // callejones
    }
    // manchas
    for (const d of state.decals) {
      if (d.x < vx0 - 40 || d.x > vx1 + 40 || d.y < vy0 - 40 || d.y > vy1 + 40) continue;
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      ctx.fillStyle = 'rgba(110,18,12,0.55)'; ctx.beginPath(); ctx.ellipse(0, 0, d.r * 1.4, d.r, 0, 0, 6.283); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.face + Math.PI / 2);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = d.pants; ctx.fillRect(-9, 4, 18, 14);
      ctx.fillStyle = d.shirt; ctx.beginPath(); ctx.ellipse(0, 0, 13, 9, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = d.skin; ctx.beginPath(); ctx.arc(0, -11, 7, 0, 6.283); ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();
    }
  }
  function drawSolids(vx0, vy0, vx1, vy1) {
    for (const p of props) {
      if (p.x > vx1 || p.y > vy1 || p.x + p.w < vx0 || p.y + p.h < vy0) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(p.x + 4, p.y + 5, p.w, p.h, 9); ctx.fill();
      ctx.fillStyle = p.color; ctx.strokeStyle = '#141414'; ctx.lineWidth = 3; rr(p.x, p.y, p.w, p.h, 9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9ac4d8';
      if (p.w > p.h) { ctx.fillRect(p.x + p.w * 0.22, p.y + 6, p.w * 0.14, p.h - 12); ctx.fillRect(p.x + p.w * 0.62, p.y + 6, p.w * 0.12, p.h - 12); }
      else { ctx.fillRect(p.x + 6, p.y + p.h * 0.22, p.w - 12, p.h * 0.14); ctx.fillRect(p.x + 6, p.y + p.h * 0.62, p.w - 12, p.h * 0.12); }
    }
    for (const b of buildings) {
      if (b.x > vx1 + 20 || b.y > vy1 + 20 || b.x + b.w < vx0 - 20 || b.y + b.h < vy0 - 20) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(b.x + 10, b.y + 12, b.w, b.h);
      ctx.fillStyle = b.color; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(b.x + 10, b.y + 10, b.w - 20, b.h - 20);
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 4; ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(b.x + 10, b.y + 10, b.w - 20, b.h - 20);
      for (const d of b.details) {
        ctx.fillStyle = '#b8b8b0'; ctx.strokeStyle = '#141414'; ctx.lineWidth = 2;
        ctx.fillRect(d.x, d.y, d.w, d.h); ctx.strokeRect(d.x, d.y, d.w, d.h);
        ctx.beginPath(); ctx.arc(d.x + d.w / 2, d.y + d.h / 2, Math.min(d.w, d.h) * 0.3, 0, 6.283); ctx.stroke();
      }
    }
  }
  const ENT = 1.2; // escala de dibujo de personajes
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawZombie(z) {
    ctx.save(); ctx.translate(z.x, z.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(3, 5, z.r + 2, z.r - 2, 0, 0, 6.283); ctx.fill();
    ctx.scale(ENT, ENT); ctx.rotate(z.face);
    const sw = Math.sin(z.walk) * 5;
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#141414';
    // piernas (pantalón)
    ctx.fillStyle = z.pants;
    ctx.beginPath(); ctx.ellipse(-2 + sw, -6, 7, 5, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-2 - sw, 6, 7, 5, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    // brazos estirados
    ctx.fillStyle = z.skin;
    ctx.beginPath(); ctx.ellipse(13, -9 + sw * 0.3, 9, 3.6, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(13, 9 - sw * 0.3, 9, 3.6, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    // torso (camisa)
    ctx.fillStyle = z.hit > 0 ? '#ffffff' : z.shirt;
    ctx.beginPath(); ctx.ellipse(0, 0, 9, 13, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(110,20,15,0.5)'; ctx.beginPath(); ctx.arc(-2, 4, 3, 0, 6.283); ctx.fill();
    // cabeza
    ctx.fillStyle = z.hit > 0 ? '#ffffff' : z.skin;
    ctx.beginPath(); ctx.arc(3, 0, 8, 0, 6.283); ctx.fill(); ctx.stroke();
    if (z.hair) { ctx.fillStyle = z.hair; ctx.beginPath(); ctx.arc(1, 0, 7, Math.PI * 0.55, Math.PI * 1.45); ctx.fill(); }
    ctx.fillStyle = '#d42a1a'; ctx.beginPath(); ctx.arc(8, -3, 1.8, 0, 6.283); ctx.arc(8, 3, 1.8, 0, 6.283); ctx.fill();
    ctx.restore();
    if (z.hp < z.maxHp) {
      ctx.fillStyle = '#111'; ctx.fillRect(z.x - 14, z.y - z.r - 12, 28, 5);
      ctx.fillStyle = '#e8463a'; ctx.fillRect(z.x - 13, z.y - z.r - 11, 26 * Math.max(0, z.hp) / z.maxHp, 3);
    }
  }
  function drawPlayer(p) {
    ctx.save(); ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(3, 5, p.r + 2, p.r - 2, 0, 0, 6.283); ctx.fill();
    ctx.scale(ENT, ENT);
    // cuerpo agachado mirando hacia donde camina
    ctx.save(); ctx.rotate(p.face);
    const sw = p.moving ? Math.sin(p.walk) * 4 : 0;
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#141414';
    ctx.fillStyle = '#3d4a2e';
    ctx.beginPath(); ctx.ellipse(-4 + sw, -6, 6, 4.5, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-4 - sw, 6, 6, 4.5, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6b4a2a'; rr(-15, -8, 9, 16, 3); ctx.fill(); ctx.stroke(); // mochila
    ctx.fillStyle = p.flash > 0 ? '#ff8a7a' : '#2f6db0';
    ctx.beginPath(); ctx.ellipse(-1, 0, 10, 12, 0, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.restore();
    // brazos + arma apuntando
    ctx.save(); ctx.rotate(p.aim);
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#141414';
    ctx.fillStyle = '#e8b98a';
    ctx.beginPath(); ctx.ellipse(10, -5, 7, 3.5, 0.2, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(10, 5, 7, 3.5, -0.2, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#222'; ctx.fillRect(14, -2.5, 12, 5); ctx.strokeRect(14, -2.5, 12, 5);
    // cabeza con gorra
    ctx.fillStyle = '#e8b98a'; ctx.beginPath(); ctx.arc(2, 0, 7.5, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c0392b'; ctx.beginPath(); ctx.arc(1, 0, 7.5, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
    ctx.fillRect(4, -5, 6, 10);
    ctx.restore();
    ctx.restore();
  }
  function drawJoystick() {
    if (!joy.active) return;
    ctx.save();
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(joy.ox, joy.oy, JOY_R, 0, 6.283); ctx.fill();
    ctx.globalAlpha = 0.6; ctx.strokeStyle = '#f3ecd2'; ctx.lineWidth = 3; ctx.stroke();
    const k = Math.min(1, Math.hypot(joy.dx, joy.dy)), a = Math.atan2(joy.dy, joy.dx);
    ctx.globalAlpha = 0.8; ctx.fillStyle = '#f3ecd2';
    ctx.beginPath(); ctx.arc(joy.ox + Math.cos(a) * k * JOY_R, joy.oy + Math.sin(a) * k * JOY_R, 26, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  function drawHint() {
    if (!running || state.t > 6 || joy.active) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, (6 - state.t) / 1.5) * 0.85;
    ctx.fillStyle = '#f3ecd2'; ctx.font = 'bold 16px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = '#000'; ctx.shadowBlur = 4;
    ctx.fillText('Arrastra el dedo para moverte', W / 2, H - 40 - (parseFloat(getComputedStyle(document.body).paddingBottom) || 0));
    ctx.restore();
  }
  function render() {
    const S = state; if (!S) return;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#1c201a'; ctx.fillRect(0, 0, W, H);
    const shx = S.shake ? rand(-S.shake, S.shake) : 0, shy = S.shake ? rand(-S.shake, S.shake) : 0;
    const cx = S.cam.x, cy = S.cam.y;
    ctx.setTransform(DPR * zoom, 0, 0, DPR * zoom, DPR * (W / 2 - cx * zoom + shx), DPR * (H / 2 - cy * zoom + shy));
    const hw = W / 2 / zoom + 20, hh = H / 2 / zoom + 20;
    const vx0 = cx - hw, vy0 = cy - hh, vx1 = cx + hw, vy1 = cy + hh;
    drawMap(vx0, vy0, vx1, vy1);
    // rango del arma (sutil)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(S.player.x, S.player.y, CFG.weapon.range, 0, 6.283); ctx.stroke();
    for (const z of S.zombies) if (z.x > vx0 - 30 && z.x < vx1 + 30 && z.y > vy0 - 30 && z.y < vy1 + 30) drawZombie(z);
    if (!over || Math.floor(S.t * 8) % 2) drawPlayer(S.player);
    // balas
    ctx.lineCap = 'round';
    for (const b of S.bullets) {
      const sp = Math.hypot(b.vx, b.vy), tx = b.x - b.vx / sp * 18, ty = b.y - b.vy / sp * 18;
      ctx.strokeStyle = 'rgba(255,220,120,0.5)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const f of S.flashes) {
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.fillStyle = '#ffd54a';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(16, 0); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(2, 0, 4, 0, 6.283); ctx.fill(); ctx.restore();
    }
    for (const q of S.particles) { ctx.globalAlpha = Math.min(1, q.life * 3); ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.283); ctx.fill(); }
    ctx.globalAlpha = 1;
    drawSolids(vx0, vy0, vx1, vy1);
    // viñeta oscura (ambiente tenso)
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    drawJoystick(); drawHint();
  }

  // ---------- Bucle ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (running && !paused) { update(dt); updateHud(); }
    render();
    requestAnimationFrame(frame);
  }
  // Vista de fondo en el menú
  state = newState(); computeFlow(state.player.x, state.player.y);
  requestAnimationFrame(frame);

  // Acceso para pruebas automatizadas
  window.__game = {
    get state() { return state; }, get running() { return running; }, get paused() { return paused; }, get over() { return over; },
    get joy() { return joy; }, CFG, start
  };
})();
