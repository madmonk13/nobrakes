import * as THREE from 'three';
import { Terrain, CHUNK_LEN, RAIL_X, animatePads, BIOME_NAMES } from './terrain.js';
import { buildCar } from './car.js';
import { setNight } from './nightlights.js';
import { CarBody, CAR_HW, CAR_HL, MAX_HEALTH } from './physics.js';
import { Traffic } from './traffic.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { loadSave, writeSave, clearSave, defaultSave } from './save.js';
import { Mountains, Clouds, Smoke } from './scenery.js';
import { Environment } from './environment.js';
import { CoinFx, HazardFx } from './effects.js';
import { Sfx } from './audio.js';

const STEP = 1 / 120;
const UP = new THREE.Vector3(0, 1, 0);
const START_Z = -4; // the car waits on the start line here
const START_X = -1.8; // on a lane line, between the middle lanes
const COUNT_STEP = 0.6; // seconds per countdown beat
const CRASH_TIME = 2.4; // seconds to watch the wreck before the results
const CONK_TIME = 3.2; // ...or to watch it roll to a stop after it conks out
const NITRO_REFILL = 0.5; // share of a full tank in each refill bottle
const REPAIR = 25; // health a wrench puts back
const COIN_POINTS = 10;
const GAP_POINTS = 100;
const CLOSE_POINTS = 25;
const OVER_POINTS = 50;
const CONE_POINTS = 5;
const CLOSE_GAP = 0.9; // squeeze past a vehicle with less than this much room for a close call
// Cruising speed: the car always pulls toward this, and it rises with distance. No brakes.
const CRUISE_START = 24; // m/s (about 54 mph)...
const CRUISE_END = 56; // ...up to about 125 mph...
const CRUISE_RAMP = 7000; // ...over this many metres
const CRASH_TEXT = {
  traffic: 'Smash!', broken: 'Smash!', barrier: 'Crunch!', barrel: 'Crunch!', arrow: 'Crunch!', machine: 'Crunch!',
  crate: 'Smash!', hay: 'Hay!?', tyre: 'Wrecked!', rock: 'Rock slide!', boulder: 'Flattened!', log: 'Timber!', spool: 'Flattened!', bale: 'Baled!', tumbleweed: 'Tumbleweed!',
  rail: 'Wrecked!', gap: 'Bridge out!', landing: 'Wrecked!',
};

function cruiseAt(z) {
  return CRUISE_START + (CRUISE_END - CRUISE_START) * Math.pow(Math.min(1, Math.max(0, z) / CRUISE_RAMP), 0.85);
}

// ---------- renderer & scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2500);

const hemi = new THREE.HemisphereLight(0xe2f2ff, 0xb4c6da, 1.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dd, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const SUN_DIST = 100; // how far up the light's direction the shadow-casting light sits

const mountains = new Mountains(scene);
const clouds = new Clouds(scene);
const env = new Environment(scene, { hemi, sun, clouds });
const smoke = new Smoke(scene);
const coinFx = new CoinFx(scene);
const hazardFx = new HazardFx(scene, () => terrain);
const traffic = new Traffic(scene);
const sfx = new Sfx();

// ---------- banners across the road: the start line and your best distance ----------
function makeBanner(text, z, { bg = '#f5b81c', fg = '#5a3d00', lift = 6 } = {}) {
  const group = new THREE.Group();
  const h = terrain.height(0, z);
  const top = h + lift;
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  for (const x of [RAIL_X + 0.6, -RAIL_X - 0.6]) {
    const len = top - h + 0.6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, len, 6), poleMat);
    pole.position.set(x, h + len / 2, z);
    group.add(pole);
  }
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 64);
  ctx.fillStyle = fg;
  ctx.font = 'bold 44px Fredoka, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(RAIL_X * 2 + 1.2, 3.2),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  banner.position.set(0, top, z);
  banner.rotation.y = Math.PI; // readable when approached from behind
  group.add(banner);
  scene.add(group);
  return group;
}

function removeBanner(group) {
  if (!group) return;
  scene.remove(group);
  const seen = new Set();
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (seen.has(o.material)) return;
    seen.add(o.material);
    o.material.map?.dispose();
    o.material.dispose();
  });
}

let banners = [];
function placeBanners() {
  banners.forEach(removeBanner);
  banners = [makeBanner('NO BRAKES  ·  START', 1, { bg: '#1d1f24', fg: '#ffffff', lift: 8 })];
  if (save.bestDistance >= 50) banners.push(makeBanner(`★  BEST ${Math.floor(save.bestDistance)} m  ★`, save.bestDistance));
}

// ---------- game state ----------
let save = loadSave();
let terrain = null;
const body = new CarBody();
const car = buildCar(save.style);
car.setColors(save.colors);
scene.add(car.group);

const input = new Input(canvas);
input.setSensitivity(save.touchSensitivity);
let mode = 'menu'; // menu | ready | run | crash | results
let run = null;
let accumulator = 0;
// Physics runs in fixed steps, so a frame can get one, two or three of them. The car is drawn
// part way between the last two steps instead, or it would judder against the smooth camera.
const prevPos = new THREE.Vector3();
let prevFacing = 0;
const view = { pos: new THREE.Vector3(), facing: 0 };
let steerSmooth = 0;
let fovKick = 0; // brief FOV punch when a turbo pad fires
let shake = 0; // camera shake from hits, decays to 0
let time = 0;
let countdown = 0; // seconds into the start countdown
let crashTimer = 0;
let lastNoBrakes = -10;

const ui = new UI({
  play: () => startCourse(),
  endRun: () => (mode === 'run' || mode === 'crash') && endRun(),
  pause: (on) => setPaused(on),
  style: (id) => {
    car.setStyle(id);
    writeSave(save);
  },
  colors: (colors) => {
    car.setColors(colors);
    writeSave(save);
  },
  sensitivity: (k) => {
    input.setSensitivity(k);
    writeSave(save);
  },
  reset: () => {
    const { style, colors, touchSensitivity } = save; // resetting scores keeps the car, its paint job and your controls
    clearSave();
    save = defaultSave();
    save.style = style;
    save.colors = colors;
    save.touchSensitivity = touchSensitivity;
    writeSave(save);
    newCourse();
    ui.showMenu(save);
  },
});

function newCourse() {
  if (terrain) terrain.dispose();
  terrain = new Terrain(scene, (Math.random() * 4294967296) >>> 0);
  terrain.traffic = traffic;
  terrain.update(0);
  traffic.reset(terrain);
  body.reset();
  body.pos.set(START_X, terrain.height(START_X, START_Z), START_Z);
  car.reset();
  smoke.clear();
  placeBanners();
  updateView();
  updateCarVisual(0, true);
  updateCamera(0, true);
}

function startCourse() {
  newCourse();
  run = {
    coins: 0, air: 0, gaps: 0, close: 0, closePoints: 0, cones: 0, boostM: 0,
    maxZ: 0, time: 0, score: 0, biome: 'farm',
  };
  accumulator = 0;
  steerSmooth = 0;
  countdown = 0;
  mode = 'ready';
  ui.resetHud();
  ui.setMode('ready');
  ui.updateHud(run, body, save.best);
}

function go() {
  mode = 'run';
  ui.setMode('run');
  sfx.count(true);
  ui.toast('Go!');
}

function score(r) {
  return Math.floor(Math.max(0, r.maxZ) + r.boostM) + r.coins * COIN_POINTS + r.air + r.gaps * GAP_POINTS
    + r.closePoints + r.cones * CONE_POINTS;
}

function endRun() {
  mode = 'results';
  const distance = Math.max(0, Math.floor(run.maxZ));
  const total = score(run);
  const newBest = total > save.best;
  save.runs += 1;
  if (newBest) save.best = total;
  save.bestDistance = Math.max(save.bestDistance, distance);
  writeSave(save);
  sfx.runEnd(newBest);
  ui.showResults({
    distance, boost: Math.floor(run.boostM), coins: run.coins, coinValue: COIN_POINTS, coinPoints: run.coins * COIN_POINTS,
    air: run.air, gaps: run.gaps, gapPoints: run.gaps * GAP_POINTS, close: run.close,
    closePoints: run.closePoints, cones: run.cones, conePoints: run.cones * CONE_POINTS, total, newBest,
    crash: body.crashed?.kind ?? null, detail: body.crashed?.detail ?? null, conked: !!body.crashed?.conked,
  }, save);
}

// ---------- pause ----------
let paused = false;
function setPaused(on) {
  if (on && (paused || mode !== 'run')) return;
  if (!on && !paused) return;
  paused = on;
  ui.showPause(on);
  if (!on) ui.setMode(mode); // bring back the in-run buttons
}
// leaving the app (switching tabs, locking the phone) pauses a run
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});

// ---------- sound controls ----------
const muteBtn = document.getElementById('btn-mute');
function showMute() {
  muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
  muteBtn.setAttribute('aria-label', sfx.muted ? 'Unmute sound' : 'Mute sound');
}
function toggleMute() {
  sfx.toggleMute();
  showMute();
}
muteBtn.onclick = toggleMute;
showMute();
// soft tick on menu buttons
document.addEventListener('click', (e) => {
  if (e.target.closest('button') && e.target.closest('.overlay')) sfx.click();
});

input.onKeyDown = (code) => {
  if (code === 'KeyM') return toggleMute();
  if (code === 'KeyP' || code === 'Escape') return setPaused(!paused);
  if (paused) return;
  if ((code === 'ArrowDown' || code === 'KeyS') && mode === 'run' && !body.crashed) {
    if (time - lastNoBrakes > 2.5) {
      lastNoBrakes = time;
      sfx.noBrakes();
      ui.toast('No brakes!');
    }
    return;
  }
  if ((mode === 'menu' || mode === 'results') && !ui.prefsOpen && !ui.helpOpen && (code === 'Enter' || code === 'Space')) startCourse();
};

// ---------- per-mode updates ----------

// 3, 2, 1, Go! The car waits on the line meanwhile.
function updateReady(dt) {
  const beat = Math.floor(countdown / COUNT_STEP);
  countdown += dt;
  const next = Math.floor(countdown / COUNT_STEP);
  if (next !== beat || countdown === dt) {
    if (next >= 3) return go();
    sfx.count(false);
    ui.toast(String(3 - next));
  }
}

function updateRun(dt) {
  const target = mode === 'run' ? input.steer() : 0;
  steerSmooth += (target - steerSmooth) * Math.min(1, dt * 10);
  const ctl = {
    steer: steerSmooth,
    boost: mode === 'run' && input.boost(),
    cruise: mode === 'run' ? cruiseAt(body.pos.z) : 0,
  };
  accumulator += dt;
  const z0 = body.pos.z;
  while (accumulator >= STEP) {
    prevPos.copy(body.pos);
    prevFacing = body.facing;
    body.step(STEP, ctl, terrain);
    accumulator -= STEP;
    if (body.landing && !body.crashed) onLanding(body.landing);
  }
  if (mode === 'run' && body.boosting && body.contact) run.boostM += Math.max(0, body.pos.z - z0);
  handleHits();

  if (mode === 'run') {
    if (body.crashed) return startCrash();
    checkGaps();
    checkPasses();
    checkBiome();
    run.time += dt;
    run.maxZ = Math.max(run.maxZ, body.pos.z);
    collectCoins(dt);
    run.score = score(run);
    ui.updateHud(run, body, save.best);
  } else {
    crashTimer += dt;
    if (body.crashed.conked) {
      smoke.steam(body, dt);
      ui.updateHud(run, body, save.best);
    }
    else if (crashTimer < 2) smoke.wreck(body.pos, dt);
    if (crashTimer > (body.crashed.conked ? CONK_TIME : CRASH_TIME)) endRun();
  }
  if (mode === 'run' && body.health < MAX_HEALTH * 0.5) smoke.damaged(body, 1 - body.health / (MAX_HEALTH * 0.5), dt);
  terrain.update(body.pos.z);
  smoke.emit(body, dt);
}

// Everything the physics bumped into since last frame: effects, sounds, toasts.
function handleHits() {
  const paint = save.colors.body;
  if (body.padHits) {
    body.padHits = 0;
    fovKick = 10;
    ui.toast('Turbo!');
    sfx.pad();
  }
  for (const hit of body.obstacleHits) {
    const light = hit.obstacle.h < 0; // smashed through rather than bounced off
    hazardFx.obstacle(hit, paint);
    sfx.thud(hit.obstacle.kind);
    if (!light && hit.speed > 6) sfx.crash(hit.speed);
    shake = Math.max(shake, Math.min(0.8, (light ? 0.15 : 0.25) + hit.speed * 0.02));
  }
  body.obstacleHits.length = 0;
  for (const hit of body.vehicleHits) {
    hazardFx.vehicle(hit, paint);
    sfx.crash(hit.speed);
    sfx.horn(hit.vehicle.type === 'semi' || hit.vehicle.type === 'boxtruck');
    shake = Math.max(shake, Math.min(0.8, 0.25 + hit.speed * 0.03));
  }
  body.vehicleHits.length = 0;
  for (const hit of body.crosserHits) {
    hazardFx.crosser(hit, paint);
    const kind = hit.ball.kind;
    if (kind === 'tumbleweed') {
      // just a dry crackle as it bursts over the bonnet
      sfx.thud('hay');
      if (mode === 'run' && !body.crashed) ui.toast('Tumbleweed!');
      continue;
    }
    sfx.thud(kind === 'bale' ? 'hay' : kind === 'spool' ? 'crate' : 'rock');
    if (kind !== 'bale') sfx.crash(hit.vel.length());
    shake = Math.max(shake, kind === 'bale' ? 0.4 : 0.8);
  }
  body.crosserHits.length = 0;
  for (const hit of body.knockHits) {
    hazardFx.knock(hit);
    sfx.knock();
    if (mode === 'run' && !body.crashed) {
      run.cones++;
      ui.toast(hit.knockable.type === 'cone' ? `Cone! +${CONE_POINTS}` : `Oops! +${CONE_POINTS}`);
    }
  }
  body.knockHits.length = 0;
  for (const hit of body.railHits) {
    smoke.sparks(hit, body.vel);
    sfx.scrape(hit.speed);
    shake = Math.max(shake, Math.min(0.4, 0.1 + hit.speed * 0.04));
  }
  body.railHits.length = 0;
  let hurt = 0;
  for (const hit of body.damageHits) hurt += hit.amount;
  body.damageHits.length = 0;
  if (hurt >= 1) {
    ui.damage(hurt);
    car.dent();
    if (mode === 'run' && !body.crashed && body.health < MAX_HEALTH * 0.25 && !run.warned) {
      run.warned = true;
      ui.toast('Engine smoking!');
    }
  }
}

// Squeezing past traffic with almost no room is a close call; flying right over it is better.
function checkPasses() {
  if (body.crashed) return;
  const ground = terrain.profile(body.pos.z);
  for (const v of traffic.vehicles) {
    if (v.passed || v.wrecked) continue;
    const dz = Math.abs(body.pos.z - v.z);
    const room = Math.abs(body.pos.x - v.x) - CAR_HW - v.spec.W / 2;
    if (dz < CAR_HL + v.spec.L / 2) {
      v.minRoom = Math.min(v.minRoom ?? Infinity, room);
      if (body.pos.y - ground > v.spec.H && room < 0) v.over = true;
    }
    if (body.pos.z - CAR_HL <= v.z + v.spec.L / 2) continue;
    v.passed = true;
    if (v.over) {
      run.closePoints += OVER_POINTS;
      run.close++;
      sfx.chime();
      ui.toast(`Over the top! +${OVER_POINTS}`);
    } else if (v.minRoom !== undefined && v.minRoom < CLOSE_GAP) {
      run.closePoints += CLOSE_POINTS;
      run.close++;
      sfx.horn(v.type === 'semi' || v.type === 'boxtruck' || v.type === 'bus');
      ui.toast(`Close call! +${CLOSE_POINTS}`);
    }
  }
}

function checkBiome() {
  const { a, b, t } = terrain.biomeAt(body.pos.z);
  const now = t > 0.5 ? b : a;
  if (now !== run.biome) {
    run.biome = now;
    ui.toast(`Entering ${BIOME_NAMES[now]}`);
  }
}

function startCrash() {
  mode = 'crash';
  crashTimer = 0;
  crashCam.copy(camPos);
  const kind = body.crashed.kind;
  if (kind === 'gap') sfx.fall();
  if (body.crashed.conked) {
    sfx.conk();
    ui.toast('Totaled!');
  } else {
    ui.toast(CRASH_TEXT[kind] || 'Wrecked!');
  }
  ui.updateHud(run, body, save.best);
  ui.setMode('crash');
}

// A gap counts as cleared once you're back on the road beyond it, still on four wheels.
function checkGaps() {
  if (!body.contact) return;
  const ci = Math.floor(body.pos.z / CHUNK_LEN);
  for (const g of [terrain.gapFor(ci), terrain.gapFor(ci - 1)]) {
    if (!g || g.cleared || body.pos.z < g.z1) continue;
    g.cleared = true;
    run.gaps++;
    sfx.chime();
    ui.toast(`Bridge jumped! +${GAP_POINTS}`);
  }
}

function onLanding({ impact, airTime }) {
  sfx.landing(impact);
  if (airTime > 1.0) {
    const bonus = Math.floor((airTime - 0.6) * 10);
    run.air += bonus;
    sfx.chime();
    ui.toast(impact > 14 ? `Big air! +${bonus}` : `Airtime +${bonus}`);
  } else if (impact > 14) {
    ui.toast('Oof!');
  } else if (airTime > 0.7) {
    ui.toast('Nice landing!');
  }
}

function collectCoins(dt) {
  const ci = Math.floor(body.pos.z / CHUNK_LEN);
  const sx = body.pos.x, sy = body.pos.y + 0.8, sz = body.pos.z;
  const pickR2 = 2.0 * 2.0;
  for (const chunk of terrain.chunks.values()) {
    const near = Math.abs(chunk.ci - ci) <= 1;
    for (const c of chunk.coins) {
      if (c.collected) continue;
      const m = c.mesh.position;
      c.mesh.rotation.y += dt * 3;
      if (!near) continue;
      const dx = sx - m.x, dy = sy - m.y, dz = sz - m.z;
      if (dx * dx + dy * dy + dz * dz < pickR2) {
        c.collected = true;
        c.mesh.visible = false;
        coinFx.collect(m, body);
        sfx.coin();
        run.coins++;
      }
    }
    for (const t of chunk.pickups) {
      if (t.collected) continue;
      const m = t.mesh.position;
      // only show what you could use: no bottles on a full tank, no wrenches on a healthy car
      const full = t.kind === 'nitro' ? body.nitro >= 1 : body.health >= MAX_HEALTH;
      t.mesh.visible = !full;
      if (full) continue;
      t.mesh.rotation.y += dt * 2;
      m.y = t.baseY + Math.sin(time * 3 + m.z) * 0.12;
      if (!near || body.crashed) continue;
      const dx = sx - m.x, dy = sy - m.y - 0.5, dz = sz - m.z;
      if (dx * dx + dy * dy + dz * dz < 2.4 * 2.4) {
        t.collected = true;
        t.mesh.visible = false;
        if (t.kind === 'nitro') {
          body.nitro = Math.min(1, body.nitro + NITRO_REFILL);
          sfx.refill();
          ui.toast('Nitro +');
        } else {
          body.health = Math.min(MAX_HEALTH, body.health + REPAIR);
          if (body.health >= MAX_HEALTH * 0.25) run.warned = false;
          sfx.repair();
          ui.toast('Repaired!');
        }
      }
    }
  }
}

// ---------- visuals ----------
const qTarget = new THREE.Quaternion();
const basis = new THREE.Matrix4();
const F = new THREE.Vector3(), U = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3();
let airPitch = 0, wasInAir = false;

function updateCarVisual(dt, snap = false) {
  const p = view.pos;
  const g = terrain.height(p.x, p.z);
  car.group.position.set(p.x, Math.max(p.y, g), p.z);
  F.set(Math.sin(view.facing), 0, Math.cos(view.facing));
  // off the ground at all, not just past the airborne grace period, or the car would tilt
  // to match the canyon wall for the first few frames after a ramp lip
  const inAir = !body.contact;
  if (inAir) {
    // Leave the ramp at the pitch the car already has, then let the nose ease round to follow
    // the flight path; coming down, level off to meet the road. Snapping straight to a scaled
    // flight angle made the nose dip at the lip.
    if (!wasInAir) airPitch = Math.asin(THREE.MathUtils.clamp(F.set(0, 0, 1).applyQuaternion(car.group.quaternion).y, -1, 1));
    const vh = Math.hypot(body.vel.x, body.vel.z) || 1;
    let target = THREE.MathUtils.clamp(Math.atan2(body.vel.y, vh), -0.35, 0.5);
    const above = p.y - g;
    if (body.vel.y < 0 && above < 4) {
      terrain.normal(p.x, p.z, U);
      const groundPitch = Math.atan2(-U.z, U.y) * Math.cos(view.facing) + Math.atan2(-U.x, U.y) * Math.sin(view.facing);
      target += (groundPitch - target) * (1 - above / 4);
    }
    airPitch += (target - airPitch) * (1 - Math.exp(-dt * 2.5));
    F.set(Math.sin(view.facing) * Math.cos(airPitch), Math.sin(airPitch), Math.cos(view.facing) * Math.cos(airPitch));
    X.crossVectors(UP, F).normalize();
    Y.crossVectors(F, X);
    basis.makeBasis(X, Y, F);
  } else {
    terrain.normal(p.x, p.z, U);
    X.crossVectors(U, F).normalize();
    F.crossVectors(X, U);
    basis.makeBasis(X, U, F);
  }
  wasInAir = inAir;
  qTarget.setFromRotationMatrix(basis);
  if (snap) car.group.quaternion.copy(qTarget);
  else car.group.quaternion.slerp(qTarget, 1 - Math.exp(-dt * 12));

  const active = mode === 'run' || mode === 'crash';
  car.animate(dt, {
    steer: mode === 'run' ? steerSmooth : 0,
    airborne: active && body.airborne,
    boosting: mode === 'run' && body.boosting,
    crashed: !!body.crashed,
    speed: active ? body.speed : 0,
    conked: !!body.crashed?.conked,
    damage: 1 - body.health / MAX_HEALTH,
  });
}

const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const crashCam = new THREE.Vector3();

let prefsShift = 0; // 0..1: how far the picture is nudged aside to clear the preferences panel

function updateCamera(dt, snap = false) {
  const p = view.pos;
  const fx = Math.sin(view.facing), fz = Math.cos(view.facing);
  if (mode === 'menu' && ui.prefsOpen) {
    // close-up, circling the car so the paint job can be seen
    const a = time * 0.5;
    camTarget.set(p.x + Math.sin(a) * 6, p.y + 1.8, p.z + Math.cos(a) * 6);
    lookTarget.set(p.x, p.y + 0.6, p.z);
  } else if (mode === 'crash' && !body.crashed.conked) {
    // stop where we were and watch the wreck
    camTarget.copy(crashCam);
    lookTarget.set(p.x, p.y + 0.6, p.z);
  } else {
    let back, up, ahead, lookDrop;
    let yaw = 0;
    if (mode === 'run' || mode === 'crash') {
      // (a car that conked out is followed as it rolls to a stop)
      const sp = body.speed;
      back = 8.5 + Math.min(3, sp * 0.04);
      up = 5.2 + Math.min(1.8, sp * 0.025);
      ahead = 14;
      lookDrop = 0;
    } else if (mode === 'ready') {
      back = 8.5;
      up = 5.2;
      ahead = 18;
      lookDrop = 0;
    } else {
      back = 8.5;
      up = 3.2;
      ahead = 10;
      lookDrop = 0;
      yaw = Math.sin(time * 0.25) * 0.6;
    }
    // on the run the camera follows the direction of travel, so swerves don't swing it about
    const heading = mode === 'run' && Math.hypot(body.vel.x, body.vel.z) > 3 ? Math.atan2(body.vel.x, body.vel.z) * 0.5 : view.facing;
    const ox = Math.sin(heading + yaw), oz = Math.cos(heading + yaw);
    camTarget.set(p.x - ox * back, p.y + up, p.z - oz * back);
    const gh = terrain.height(camTarget.x, camTarget.z) + 1.5;
    if (camTarget.y < gh) camTarget.y = gh;
    lookTarget.set(p.x + ox * ahead, p.y + lookDrop, p.z + oz * ahead);
    if (mode !== 'run') lookTarget.set(p.x + fx * ahead, p.y + lookDrop, p.z + fz * ahead);
  }

  if (snap) {
    camPos.copy(camTarget);
    camLook.copy(lookTarget);
  } else {
    camPos.lerp(camTarget, 1 - Math.exp(-dt * 7));
    camLook.lerp(lookTarget, 1 - Math.exp(-dt * 9));
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 1.2);
    const a = shake * shake;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
    camera.rotation.z += (Math.random() - 0.5) * a * 0.15;
  }

  fovKick = Math.max(0, fovKick - dt * 8);
  const fov = mode === 'run' ? 62 + Math.min(22, body.speed * 0.25) + fovKick + (body.boosting ? 4 : 0) : 62;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * (fovKick > 0 ? 9 : 3));
    camera.updateProjectionMatrix();
  }

  // slide the picture clear of the preferences panel (right of it in landscape, below it in portrait)
  const want = mode === 'menu' && ui.prefsOpen ? 1 : 0;
  const shift = snap ? want : prefsShift + (want - prefsShift) * Math.min(1, dt * 6);
  if (Math.abs(shift - prefsShift) > 1e-3 || (snap && shift !== prefsShift)) {
    prefsShift = shift;
    const w = window.innerWidth, h = window.innerHeight;
    if (prefsShift < 1e-3) camera.clearViewOffset();
    else if (w >= h) camera.setViewOffset(w, h, -prefsShift * w * 0.2, 0, w, h);
    else camera.setViewOffset(w, h, 0, -prefsShift * h * 0.25, w, h);
  }

  sun.position.copy(p).addScaledVector(env.lightDir, SUN_DIST);
  sun.target.position.copy(p);
  mountains.follow(camera);
  clouds.update(dt, camera);
  env.update(dt, camera, renderer);
  setNight(env.dark ?? 0);
}

// ---------- loop ----------
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
const IDLE_FRAME_MS = 30; // the menu and results only need ~30fps behind the overlay
function frame(now) {
  requestAnimationFrame(frame);
  if ((paused || (mode === 'menu' || mode === 'results')) && now - last < IDLE_FRAME_MS) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (paused) {
    sfx.update({ running: false, idle: false, speed: 0, contact: false, slip: 0, airborne: false, boosting: false });
    renderer.render(scene, camera);
    return;
  }
  time += dt;

  if (mode === 'ready') updateReady(dt);
  if (mode === 'run' || mode === 'crash') updateRun(dt);
  // traffic keeps moving behind the menu too, so the highway feels alive
  traffic.setPlayer(body.pos, body.facing, body.speed);
  traffic.update(dt, body.pos.z);
  for (const hit of traffic.hits) {
    hazardFx.crosser(hit, hit.vehicle.mesh.children[0]?.material?.color?.getHex?.() ?? 0xcccccc);
    if (Math.abs(hit.z - body.pos.z) < 150) sfx.thud(hit.ball.kind === 'bale' ? 'hay' : 'rock');
  }
  traffic.hits.length = 0;

  smoke.update(dt);
  sfx.update({
    running: mode === 'run' && !body.crashed, idle: mode === 'ready', speed: body.speed, contact: body.contact,
    slip: body.slip, airborne: body.airborne, boosting: body.boosting, health: body.health / MAX_HEALTH,
  });
  animatePads(dt);
  terrain.animate(dt);
  coinFx.update(dt, body);
  hazardFx.update(dt);
  updateView();
  updateCarVisual(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// where to draw the car this frame: between the last two physics steps while it's moving
function updateView() {
  if (mode !== 'run' && mode !== 'crash') {
    prevPos.copy(body.pos);
    prevFacing = body.facing;
  }
  const a = accumulator / STEP;
  view.pos.lerpVectors(prevPos, body.pos, a);
  view.facing = prevFacing + (body.facing - prevFacing) * a;
}

newCourse();
ui.showMenu(save);
requestAnimationFrame(frame);

// handy for debugging from the console
window.__nobrakes = { input, body, traffic, get mode() { return mode; }, get terrain() { return terrain; }, get save() { return save; }, get run() { return run; }, sfx, env, car };
