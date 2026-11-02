// Endless procedural highway. The road runs along +Z: eight same-direction lanes with a
// shoulder and a guardrail either side. The height function is analytic (noise-based), so
// physics samples it directly while meshes are built in chunks ahead of the car and
// discarded behind it. Everything static on the road (roadworks, lane merges, broken-down
// cars, debris, rock slides, oil, ramps, collapsed bridges) is placed per chunk
// from the course seed, so a chunk always rebuilds the same.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash1, hash2 } from './rng.js';
import { buildVehicle, randomPaint, hazardMat } from './vehicles.js';

export const CHUNK_LEN = 100;
export const LANES = 8;
export const LANE_W = 3.6;
export const ROAD_HALF = (LANES * LANE_W) / 2; // 14.4: edge of the outer lanes
export const RAIL_X = 18; // guardrails; the shoulders run from ROAD_HALF out to here
const EDGE_X = RAIL_X + 0.6; // the paved edge just past the rails
const MESH_HALF = 78; // fine grid either side of the road (its 3 m columns land on ±RAIL_X)
const SEG_X = 52;
// Beyond the fine grid the ground carries on as ever-wider columns out to OUTER_HALF,
// past the fog, so there's no visible edge to the world.
const OUTER_HALF = 720;
const OUTER_SEG = 14;
const SEG_Z = 50;
const CELL_X = (MESH_HALF * 2) / SEG_X;
const CELL_Z = CHUNK_LEN / SEG_Z;
const COLUMN_X = (() => {
  let r = 1.2; // solve CELL_X * (r + r^2 + ... + r^n) = OUTER_HALF - MESH_HALF for r
  for (let k = 0; k < 60; k++) {
    let sum = 0;
    for (let j = 1; j <= OUTER_SEG; j++) sum += CELL_X * r ** j;
    r *= Math.pow((OUTER_HALF - MESH_HALF) / sum, 1 / OUTER_SEG / 2);
  }
  const outer = [];
  let x = MESH_HALF;
  for (let j = 1; j <= OUTER_SEG; j++) outer.push((x += CELL_X * r ** j));
  outer[OUTER_SEG - 1] = OUTER_HALF;
  const inner = Array.from({ length: SEG_X + 1 }, (_, i) => i * CELL_X - MESH_HALF);
  return [...outer.map((v) => -v).reverse(), ...inner, ...outer];
})();

const RAMP_START_CHUNK = 2;
const RAMP_LEN = 14;
const RAMP_DROP = 1.2;
const PAD_START_CHUNK = 1;
export const PAD_W = 3;
export const PAD_LEN = 6;
const OIL_START_CHUNK = 3;
const ZONE_START_CHUNK = 2;
const BROKEN_START_CHUNK = 1;
const DEBRIS_START_CHUNK = 2;
const CROSSER_START_CHUNK = 4;
const CROSSER_LIM = RAIL_X + 8; // rolling crossers come in from this far out, across every lane
export const COINS_ENABLED = false; // set false to switch coins off: nothing is placed and the UI hides them
const GAP_START_CHUNK = 4;
const GAP_DEPTH = 30;
const GAP_RUNUP = 16; // length of the stunt ramps in front of a collapsed bridge
const GAP_CLEAR = 24; // other hazards keep this far from a gap's ramps and landing
export const GAP_STOP = GAP_RUNUP + 60; // traffic that can't leave in time stops this far short of a gap

// ---------- biomes: the scenery changes as you drive ----------

export const BIOMES = ['farm', 'desert', 'canyon', 'forest', 'mountain', 'city'];
const BIOME_LEN = 1500; // metres of each
const BIOME_BLEND = 250; // ...the last of which blends into the next
const BIOME = {
  farm: { ground: new THREE.Color(0x8cbc5c), alt: new THREE.Color(0xd9c46a), hills: 4, scale: 150 },
  desert: { ground: new THREE.Color(0xe6c48c), alt: new THREE.Color(0xd8a56c), hills: 10, scale: 75 },
  forest: { ground: new THREE.Color(0x5f9548), alt: new THREE.Color(0x4f8040), hills: 16, scale: 110 },
  city: { ground: new THREE.Color(0xa3a7ab), alt: new THREE.Color(0x8e959b), hills: 0.4, scale: 200 },
  // the road runs through a cut here, with steep banks either side for rocks to come down
  canyon: { ground: new THREE.Color(0xd09060), alt: new THREE.Color(0xc07a50), hills: 14, scale: 70, cut: 11 },
  mountain: { ground: new THREE.Color(0x6e9a58), alt: new THREE.Color(0x5f8a4e), hills: 28, scale: 120, cut: 14, snow: 22 },
};
export const BIOME_NAMES = {
  farm: 'Farm Country', desert: 'The Desert', canyon: 'Red Rock Canyon', forest: 'The Forest', mountain: 'The Mountain Pass', city: 'The City',
};
// only where there are hillsides above the road do rocks slide onto it or boulders roll across
const ROCKY = new Set(['canyon', 'mountain']);

function smooth(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

export function laneX(i) {
  return (i - (LANES - 1) / 2) * LANE_W;
}

export function laneOf(x) {
  return Math.max(0, Math.min(LANES - 1, Math.round(x / LANE_W + (LANES - 1) / 2)));
}

// ---------- shared materials and geometry ----------

const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

// The road surface: asphalt with lane lines, one canvas mapped across the whole width
// and repeated every 12 m along the road (one dash and one gap).
const ROAD_TEX_Z = 12;
const roadTex = (() => {
  const W = 1024, H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const px = (x) => ((x + EDGE_X + 0.6) / (2 * (EDGE_X + 0.6))) * W;
  ctx.fillStyle = '#8a8478'; // gravel edges
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#44474d';
  ctx.fillRect(px(-EDGE_X), 0, px(EDGE_X) - px(-EDGE_X), H);
  const r = mulberry32(99);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(px(-EDGE_X) + r() * (px(EDGE_X) - px(-EDGE_X)), r() * H, 2, 2);
  }
  // shoulders a shade lighter
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(px(-EDGE_X), 0, px(-ROAD_HALF) - px(-EDGE_X), H);
  ctx.fillRect(px(ROAD_HALF), 0, px(EDGE_X) - px(ROAD_HALF), H);
  const line = (x, color, dash) => {
    ctx.fillStyle = color;
    const w = 0.16 / (2 * (EDGE_X + 0.6)) * W;
    ctx.fillRect(px(x) - w / 2, 0, w, dash ? H * 0.25 : H);
  };
  line(-ROAD_HALF, '#f4f4ee', false);
  line(ROAD_HALF, '#f2c230', false);
  for (let i = 1; i < LANES; i++) line(-ROAD_HALF + i * LANE_W, '#f4f4ee', true);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
})();
const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });

const railMat = new THREE.MeshLambertMaterial({ color: 0xc9ced4, side: THREE.DoubleSide });
const postMat = new THREE.MeshLambertMaterial({ color: 0x7d848c });
const postGeo = new THREE.BoxGeometry(0.15, 0.8, 0.15).translate(0, 0.4, 0);

function stripeTexture(colors, { w = 8, h = 64, horizontal = true, repeat = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const n = colors.length;
  colors.forEach((col, i) => {
    ctx.fillStyle = col;
    if (horizontal) ctx.fillRect(0, (i * h) / n, w, h / n + 1);
    else ctx.fillRect((i * w) / n, 0, w / n + 1, h);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

// Stunt ramps: yellow and black chevrons
const rampTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f5c518';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#1d1f24';
  for (let k = -2; k < 4; k++) {
    ctx.beginPath();
    ctx.moveTo(0, k * 64 + 32);
    ctx.lineTo(64, k * 64 + 64);
    ctx.lineTo(128, k * 64 + 32);
    ctx.lineTo(128, k * 64 + 56);
    ctx.lineTo(64, k * 64 + 88);
    ctx.lineTo(0, k * 64 + 56);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
})();
const rampMat = new THREE.MeshLambertMaterial({ map: rampTex, side: THREE.DoubleSide });
const rampSideMat = new THREE.MeshLambertMaterial({ color: 0x5a5d63, side: THREE.DoubleSide });

// Turbo pad: scrolling chevrons on a dark plate. One shared texture, so
// animatePads() moves every pad at once.
const padTex = (() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1c2a5c';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#18d4ff';
  ctx.fillRect(0, 0, 6, 64);
  ctx.fillRect(58, 0, 6, 64);
  const g = ctx.createLinearGradient(0, 10, 0, 54);
  g.addColorStop(0, '#b8f6ff');
  g.addColorStop(1, '#1aa3ff');
  ctx.fillStyle = g;
  // chevron pointing to the bottom of the canvas, which maps to +Z (forward)
  ctx.beginPath();
  ctx.moveTo(12, 12);
  ctx.lineTo(32, 34);
  ctx.lineTo(52, 12);
  ctx.lineTo(52, 30);
  ctx.lineTo(32, 52);
  ctx.lineTo(12, 30);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, PAD_LEN / 1.6);
  return tex;
})();
const padMat = new THREE.MeshBasicMaterial({
  map: padTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8,
});

const oilMat = new THREE.MeshPhongMaterial({
  color: 0x15151c, shininess: 120, specular: 0x8a7cff, transparent: true, opacity: 0.92,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
});
const waterMat = new THREE.MeshPhongMaterial({ color: 0x2a7fb0, shininess: 80, specular: 0x9fd8ff, transparent: true, opacity: 0.88 });

// A nitro refill: an upright blue bottle with a white band and a valve on top, floating
// over the lane. Parts are [geometry, material] pairs, built into a group per tank.
const nitroBlue = new THREE.MeshLambertMaterial({ color: 0x1aa3ff, emissive: 0x0a3d66 });
const nitroWhite = new THREE.MeshLambertMaterial({ color: 0xf4f8ff, emissive: 0x404850 });
const nitroValve = new THREE.MeshLambertMaterial({ color: 0xc0c6cc });
const nitroParts = [
  [new THREE.CylinderGeometry(0.34, 0.34, 1.0, 14), nitroBlue],
  [new THREE.SphereGeometry(0.34, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.5, 0), nitroBlue],
  [new THREE.CylinderGeometry(0.35, 0.35, 0.22, 14).translate(0, 0.08, 0), nitroWhite],
  [new THREE.CylinderGeometry(0.08, 0.1, 0.22, 8).translate(0, 0.92, 0), nitroValve],
  [new THREE.BoxGeometry(0.34, 0.06, 0.06).translate(0, 1.0, 0), nitroValve],
];
export const NITRO_TANK_CHANCE = 0.38; // chance of a refill tank in each stretch of road...
export const WRENCH_CHANCE = 0.16; // ...or, failing that, of a repair wrench

// A repair wrench: a chrome open-ended spanner, tilted
const wrenchChrome = new THREE.MeshLambertMaterial({ color: 0xdfe4ea, emissive: 0x3a4048 });
const wrenchParts = (() => {
  const jaw = new THREE.Shape();
  jaw.absarc(0, 0, 0.26, -Math.PI * 0.75, Math.PI * 0.75, false); // C-shaped open end
  jaw.lineTo(Math.cos(Math.PI * 0.75) * 0.12, Math.sin(Math.PI * 0.75) * 0.12);
  jaw.absarc(0, 0, 0.12, Math.PI * 0.75, -Math.PI * 0.75, true);
  const jawGeo = new THREE.ExtrudeGeometry(jaw, { depth: 0.08, bevelEnabled: false }).translate(0, 0, -0.04);
  const ring = new THREE.TorusGeometry(0.17, 0.07, 6, 14);
  const tilt = (g) => g.rotateZ(Math.PI / 4);
  return [
    [tilt(new THREE.BoxGeometry(0.16, 0.7, 0.08)), wrenchChrome],
    [tilt(jawGeo.rotateZ(-Math.PI / 2).translate(0, 0.5, 0)), wrenchChrome],
    [tilt(ring.translate(0, -0.47, 0)), wrenchChrome],
  ];
})();

// A coin is a gold disc (axis along z) with "10" on both faces. The geometry carries three
// material groups, so coinMat is an array: [rim, front face, back face].
const COIN_R = 0.7;
const COIN_T = 0.14;
export const coinGeo = mergeGeometries([
  new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_T, 24, 1, true).rotateX(Math.PI / 2),
  new THREE.CircleGeometry(COIN_R, 24).translate(0, 0, COIN_T / 2 + 0.002),
  new THREE.CircleGeometry(COIN_R, 24).rotateY(Math.PI).translate(0, 0, -COIN_T / 2 - 0.002),
], true);
const coinFaceTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const draw = () => {
    ctx.fillStyle = '#ffc83a';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#d99a10'; // raised rim
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#8a5600';
    ctx.font = 'bold 118px Fredoka, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('10', 128, 136);
  };
  draw();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // the web font may not be ready yet: redraw once it is
  document.fonts?.load('bold 118px Fredoka').then(() => { draw(); tex.needsUpdate = true; });
  return tex;
})();
const coinFaceMat = new THREE.MeshLambertMaterial({ map: coinFaceTex, emissive: 0x4a3200 });
export const coinMat = [new THREE.MeshLambertMaterial({ color: 0xe8a916, emissive: 0x7a5200 }), coinFaceMat, coinFaceMat];

// ---------- roadworks ----------

const barrelTex = stripeTexture(['#ff6a13', '#ffffff', '#ff6a13', '#ffffff', '#ff6a13']);
const barrelMat = new THREE.MeshLambertMaterial({ map: barrelTex });
const barrelBaseMat = new THREE.MeshLambertMaterial({ color: 0x1f2125 });
const barrelGeo = new THREE.CylinderGeometry(0.36, 0.42, 1.0, 10).translate(0, 0.55, 0);
const barrelBaseGeo = new THREE.CylinderGeometry(0.52, 0.55, 0.1, 10).translate(0, 0.05, 0);
const BARREL_R = 0.45;
const BARREL_H = 1.05;

const concreteMat = new THREE.MeshLambertMaterial({ color: 0xcfcac0, flatShading: true });
export const concreteChunkMat = concreteMat;
// Jersey barrier profile, extruded 1 m along z (scaled to length per piece)
const jerseyGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.32, 0);
  s.lineTo(0.32, 0);
  s.lineTo(0.32, 0.08);
  s.lineTo(0.14, 0.3);
  s.lineTo(0.09, 0.82);
  s.lineTo(-0.09, 0.82);
  s.lineTo(-0.14, 0.3);
  s.lineTo(-0.32, 0.08);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5);
})();
const JERSEY_H = 0.82;

const coneMat = new THREE.MeshLambertMaterial({ map: stripeTexture(['#ff6a13', '#ff6a13', '#ffffff', '#ff6a13']) });
const coneGeo = new THREE.ConeGeometry(0.22, 0.75, 10).translate(0, 0.42, 0);
const coneBaseGeo = new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.025, 0);
const triangleMat = new THREE.MeshLambertMaterial({ color: 0xe8332a, emissive: 0x4a0a06, side: THREE.DoubleSide });
const triangleGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0.05);
  s.lineTo(0.3, 0.05);
  s.lineTo(0, 0.58);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.17, 0.12);
  hole.lineTo(0, 0.42);
  hole.lineTo(0.17, 0.12);
  hole.closePath();
  s.holes.push(hole);
  return new THREE.ShapeGeometry(s).rotateX(-0.25);
})();

// Arrow board trailer: a flashing arrow pointing traffic out of the closed lanes. Two shared
// materials (one per arrow direction) blink together from animate().
function arrowTexture(dir) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#16171a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#ffd23a';
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(22 + i * 12, 32, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.arc(106 - k * 6, 32 - k * 7, 4, 0, Math.PI * 2);
    ctx.arc(106 - k * 6, 32 + k * 7, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (dir < 0) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.x = -1;
  }
  return tex;
}
const arrowMats = [-1, 1].map((d) => new THREE.MeshBasicMaterial({ map: arrowTexture(d) }));
const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2c31, flatShading: true });
const yellowMat = new THREE.MeshLambertMaterial({ color: 0xf2b417, flatShading: true });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x2b3a4a });
const woodMat = new THREE.MeshLambertMaterial({ color: 0xb98a4e, flatShading: true });
const strawMat = new THREE.MeshLambertMaterial({ color: 0xe3c66b, flatShading: true });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x222326, flatShading: true });
const hubMat = new THREE.MeshLambertMaterial({ color: 0x9aa0a8 });
export const ROCK_COLORS = { desert: 0xb9774a, canyon: 0xa85a38, forest: 0x8b8a86, mountain: 0x7f838a, farm: 0x9b8f7f, city: 0x8f8f8f };
const rockMats = Object.fromEntries(Object.entries(ROCK_COLORS).map(([k, c]) => [k, new THREE.MeshLambertMaterial({ color: c, flatShading: true })]));
export { rockMats, woodMat, strawMat, tyreMat };
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const crateGeo = new THREE.BoxGeometry(1, 1, 1);
const tyreGeo = new THREE.TorusGeometry(0.42, 0.2, 8, 16);
const hayGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.3, 12).rotateZ(Math.PI / 2);

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

// Little excavator, facing +z, origin on the ground.
const excavatorParts = (() => {
  const dark = mergeGeometries([box(0.7, 0.8, 3.6, -1.0, 0.4, 0), box(0.7, 0.8, 3.6, 1.0, 0.4, 0)]);
  const yellow = mergeGeometries([
    box(2.4, 1.0, 2.6, 0, 1.3, -0.3),
    box(1.0, 1.2, 1.2, 0.6, 2.4, 0.3),
    box(0.4, 0.4, 2.8, -0.4, 2.6, 1.6).rotateX(0), // boom
  ]);
  const boom2 = box(0.35, 2.2, 0.35, -0.4, 2.0, 3.0);
  const bucket = box(0.9, 0.6, 0.7, -0.4, 0.6, 3.1);
  const glass = box(1.02, 0.6, 1.0, 0.6, 2.6, 0.3);
  return [[dark, darkMat], [mergeGeometries([yellow, boom2]), yellowMat], [bucket, darkMat], [glass, glassMat]];
})();
// Dump truck, facing +z.
const dumpParts = (() => {
  const yellow = mergeGeometries([box(2.4, 1.4, 1.8, 0, 1.5, 2.2), box(2.5, 1.5, 4.2, 0, 2.0, -0.9)]);
  const dark = mergeGeometries([
    box(2.5, 0.4, 6.4, 0, 0.75, 0),
    ...[2.3, -0.9, -2.3].flatMap((z) => [box(0.4, 1.0, 1.0, -1.1, 0.5, z), box(0.4, 1.0, 1.0, 1.1, 0.5, z)]),
  ]);
  const glass = box(2.42, 0.55, 1.2, 0, 1.9, 2.4);
  return [[yellow, yellowMat], [dark, darkMat], [glass, glassMat]];
})();
const arrowBoardParts = (dir) => [
  [mergeGeometries([box(1.6, 0.3, 2.2, 0, 0.6, 0), box(0.12, 1.8, 0.12, 0, 1.5, -0.3), box(0.3, 0.6, 0.3, 0.6, 0.3, 0.6), box(0.3, 0.6, 0.3, -0.6, 0.3, 0.6)]), darkMat],
  [box(2.0, 1.0, 0.12, 0, 2.6, -0.3), darkMat],
  [new THREE.PlaneGeometry(1.9, 0.92).rotateY(Math.PI).translate(0, 2.6, -0.37), arrowMats[dir < 0 ? 0 : 1]],
];

function partsGroup(parts) {
  const g = new THREE.Group();
  for (const [geo, mat] of parts) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

// ---------- scenery ----------

const cactusMat = new THREE.MeshLambertMaterial({ color: 0x4f8f4a, flatShading: true });
const leafMat = new THREE.MeshLambertMaterial({ color: 0x5c9a3e, flatShading: true });
const leafMat2 = new THREE.MeshLambertMaterial({ color: 0x77ad45, flatShading: true });
const pineMat = new THREE.MeshLambertMaterial({ color: 0x2f6b4f, flatShading: true });
const pineTopMat = new THREE.MeshLambertMaterial({ color: 0x3d8562, flatShading: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a32, flatShading: true });
const barnMat = new THREE.MeshLambertMaterial({ color: 0xb63a2c, flatShading: true });
const roofMat = new THREE.MeshLambertMaterial({ color: 0x5b5f66, flatShading: true });
const siloMat = new THREE.MeshLambertMaterial({ color: 0xd9dde0, flatShading: true });
const mesaMat = new THREE.MeshLambertMaterial({ color: 0xc47a4b, flatShading: true });
const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff2c0, emissive: 0xffd77a });
const windowTex = (lit) => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = lit ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = lit ? '#ffd98a' : '#5d7286';
  ctx.fillRect(14, 14, 36, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
};
const buildingMat = new THREE.MeshLambertMaterial({ map: windowTex(false), emissiveMap: windowTex(true), emissive: 0x6a5a3a });

// A box whose window texture repeats at one window per 4 m x 3.5 m, so towers of any size keep square windows.
function buildingGeo(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
  const uv = g.attributes.uv;
  const faceW = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (faceW[f] === 0) uv.setXY(i, 0.02, 0.02); // roofs: plain wall colour
      else uv.setXY(i, uv.getX(i) * Math.round(faceW[f] / 4), uv.getY(i) * Math.round(h / 3.5));
    }
  }
  return g;
}

// Each scenery kind is a list of [geometry, material] parts drawn with shared instance matrices.
const SCENERY = {
  cactus: [[mergeGeometries([
    new THREE.CylinderGeometry(0.35, 0.4, 4, 7).translate(0, 2, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.2, 6).rotateZ(Math.PI / 2).translate(0.7, 1.8, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.4, 6).translate(1.2, 2.5, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 1.0, 6).rotateZ(Math.PI / 2).translate(-0.6, 2.4, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 1.1, 6).translate(-1.0, 2.95, 0),
  ]), cactusMat]],
  rock: [[new THREE.DodecahedronGeometry(1.2, 0).translate(0, 0.5, 0), mesaMat]],
  crag: [[new THREE.DodecahedronGeometry(1.2, 0).translate(0, 0.5, 0), rockMats.mountain]],
  mesa: [[new THREE.CylinderGeometry(40, 55, 45, 7).translate(0, 18, 0), mesaMat]],
  tree: [
    [new THREE.CylinderGeometry(0.3, 0.4, 2.4, 6).translate(0, 1.2, 0), trunkMat],
    [new THREE.IcosahedronGeometry(2.2, 0).translate(0, 3.8, 0), leafMat],
    [new THREE.IcosahedronGeometry(1.4, 0).translate(0.8, 5, 0.3), leafMat2],
  ],
  pine: [
    [new THREE.CylinderGeometry(0.35, 0.45, 1.6, 5).translate(0, 0.8, 0), trunkMat],
    [new THREE.ConeGeometry(2.4, 4.5, 6).translate(0, 3.6, 0), pineMat],
    [new THREE.ConeGeometry(1.7, 3.6, 6).translate(0, 6.2, 0), pineTopMat],
  ],
  barn: [
    [new THREE.BoxGeometry(10, 6, 14).translate(0, 3, 0), barnMat],
    [new THREE.CylinderGeometry(0.01, 6.6, 3.6, 4, 1).rotateY(Math.PI / 4).scale(1.08, 1, 1.5).translate(0, 7.8, 0), roofMat],
  ],
  silo: [
    [new THREE.CylinderGeometry(2.5, 2.5, 12, 12).translate(0, 6, 0), siloMat],
    [new THREE.SphereGeometry(2.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 12, 0), roofMat],
  ],
  lamp: [
    [mergeGeometries([new THREE.CylinderGeometry(0.1, 0.14, 8, 6).translate(0, 4, 0), new THREE.BoxGeometry(0.12, 0.12, 2.6).translate(0, 7.9, 1.2)]), postMat],
    [new THREE.BoxGeometry(0.5, 0.18, 0.9).translate(0, 7.8, 2.4), lampMat],
  ],
  b0: [[buildingGeo(16, 21, 16), buildingMat]],
  b1: [[buildingGeo(20, 42, 20), buildingMat]],
  b2: [[buildingGeo(12, 63, 12), buildingMat]],
  b3: [[buildingGeo(24, 14, 32), buildingMat]],
};
const BUILDING_COLORS = [0xe8e2d6, 0xc9d6e0, 0xd8c3a8, 0xa9b8c6, 0xe0d0c4, 0xbfc7b8, 0xd2b8b0];

// ---------- crossers: things that roll across the road, whatever the landscape has loose ----------

// A round hay bale in farm country, a tumbleweed blowing across the desert, a log off a timber
// truck in the forest, a runaway cable spool from the city's building sites, and boulders where
// there are hillsides for them to come down. Each is built to a rolling radius of 1 (scaled to
// the crosser's R), round an axis along z so it rolls across x.
export const CROSSER_KIND = { farm: 'bale', desert: 'tumbleweed', forest: 'log', city: 'spool', canyon: 'boulder', mountain: 'boulder' };
const along = (g) => g.rotateX(Math.PI / 2); // a cylinder's axis from y to z
const baleEndMat = new THREE.MeshLambertMaterial({ color: 0xc9a54a, flatShading: true });
const barkMat = new THREE.MeshLambertMaterial({ color: 0x5a3e2a, flatShading: true });
const logEndMat = new THREE.MeshLambertMaterial({ color: 0xd8b07a, flatShading: true });
const cableMat = new THREE.MeshLambertMaterial({ color: 0x2b2d33, flatShading: true });
const weedMat = new THREE.MeshLambertMaterial({ color: 0xa88a5a, flatShading: true });
export const ROLLER_DEBRIS = { bale: strawMat, tumbleweed: weedMat, log: barkMat, spool: woodMat };
const weedGeo = (() => {
  // a loose ball of twigs: thin sticks pointing every which way
  const r = mulberry32(7), parts = [];
  for (let i = 0; i < 26; i++) {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 1.7 + r() * 0.3, 3);
    g.rotateX(r() * Math.PI).rotateZ(r() * Math.PI).rotateY(r() * Math.PI);
    parts.push(g);
  }
  return mergeGeometries(parts);
})();
const ROLLER_PARTS = {
  bale: [
    [along(new THREE.CylinderGeometry(1, 1, 1.4, 14, 1, true)), strawMat],
    [along(new THREE.CylinderGeometry(0.98, 0.98, 1.42, 14)), baleEndMat], // the ends, a shade darker
    [mergeGeometries([0.35, -0.35].map((z) => new THREE.TorusGeometry(1.0, 0.03, 4, 18).translate(0, 0, z))), baleEndMat], // twine
  ],
  tumbleweed: [[weedGeo, weedMat], [new THREE.IcosahedronGeometry(0.55, 0), weedMat]],
  log: [
    [along(new THREE.CylinderGeometry(1, 1, 2.6, 9, 1, true)), barkMat],
    [along(new THREE.CylinderGeometry(0.97, 0.97, 2.62, 9)), logEndMat],
  ],
  spool: [
    [along(new THREE.CylinderGeometry(1, 1, 0.14, 14)).translate(0, 0, 0.62), woodMat],
    [along(new THREE.CylinderGeometry(1, 1, 0.14, 14)).translate(0, 0, -0.62), woodMat],
    [along(new THREE.CylinderGeometry(0.72, 0.72, 1.12, 12)), cableMat],
  ],
};
const boulderGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.14 * Math.sin(x * 5.1 + y * 3.3) * Math.sin(y * 4.7 + z * 2.1);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
})();

export function animatePads(dt) {
  padTex.offset.y = (padTex.offset.y + dt * 2.2) % 1;
}

export class Terrain {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed >>> 0;
    this.chunks = new Map();
    this.gaps = new Map();
    this.ramps = new Map();
    this.pads = new Map();
    this.oil = new Map();
    this.layouts = new Map(); // ci -> { zone, obstacles, knockables, blockers }
    this.crossers = new Map();
    this.traffic = null; // set by the game; physics asks it for vehicles
    this.clock = 0;
  }

  rand(ci, salt) {
    return mulberry32((this.seed ^ Math.imul(ci + salt, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0);
  }

  // ---------- noise ----------

  noise1(t, salt) {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    const a = hash1(i, this.seed + salt);
    const b = hash1(i + 1, this.seed + salt);
    return a + (b - a) * u;
  }

  noise2(x, z, salt) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const s = this.seed + salt;
    const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s);
    const c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }

  // ---------- biomes ----------

  // { a, b, t }: blending from biome a into biome b by t (0 most of the way through a stretch)
  biomeAt(z) {
    const s = Math.max(0, z) / BIOME_LEN;
    const i = Math.floor(s);
    const f = (s - i) * BIOME_LEN;
    return { a: BIOMES[i % BIOMES.length], b: BIOMES[(i + 1) % BIOMES.length], t: smooth((f - (BIOME_LEN - BIOME_BLEND)) / BIOME_BLEND) };
  }

  // The biome at z, picking a or b at random across a blend (r is 0..1)
  biomePick(z, r) {
    const { a, b, t } = this.biomeAt(z);
    return r < t ? b : a;
  }

  // ---------- height field ----------

  // Height along the road: long gentle rises and dips, never sharp enough to throw the car at speed.
  profile(z) {
    if (z <= 0) return 0;
    const amp = Math.min(4, 1 + z * 0.0005) * smooth((z - 80) / 150);
    return amp * ((this.noise1(z / 260, 11) * 2 - 1) + 0.3 * (this.noise1(z / 110, 23) * 2 - 1));
  }

  height(x, z) {
    return this.baseHeight(x, z) + this.rampHeight(x, z);
  }

  baseHeight(x, z) {
    return this.surface(x, z) - this.gapDepth(x, z);
  }

  // The ground as if no gap cut through it. The road is flat across its width; beyond the
  // paved edge a shallow ditch gives way to the biome's own hills.
  surface(x, z) {
    let h = this.profile(z);
    const b = Math.abs(x) - EDGE_X;
    if (b <= 0) return h;
    h -= 1.2 * smooth(b / 4);
    const { a, b: nb, t } = this.biomeAt(z);
    const A = BIOME[a], B = BIOME[nb];
    const amp = A.hills + (B.hills - A.hills) * t;
    const scale = A.scale + (B.scale - A.scale) * t;
    h += amp * (this.noise2(x / scale, z / scale, 41) - 0.35) * smooth((b - 8) / 40);
    const cut = (A.cut || 0) + ((B.cut || 0) - (A.cut || 0)) * t;
    if (cut) h += cut * (0.6 + 0.6 * this.noise2(x / 30, z / 40, 47)) * smooth((b - 3) / 12);
    h += smooth((b - 90) / 200) * 40 * (this.noise2(x / 220, z / 220, 43) - 0.3);
    h += 0.15 * (this.noise2(x / 6, z / 6, 5) * 2 - 1);
    return h;
  }

  // The terrain mesh tucks under the road so the road ribbon never fights it.
  meshBase(x, z) {
    const h = this.baseHeight(x, z);
    return Math.abs(x) <= RAIL_X + 0.01 ? h - 0.35 : h;
  }

  normal(x, z, out = new THREE.Vector3()) {
    const e = 0.3;
    const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    // At a ramp lip the slope ahead drops away; keep the slope you're driving up instead,
    // or the nose tips down just before takeoff
    const h0 = this.height(x, z);
    const back = (h0 - this.height(x, z - e)) / e, ahead = (this.height(x, z + e) - h0) / e;
    const dz = ahead < back - 0.5 ? back : (back + ahead) / 2;
    return out.set(-dx, 1, -dz).normalize();
  }

  // ---------- collapsed bridges ----------

  // At most one per chunk, more often and wider further on. Both edges sit on rows of
  // the ground mesh so the walls drop straight down. The canyon runs as far as you can see.
  gapFor(ci) {
    if (this.gaps.has(ci)) return this.gaps.get(ci);
    let g = null;
    // never two chunks running, so there's always open road between bridges
    if (ci >= GAP_START_CHUNK && !this.gapFor(ci - 1)) {
      const r = this.rand(ci, 19);
      if (r() < Math.min(0.22, 0.08 + ci * 0.003)) {
        const width = Math.min(34, 14 + ci * 0.3 + r() * 6);
        const z0 = Math.round((ci * CHUNK_LEN + 40 + r() * 10) / CELL_Z) * CELL_Z;
        g = { z0, z1: z0 + Math.round(width / CELL_Z) * CELL_Z, cleared: false };
      }
    }
    this.gaps.set(ci, g);
    return g;
  }

  gapDepth(x, z) {
    const g = this.gapFor(Math.floor(z / CHUNK_LEN));
    if (!g || z <= g.z0 || z >= g.z1) return 0;
    const floor = GAP_DEPTH * (0.85 + 0.15 * this.noise2(x / 12, g.z0 / 17, 61));
    const ledge = 0.15 + 0.4 * this.noise2(x / 7, g.z0 / 11, 63);
    const cells = Math.min(z - g.z0, g.z1 - z) / CELL_Z;
    const tier = cells < 1 ? ledge * cells : cells < 2 ? ledge + (1 - ledge) * (cells - 1) : 1;
    return floor * tier;
  }

  gapAt(x, z) {
    return this.gapDepth(x, z) > 0 ? this.gapFor(Math.floor(z / CHUNK_LEN)) : null;
  }

  // The gap whose stretch (ramps, the drop and the landing) contains z, widened by margin.
  nearGap(z, margin = 0) {
    const lo = Math.floor((z - margin - GAP_CLEAR - GAP_RUNUP) / CHUNK_LEN);
    const hi = Math.floor((z + margin + GAP_CLEAR + GAP_RUNUP) / CHUNK_LEN);
    for (let ci = lo; ci <= hi; ci++) {
      const g = this.gapFor(ci);
      if (g && z > g.z0 - GAP_RUNUP - GAP_CLEAR - margin && z < g.z1 + GAP_CLEAR + margin) return g;
    }
    return null;
  }

  // The next gap starting after z, within range metres
  nextGap(z, range) {
    for (let ci = Math.floor(z / CHUNK_LEN); ci <= Math.floor((z + range) / CHUNK_LEN); ci++) {
      const g = this.gapFor(ci);
      if (g && g.z1 > z) return g;
    }
    return null;
  }

  // ---------- ramps ----------

  rampsFor(ci) {
    let list = this.ramps.get(ci);
    if (list) return list;
    list = [];
    const gap = this.gapFor(ci);
    if (gap) {
      // ramps right on the edge: one wide one early on, later narrower ones you must line up with
      const r = this.rand(ci, 21);
      const n = ci < 10 || r() < 0.55 ? 1 : 2;
      const lanes = n === 1 ? (ci < 10 ? 3 : 2 + (r() < 0.4 ? 1 : 0)) : r() < 0.6 ? 1 : 2;
      const starts = [];
      for (let i = 0; i < n; i++) {
        for (let attempt = 0; attempt < 10; attempt++) {
          const s = Math.floor(r() * (LANES - lanes + 1));
          if (starts.some((o) => Math.abs(o - s) < lanes + 1)) continue;
          starts.push(s);
          break;
        }
      }
      for (const s of starts) {
        list.push({ x: laneX(s) + ((lanes - 1) * LANE_W) / 2, lip: gap.z0, w: lanes * LANE_W - 0.4, len: GAP_RUNUP, h: 2.2 + r() * 0.5, gap });
      }
    } else if (ci >= RAMP_START_CHUNK) {
      const r = this.rand(ci, 3);
      const n = (r() < 0.45 ? 1 : 0) + (ci > 8 && r() < 0.25 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const half = n === 1 ? (r() < 0.5 ? 0 : 1) : i;
        const lip = ci * CHUNK_LEN + half * 50 + 22 + r() * 20;
        if (this.nearGap(lip, RAMP_LEN)) continue;
        list.push({ x: laneX(Math.floor(r() * LANES)), lip, w: LANE_W - 0.4, len: RAMP_LEN, h: 1.6 + r() * 0.8 });
      }
    }
    this.ramps.set(ci, list);
    return list;
  }

  // Ramp profile: a concave run-up to a lip, then a short drop back to the road
  // (or, in front of a gap, straight down into it).
  rampHeight(x, z) {
    for (const r of this.rampsFor(Math.floor(z / CHUNK_LEN))) {
      const dx = Math.abs(x - r.x);
      if (dx > r.w / 2) continue;
      const s = z - (r.lip - r.len);
      if (s < 0 || z > r.lip + (r.gap ? 0 : RAMP_DROP)) continue;
      const k = z <= r.lip ? Math.pow(s / r.len, 1.6) : 1 - (z - r.lip) / RAMP_DROP;
      return r.h * k * smooth((r.w / 2 - dx) / 0.3);
    }
    return 0;
  }

  // ---------- turbo pads ----------

  padsFor(ci) {
    let list = this.pads.get(ci);
    if (list) return list;
    list = [];
    if (ci >= PAD_START_CHUNK) {
      const r = this.rand(ci, 5);
      const ramps = this.rampsFor(ci);
      const n = (r() < 0.5 ? 1 : 0) + (ci > 6 && r() < 0.2 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        let x, z;
        if (ramps[i] && !ramps[i].gap && r() < 0.6) {
          x = ramps[i].x; // lined up with a stunt ramp
          z = ramps[i].lip - ramps[i].len - 8 - PAD_LEN;
        } else {
          x = laneX(Math.floor(r() * LANES));
          z = ci * CHUNK_LEN + 6 + r() * (CHUNK_LEN - PAD_LEN - 12);
          if (ramps.some((p) => Math.abs(p.x - x) < 3 && z + PAD_LEN > p.lip - p.len - 4 && z < p.lip + 4)) continue;
        }
        if (this.nearGap(z, PAD_LEN)) continue; // solid road only: never on a ramp run-up or over the chasm
        list.push({ x, z }); // z is the near edge; the pad runs to z + PAD_LEN
      }
    }
    this.pads.set(ci, list);
    return list;
  }

  padAt(x, z) {
    for (const p of this.padsFor(Math.floor(z / CHUNK_LEN))) {
      if (z >= p.z && z <= p.z + PAD_LEN && Math.abs(x - p.x) <= PAD_W / 2 + 0.3) return p;
    }
    return null;
  }

  // ---------- oil slicks ----------

  oilFor(ci) {
    let list = this.oil.get(ci);
    if (list) return list;
    list = [];
    if (ci >= OIL_START_CHUNK) {
      const r = this.rand(ci, 1);
      const n = Math.floor(r() * (1 + Math.min(1.5, ci * 0.05)));
      for (let i = 0; i < n; i++) {
        const p = { x: laneX(Math.floor(r() * LANES)) + (r() - 0.5) * 2, z: ci * CHUNK_LEN + 12 + r() * (CHUNK_LEN - 24), rx: 1.8 + r() * 1.8, rz: 4 + r() * 8 };
        if (!this.nearGap(p.z, p.rz)) list.push(p);
      }
    }
    this.oil.set(ci, list);
    return list;
  }

  isOil(x, z) {
    const ci = Math.floor(z / CHUNK_LEN);
    for (let c = ci - 1; c <= ci + 1; c++) {
      for (const p of this.oilFor(c)) {
        const dx = (x - p.x) / p.rx, dz = (z - p.z) / p.rz;
        if (dx * dx + dz * dz < 1) return true;
      }
    }
    return false;
  }

  // ---------- roadworks, lane merges, broken-down cars, debris and rock slides ----------

  // Everything solid in a chunk, laid out together so nothing overlaps.
  // obstacles: { type, x, z, hw, hl, h, kind, mesh, make } boxes the car crashes into unless it flies over
  // knockables: cones and warning triangles that just get knocked flying
  // blockers: road areas traffic must steer clear of { x0, x1, z0, z1 }
  layoutFor(ci) {
    let L = this.layouts.get(ci);
    if (L) return L;
    L = { zone: null, obstacles: [], knockables: [], blockers: [] };
    this.layouts.set(ci, L);
    if (ci < 1) return L;
    const r = this.rand(ci, 11);
    const z0c = ci * CHUNK_LEN;
    const ramps = this.rampsFor(ci);
    const pads = this.padsFor(ci);
    for (const p of ramps) L.blockers.push({ x0: p.x - p.w / 2 - 1, x1: p.x + p.w / 2 + 1, z0: p.lip - p.len - 2, z1: p.lip + 3 });
    const claimed = L.blockers.map((b) => ({ ...b }));
    for (const p of pads) claimed.push({ x0: p.x - 2, x1: p.x + 2, z0: p.z - 3, z1: p.z + PAD_LEN + 3 });
    const free = (x0, x1, z0, z1) => !claimed.some((c) => x1 > c.x0 && x0 < c.x1 && z1 > c.z0 && z0 < c.z1)
      && !this.nearGap(z0, 2) && !this.nearGap(z1, 2) && !this.nearGap((z0 + z1) / 2, 2);
    const add = (o) => {
      L.obstacles.push(o);
      return o;
    };

    // a roadworks zone or a lane merge
    if (ci >= ZONE_START_CHUNK && !this.gapFor(ci) && r() < Math.min(0.55, 0.22 + ci * 0.012)) {
      this.planZone(ci, r, L, claimed, free, add);
    }

    // broken-down cars, hazards blinking, with a warning triangle behind
    if (ci >= BROKEN_START_CHUNK) {
      const n = (r() < 0.55 ? 1 : 0) + (ci > 6 && r() < 0.3 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const shoulder = r() < 0.25;
        const x = shoulder ? (r() < 0.5 ? -1 : 1) * (ROAD_HALF + 1.6) : laneX(Math.floor(r() * LANES)) + (r() - 0.5) * 0.6;
        const z = z0c + 25 + r() * (CHUNK_LEN - 30);
        const v = ['sedan', 'hatch', 'suv', 'pickup', 'van'][Math.floor(r() * 5)];
        const spec = buildVehicle.spec(v);
        if (!free(x - spec.W / 2 - 1, x + spec.W / 2 + 1, z - 18, z + spec.L / 2 + 2)) continue;
        claimed.push({ x0: x - spec.W / 2 - 1, x1: x + spec.W / 2 + 1, z0: z - 18, z1: z + spec.L / 2 + 2 });
        const rot = (r() - 0.5) * 0.25;
        add({ type: 'broken', vehicle: v, paint: randomPaint(r), x, z, hw: spec.W / 2, hl: spec.L / 2, h: spec.H, rot, kind: 'broken' });
        L.blockers.push({ x0: x - spec.W / 2 - 0.8, x1: x + spec.W / 2 + 0.8, z0: z - spec.L / 2 - 14, z1: z + spec.L / 2 + 1 });
        L.knockables.push({ type: 'triangle', x: x + (r() - 0.5) * 0.8, z: z - spec.L / 2 - 10 - r() * 5, hw: 0.3, hl: 0.15, h: 0.6, knocked: false });
      }
    }

    // debris: spilled crates, a lost tyre, fallen hay bales, or a rock slide
    if (ci >= DEBRIS_START_CHUNK) {
      const n = Math.floor(r() * (1.3 + Math.min(1.6, ci * 0.05)));
      for (let i = 0; i < n; i++) {
        const z = z0c + 8 + r() * (CHUNK_LEN - 16);
        const biome = this.biomePick(z, r());
        const roll = r();
        if (ROCKY.has(biome) && roll < 0.5 && ci >= 3) this.rockSlide(z, r, L, claimed, free, add, biome);
        else if (roll < 0.62) this.spill(z, r, L, claimed, free, add, biome === 'farm' && r() < 0.6 ? 'hay' : 'crate');
        else {
          const x = (r() * 2 - 1) * (ROAD_HALF - 1);
          if (!free(x - 1, x + 1, z - 1, z + 1)) continue;
          claimed.push({ x0: x - 1, x1: x + 1, z0: z - 1, z1: z + 1 });
          add({ type: 'tyre', x, z, hw: 0.6, hl: 0.6, h: 0.45, rot: r() * 6, kind: 'tyre' });
          L.blockers.push({ x0: x - 1.2, x1: x + 1.2, z0: z - 2, z1: z + 1 });
        }
      }
    }

    // loose cones scattered about: harmless, and they go flying
    const cones = Math.floor(r() * 3);
    for (let i = 0; i < cones; i++) {
      const x = (r() * 2 - 1) * (ROAD_HALF - 0.5);
      const z = z0c + 4 + r() * (CHUNK_LEN - 8);
      if (free(x - 0.5, x + 0.5, z - 0.5, z + 0.5)) L.knockables.push({ type: 'cone', x, z, hw: 0.25, hl: 0.25, h: 0.8, knocked: false });
    }
    return L;
  }

  // Roadworks close one to three lanes from the edge (or two in the middle, later on) behind a taper
  // of barrels, with concrete barriers along the open side and machinery parked inside. A lane merge
  // takes lanes away behind a long concrete taper and gives them back further on.
  planZone(ci, r, L, claimed, free, add) {
    const merge = r() < 0.4;
    const k = 1 + Math.floor(r() * Math.min(3, 1 + ci / 8));
    const centre = !merge && ci > 6 && r() < 0.2;
    const side = r() < 0.5 ? -1 : 1; // which edge the closure starts from
    const taper = (merge ? 9 : 7) * (centre ? 1 : k);
    const tail = merge ? taper : 3;
    const room = CHUNK_LEN - 8 - taper - tail;
    const body = Math.min(room, 22 + r() * 40);
    const z0 = ci * CHUNK_LEN + 4 + r() * Math.max(0, room - body);
    const zb = z0 + taper; // fully closed from here...
    const ze = zb + body; // ...to here
    const z1 = ze + tail;
    let x0, x1;
    if (centre) {
      x0 = laneX(3) - LANE_W / 2;
      x1 = laneX(4) + LANE_W / 2;
    } else if (side < 0) {
      x0 = -RAIL_X;
      x1 = -ROAD_HALF + k * LANE_W;
    } else {
      x0 = ROAD_HALF - k * LANE_W;
      x1 = RAIL_X;
    }
    if (!free(x0, x1, z0, z1)) return;
    const inner = centre ? null : side < 0 ? x1 : x0; // the open-lane edge of the closure
    const outer = centre ? 0 : side < 0 ? -RAIL_X + 0.6 : RAIL_X - 0.6; // where the taper starts
    claimed.push({ x0: x0 - 1, x1: x1 + 1, z0: z0 - 2, z1: z1 + 2 });
    L.blockers.push({ x0, x1, z0: z0 - 6, z1 });
    L.zone = { kind: merge ? 'merge' : 'work', x0, x1, z0, zb, ze, z1, side, k, centre };

    const edges = centre ? [[0, x0 + 0.4], [0, x1 - 0.4]] : [[outer, inner - side * 0.4]];
    if (merge) {
      // concrete taper in, a straight run, and a taper back out
      const step = 1.6;
      for (const [from, to] of edges) {
        const ang = Math.atan2(to - from, taper);
        for (let s = 0; s <= taper; s += step) {
          const x = from + (to - from) * (s / taper);
          add({ type: 'jersey', x, z: z0 + s, hw: 0.34, hl: 0.85, h: JERSEY_H, rot: ang, len: 1.7, kind: 'barrier' });
        }
        for (let z = zb + 1.5; z < ze - 1.5; z += 3) add({ type: 'jersey', x: to, z, hw: 0.34, hl: 1.5, h: JERSEY_H, rot: 0, len: 3, kind: 'barrier' });
        for (let s = 0; s <= tail; s += step) {
          const x = to + (from - to) * (s / tail);
          add({ type: 'jersey', x, z: ze + s, hw: 0.34, hl: 0.85, h: JERSEY_H, rot: -ang, len: 1.7, kind: 'barrier' });
        }
      }
    } else {
      // barrels in a taper, barriers along the open side, a row of barrels across the far end
      for (const [from, to] of edges) {
        const n = Math.max(3, Math.round(taper / 2.4));
        for (let i = 0; i <= n; i++) {
          add({ type: 'barrel', x: from + (to - from) * (i / n), z: z0 + (taper * i) / n, hw: BARREL_R, hl: BARREL_R, h: BARREL_H, kind: 'barrel' });
        }
        for (let z = zb + 2.5; z < ze - 1.5; z += 3) add({ type: 'jersey', x: to, z, hw: 0.34, hl: 1.5, h: JERSEY_H, rot: 0, len: 3, kind: 'barrier' });
      }
      const xs = centre ? [x0 + 0.5, x1 - 0.5] : [outer, inner - side * 0.4];
      const lo = Math.min(...xs), hi = Math.max(...xs);
      for (let x = lo; x <= hi + 0.01; x += 1.4) add({ type: 'barrel', x, z: ze + 1, hw: BARREL_R, hl: BARREL_R, h: BARREL_H, kind: 'barrel' });
      // flashing arrow board at the start of the closure, then machinery
      if (!centre) {
        const ax = (outer + inner) / 2 + side * (k > 1 ? LANE_W * 0.5 : 0);
        add({ type: 'arrow', x: ax, z: zb + 3, hw: 1.0, hl: 1.2, h: 3.1, dir: -side, kind: 'arrow' });
      }
      const width = Math.abs(x1 - x0);
      if (body > 18 && width >= LANE_W * 1.5) {
        const exc = r() < 0.5;
        const cx = centre ? 0 : (outer + inner) / 2;
        const cz = zb + 9 + r() * Math.max(0, body - 18);
        add(exc
          ? { type: 'excavator', x: cx, z: cz, hw: 1.4, hl: 1.9, h: 3.2, rot: (r() - 0.5) * 0.6, kind: 'machine' }
          : { type: 'dump', x: cx, z: cz, hw: 1.3, hl: 3.2, h: 2.8, rot: 0, kind: 'machine' });
      }
    }
  }

  // Cargo spilled across one or two lanes.
  spill(z, r, L, claimed, free, add, what) {
    const x = (r() * 2 - 1) * (ROAD_HALF - 3);
    const spread = 2 + r() * 3;
    if (!free(x - spread, x + spread, z - 3, z + 3)) return;
    claimed.push({ x0: x - spread - 1, x1: x + spread + 1, z0: z - 4, z1: z + 4 });
    L.blockers.push({ x0: x - spread - 0.5, x1: x + spread + 0.5, z0: z - 3, z1: z + 3 });
    const n = what === 'hay' ? 2 + Math.floor(r() * 3) : 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const px = x + (r() * 2 - 1) * spread, pz = z + (r() * 2 - 1) * 2.4;
      if (what === 'hay') add({ type: 'hay', x: px, z: pz, hw: 0.65, hl: 0.75, h: 1.5, rot: r() * 3, kind: 'hay' });
      else {
        const s = 0.7 + r() * 0.5;
        add({ type: 'crate', x: px, z: pz, hw: s / 2, hl: s / 2, h: s, s, rot: r() * 3, kind: 'crate' });
      }
    }
  }

  // Boulders tumbled down onto the road from one side, spreading across one to three lanes.
  rockSlide(z, r, L, claimed, free, add, biome) {
    const side = r() < 0.5 ? -1 : 1;
    const lanes = 1 + Math.floor(r() * 3);
    const xEdge = side * RAIL_X;
    const xIn = side * (ROAD_HALF - lanes * LANE_W);
    const lo = Math.min(xEdge, xIn), hi = Math.max(xEdge, xIn);
    if (!free(lo, hi, z - 6, z + 6)) return;
    claimed.push({ x0: lo - 1, x1: hi + 1, z0: z - 7, z1: z + 7 });
    L.blockers.push({ x0: lo, x1: hi, z0: z - 6, z1: z + 6 });
    const n = 4 + lanes * 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const t = Math.pow(r(), 0.7); // bunched up toward the side they fell from
      const px = xEdge + (xIn - xEdge) * t, pz = z + (r() * 2 - 1) * 5 * (1 - t * 0.4);
      const s = (0.5 + r() * 1.1) * (1 - t * 0.35);
      add({ type: 'rock', x: px, z: pz, hw: s * 0.85, hl: s * 0.85, h: s * 1.5, s, rot: r() * 6, biome, kind: 'rock' });
    }
  }

  // First obstacle a car footprint (AABB half-size ex, ez) at (x, z) overlaps, unless it is
  // flying higher than the obstacle.
  obstacleAt(x, z, ex, ez, heightAbove) {
    const lo = Math.floor((z - ez - 4) / CHUNK_LEN), hi = Math.floor((z + ez + 4) / CHUNK_LEN);
    for (let ci = lo; ci <= hi; ci++) {
      for (const o of this.layoutFor(ci).obstacles) {
        if (heightAbove > o.h) continue;
        if (Math.abs(x - o.x) < ex + o.hw && Math.abs(z - o.z) < ez + o.hl) return o;
      }
    }
    return null;
  }

  // Every obstacle (or knockable) in the chunks within reach of z, for the physics to test
  // properly against the car's rotated footprint
  obstaclesNear(z, reach, out = []) {
    out.length = 0;
    for (let ci = Math.floor((z - reach) / CHUNK_LEN); ci <= Math.floor((z + reach) / CHUNK_LEN); ci++) {
      for (const o of this.layoutFor(ci).obstacles) if (Math.abs(o.z - z) < reach) out.push(o);
    }
    return out;
  }

  knockablesNear(z, reach, out = []) {
    out.length = 0;
    for (let ci = Math.floor((z - reach) / CHUNK_LEN); ci <= Math.floor((z + reach) / CHUNK_LEN); ci++) {
      for (const o of this.layoutFor(ci).knockables) if (!o.knocked && Math.abs(o.z - z) < reach) out.push(o);
    }
    return out;
  }

  knockableAt(x, z, ex, ez, heightAbove) {
    const lo = Math.floor((z - ez - 2) / CHUNK_LEN), hi = Math.floor((z + ez + 2) / CHUNK_LEN);
    for (let ci = lo; ci <= hi; ci++) {
      for (const o of this.layoutFor(ci).knockables) {
        if (o.knocked || heightAbove > o.h) continue;
        if (Math.abs(x - o.x) < ex + o.hw && Math.abs(z - o.z) < ez + o.hl) return o;
      }
    }
    return null;
  }

  // Nearest z at or after z0 where something blocks the road between x0 and x1, up to z1
  // (Infinity if clear). Traffic uses it to change lanes or stop.
  blockedAhead(x0, x1, z0, z1) {
    let best = Infinity;
    for (let ci = Math.floor((z0 - 20) / CHUNK_LEN); ci <= Math.floor(z1 / CHUNK_LEN); ci++) {
      for (const b of this.layoutFor(ci).blockers) {
        if (b.z1 < z0 || b.z0 > z1 || x1 < b.x0 || x0 > b.x1) continue;
        best = Math.min(best, Math.max(z0, b.z0));
      }
      const g = this.gapFor(ci);
      if (g && g.z1 > z0 && g.z0 - GAP_STOP < z1) best = Math.min(best, Math.max(z0, g.z0 - GAP_STOP));
    }
    return best;
  }

  // ---------- crossers ----------

  // Now and then something rolls across every lane (see CROSSER_KIND for what, where).
  // Each runs a cycle on the terrain clock: roll across, vanish past the far side, rest, roll again.
  crossersFor(ci) {
    let list = this.crossers.get(ci);
    if (list) return list;
    list = [];
    if (ci >= CROSSER_START_CHUNK) {
      const r = this.rand(ci, 31);
      if (r() < Math.min(0.4, 0.15 + ci * 0.01)) {
        const L = this.layoutFor(ci);
        const ramps = this.rampsFor(ci);
        for (let attempt = 0; attempt < 8; attempt++) {
          const z = ci * CHUNK_LEN + 12 + r() * (CHUNK_LEN - 24);
          const biome = this.biomePick(z, r());
          const kind = CROSSER_KIND[biome];
          const R = { boulder: 1.4 + r() * 0.6, bale: 1.0 + r() * 0.2, tumbleweed: 0.8 + r() * 0.35, log: 0.6 + r() * 0.15, spool: 1.0 + r() * 0.2 }[kind];
          const blocked = ramps.some((p) => z > p.lip - p.len - 3 - R && z < p.lip + 10 + R)
            || L.obstacles.some((o) => Math.abs(o.z - z) < R + o.hl + 2)
            || this.nearGap(z, R + 4);
          if (blocked) continue;
          const speed = kind === 'tumbleweed' ? 11 + r() * 6 : 8 + r() * 5; // tumbleweeds go with the wind
          const cross = (2 * CROSSER_LIM) / speed;
          const period = cross + 2 + r() * 5;
          list.push({ z, R, speed, cross, period, dir: r() < 0.5 ? -1 : 1, phase: r() * period, kind, biome, mesh: null });
          break;
        }
      }
    }
    this.crossers.set(ci, list);
    return list;
  }

  crosserState(b) {
    if (b.gone) return null; // broke up against a vehicle
    const u = (this.clock + b.phase) % b.period;
    if (u >= b.cross) return null;
    const edge = Math.min(u, b.cross - u) * b.speed;
    return { x: -b.dir * CROSSER_LIM + b.dir * b.speed * u, u, scale: smooth(edge / 3) };
  }

  crosserAt(x, y, z, radius) {
    const ci = Math.floor(z / CHUNK_LEN);
    for (let c = ci - 1; c <= ci + 1; c++) {
      for (const b of this.crossersFor(c)) {
        const s = this.crosserState(b);
        if (!s) continue;
        const r = b.R * s.scale;
        const cy = this.height(s.x, b.z) + r;
        const dx = x - s.x, dy = y - cy, dz = z - b.z;
        const reach = r * 0.9 + radius;
        if (dx * dx + dy * dy + dz * dz < reach * reach) return { ball: b, x: s.x, y: cy, z: b.z, r };
      }
    }
    return null;
  }

  // Hazard lights and arrow boards blink; crossers roll.
  animate(dt) {
    const t = (this.clock += dt);
    const on = Math.sin(t * 7) > 0;
    hazardMat.emissive.setHex(on ? 0xff9a1a : 0x2a1400);
    for (const m of arrowMats) m.color.setHex(Math.sin(t * 5) > -0.3 ? 0xffffff : 0x333333);
    for (const list of this.crossers.values()) {
      for (const b of list) {
        if (!b.mesh) continue;
        const s = this.crosserState(b);
        b.mesh.visible = !!s;
        if (!s) continue;
        const r = b.R * s.scale;
        b.mesh.scale.setScalar(r);
        // a tumbleweed bounces along; everything else just rolls
        const hop = b.kind === 'tumbleweed' ? Math.abs(Math.sin(s.u * 3.2)) * 0.9 : 0;
        b.mesh.position.set(s.x, this.height(s.x, b.z) + r * (b.kind === 'boulder' ? 0.92 : 1) + hop, b.z);
        b.mesh.rotation.z = -(b.dir * b.speed * s.u) / b.R;
        if (b.kind === 'tumbleweed') b.mesh.rotation.x = s.u * 1.3;
      }
    }
  }

  // ---------- chunks ----------

  update(z) {
    const minCi = Math.floor((z - 120) / CHUNK_LEN);
    const maxCi = Math.floor((z + 520) / CHUNK_LEN);
    for (let ci = Math.max(-1, minCi); ci <= maxCi; ci++) {
      if (!this.chunks.has(ci)) this.chunks.set(ci, this.buildChunk(ci));
    }
    for (const [ci, chunk] of this.chunks) {
      if (ci < minCi) {
        this.disposeChunk(chunk);
        this.chunks.delete(ci);
      }
    }
    for (const cache of [this.gaps, this.ramps, this.pads, this.oil, this.layouts, this.crossers]) {
      for (const ci of cache.keys()) {
        if (ci < minCi - 2) cache.delete(ci);
      }
    }
  }

  buildChunk(ci) {
    const z0 = ci * CHUNK_LEN;
    const group = new THREE.Group();
    const disposables = [];
    const rand = mulberry32((this.seed ^ Math.imul(ci + 7, 0x85ebca6b)) >>> 0);
    const gap = this.gapFor(ci);

    this.buildGround(ci, group, disposables, rand, gap);
    this.buildRoad(ci, group, disposables, gap);
    if (gap) this.buildGapDressing(gap, group, disposables);

    // ramps: chevron tops with grey sides so they read as solid wedges
    for (const r of this.rampsFor(ci)) {
      const runout = r.gap ? 0 : RAMP_DROP;
      const segs = 16;
      const top = new THREE.PlaneGeometry(r.w, r.len + runout, 2, segs);
      top.rotateX(-Math.PI / 2);
      const tp = top.attributes.position;
      const uv = top.attributes.uv;
      const zc = r.lip - r.len + (r.len + runout) / 2;
      for (let i = 0; i < tp.count; i++) {
        const x = tp.getX(i) * 0.999 + r.x;
        const z = tp.getZ(i) + zc;
        tp.setXYZ(i, x, this.profile(z) + this.rampHeight(r.x, Math.min(z, r.lip - 1e-3)) + 0.03, z);
        uv.setXY(i, uv.getX(i) * (r.w / LANE_W), uv.getY(i) * (r.len / 4));
      }
      top.computeVertexNormals();
      group.add(new THREE.Mesh(top, rampMat));
      disposables.push(top);
      // side walls
      const side = [];
      for (const sx of [-1, 1]) {
        const x = r.x + sx * r.w / 2;
        for (let i = 0; i < segs; i++) {
          const za = r.lip - r.len + (r.len * i) / segs, zb = r.lip - r.len + (r.len * (i + 1)) / segs;
          const ha = this.profile(za) + this.rampHeight(r.x, za), hb = this.profile(zb) + this.rampHeight(r.x, Math.min(zb, r.lip - 1e-3));
          const ga = this.profile(za), gb = this.profile(zb);
          side.push(x, ga, za, x, ha, za, x, hb, zb, x, ga, za, x, hb, zb, x, gb, zb);
        }
        const zl = r.lip - 1e-3, hl = this.profile(zl) + this.rampHeight(r.x, zl);
        if (!r.gap) side.push(x, hl, zl, x, this.profile(r.lip + RAMP_DROP), r.lip + RAMP_DROP, x, this.profile(zl), zl);
      }
      // the back face of a gap ramp, dropping into the canyon
      if (r.gap) {
        const zl = r.lip - 1e-3, hl = this.profile(zl) + this.rampHeight(r.x, zl), g = this.profile(zl);
        side.push(r.x - r.w / 2, g, zl, r.x + r.w / 2, g, zl, r.x + r.w / 2, hl, zl, r.x - r.w / 2, g, zl, r.x + r.w / 2, hl, zl, r.x - r.w / 2, hl, zl);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(side, 3));
      sg.computeVertexNormals();
      group.add(new THREE.Mesh(sg, rampSideMat));
      disposables.push(sg);
    }

    // turbo pads
    for (const p of this.padsFor(ci)) {
      const pg = new THREE.PlaneGeometry(PAD_W, PAD_LEN, 1, 6);
      pg.rotateX(-Math.PI / 2);
      const pp = pg.attributes.position;
      for (let i = 0; i < pp.count; i++) {
        const z = pp.getZ(i) + p.z + PAD_LEN / 2;
        pp.setXYZ(i, pp.getX(i) + p.x, this.profile(z) + 0.05, z);
      }
      group.add(new THREE.Mesh(pg, padMat));
      disposables.push(pg);
    }

    // oil slicks: dark glossy ovals
    for (const p of this.oilFor(ci)) {
      const og = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
      const op = og.attributes.position;
      for (let i = 0; i < op.count; i++) {
        const a = Math.atan2(op.getZ(i), op.getX(i));
        const wob = 1 + 0.12 * Math.sin(a * 3 + p.x) + 0.08 * Math.sin(a * 5 + p.z);
        const x = p.x + op.getX(i) * p.rx * wob, z = p.z + op.getZ(i) * p.rz * wob;
        op.setXYZ(i, x, this.profile(z) + 0.04, z);
      }
      og.computeVertexNormals();
      group.add(new THREE.Mesh(og, oilMat));
      disposables.push(og);
    }

    const L = this.layoutFor(ci);
    for (const o of L.obstacles) this.buildObstacle(o, group);
    for (const k of L.knockables) {
      if (k.knocked) continue;
      k.mesh = k.type === 'cone' ? partsGroup([[coneGeo, coneMat], [coneBaseGeo, coneMat]]) : new THREE.Mesh(triangleGeo, triangleMat);
      k.mesh.position.set(k.x, this.profile(k.z) + 0.02, k.z);
      if (k.type === 'triangle') k.mesh.rotation.y = Math.PI;
      group.add(k.mesh);
    }
    if (L.zone) this.zoneSigns(L.zone, group, disposables);

    // crossers (placed and rolled each frame by animate())
    for (const b of this.crossersFor(ci)) {
      if (b.kind === 'boulder') {
        b.mesh = new THREE.Mesh(boulderGeo, rockMats[b.biome]);
      } else {
        b.mesh = new THREE.Group();
        for (const [geo, mat] of ROLLER_PARTS[b.kind]) b.mesh.add(new THREE.Mesh(geo, mat));
      }
      b.mesh.traverse((m) => { m.castShadow = true; });
      b.mesh.visible = false;
      group.add(b.mesh);
    }

    this.buildScenery(ci, group, disposables, rand, gap);

    // distance signs at the start of each chunk, beyond the rails
    if (ci >= 1) {
      const sign = makeSign(`${ci * CHUNK_LEN} m`, '#1f6b3a');
      const x = RAIL_X + 3;
      sign.position.set(x, this.height(x, z0) + 3.5, z0);
      group.add(sign);
      disposables.push(sign.material.map, sign.material);
      const sign2 = sign.clone();
      sign2.position.set(-x, this.height(-x, z0) + 3.5, z0);
      group.add(sign2);
    }

    // coins
    const coins = [];
    const addCoin = (x, y, z, overGap = false) => {
      if (!COINS_ENABLED) return;
      if (!overGap && this.nearGap(z) && this.gapAt(x, z)) return;
      const above = y - this.height(x, z);
      if (this.obstacleAt(x, z, 0.6, 0.6, above)) return; // no coins buried in hazards
      const mesh = new THREE.Mesh(coinGeo, coinMat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      group.add(mesh);
      coins.push({ mesh, collected: false });
    };
    for (const r of this.rampsFor(ci)) {
      if (r.gap) this.gapCoins(r, addCoin);
      else {
        const apexZ = r.lip + 16;
        addCoin(r.x, this.profile(apexZ) + 3 + r.h, apexZ);
      }
    }
    if (ci >= 0) {
      // short lines of coins down a lane, so going for them means committing to it
      const n = ci === 0 ? 1 : 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const x = laneX(Math.floor(rand() * LANES));
        const z = z0 + 10 + rand() * (CHUNK_LEN - 30);
        const len = 1 + Math.floor(rand() * 4);
        for (let j = 0; j < len; j++) {
          const zz = z + j * 5;
          if (!this.gapAt(x, zz)) addCoin(x, this.height(x, zz) + 1.0, zz);
        }
      }
    }

    // the odd nitro refill or repair wrench, floating over a lane clear of hazards
    const pickups = [];
    const roll = rand();
    const kind = ci < 1 ? null : roll < NITRO_TANK_CHANCE ? 'nitro' : roll < NITRO_TANK_CHANCE + WRENCH_CHANCE ? 'wrench' : null;
    if (kind) {
      const x = laneX(Math.floor(rand() * LANES));
      const z = z0 + 15 + rand() * (CHUNK_LEN - 30);
      if (!this.nearGap(z) && !this.obstacleAt(x, z, 1, 1, 0)) {
        const mesh = new THREE.Group();
        for (const [geo, mat] of kind === 'nitro' ? nitroParts : wrenchParts) {
          const m = new THREE.Mesh(geo, mat);
          m.castShadow = true;
          mesh.add(m);
        }
        mesh.scale.setScalar(kind === 'nitro' ? 1.5 : 2.1); // big enough to spot from a way off
        mesh.position.set(x, this.height(x, z) + (kind === 'nitro' ? 1.0 : 1.3), z);
        group.add(mesh);
        pickups.push({ kind, mesh, collected: false, baseY: mesh.position.y });
      }
    }

    this.scene.add(group);
    return { ci, group, coins, pickups, disposables };
  }

  buildGround(ci, group, disposables, rand, gap) {
    const z0 = ci * CHUNK_LEN;
    const segs = SEG_X + OUTER_SEG * 2;
    const plane = new THREE.PlaneGeometry(segs, CHUNK_LEN, segs, SEG_Z);
    plane.rotateX(-Math.PI / 2);
    const pp = plane.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = COLUMN_X[Math.round(pp.getX(i) + segs / 2)];
      const z = pp.getZ(i) + z0 + CHUNK_LEN / 2;
      pp.setXYZ(i, x, this.meshBase(x, z), z);
    }
    const geo = plane.toNonIndexed();
    plane.dispose();
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const c2 = new THREE.Color();
    for (let t = 0; t < pos.count; t += 3) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      if (gap && cz > gap.z0 && cz < gap.z1) {
        const d = [0, 1, 2].map((k) => this.gapDepth(pos.getX(t + k), pos.getZ(t + k)));
        if (Math.max(...d) > 0.4) {
          const jitter = -rand() * 0.04;
          d.forEach((dd, k) => {
            const top = Math.abs(pos.getX(t + k)) < EDGE_X ? 0xb8b4ac : 0xb07a50; // broken concrete under the road, rock elsewhere
            c.setHex(top).lerp(c2.setHex(0x3a2a22), Math.min(1, dd / (GAP_DEPTH * 0.8))).offsetHSL(0, 0, jitter);
            c.toArray(colors, (t + k) * 3);
          });
          continue;
        }
      }
      const { a, b, t: bt } = this.biomeAt(cz);
      // fields: each patch of ground picks the biome's main or alternate colour
      const field = hash2(Math.floor(cx / 46), Math.floor(cz / 64), this.seed + 3) < 0.4;
      c.copy(field ? BIOME[a].alt : BIOME[a].ground).lerp(field ? BIOME[b].alt : BIOME[b].ground, bt);
      if (Math.abs(cx) < EDGE_X + 3) c.lerp(c2.setHex(0x8f8a7c), 0.35); // verge
      if (ROCKY.has(a) || ROCKY.has(b)) {
        // bare rock where the slope is steep, snow on the high ground
        const ux = pos.getX(t + 1) - pos.getX(t), uy = pos.getY(t + 1) - pos.getY(t), uz = pos.getZ(t + 1) - pos.getZ(t);
        const vx = pos.getX(t + 2) - pos.getX(t), vy = pos.getY(t + 2) - pos.getY(t), vz = pos.getZ(t + 2) - pos.getZ(t);
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const steep = 1 - Math.abs(ny) / Math.hypot(nx, ny, nz);
        const w = (k) => (k === a ? 1 - bt : 0) + (k === b ? bt : 0);
        const rocky = (ROCKY.has(a) ? 1 - bt : 0) + (ROCKY.has(b) ? bt : 0);
        const rockHex = w('canyon') >= w('mountain') ? ROCK_COLORS.canyon : ROCK_COLORS.mountain;
        c.lerp(c2.setHex(rockHex), smooth((steep - 0.25) / 0.25) * rocky);
        const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3 - this.profile(cz);
        if (w('mountain') > 0) c.lerp(c2.setHex(0xf2f4f7), smooth((cy - BIOME.mountain.snow) / 6) * w('mountain') * (1 - steep * 0.6));
      }
      c.offsetHSL(0, 0, -rand() * 0.04);
      for (let k = 0; k < 3; k++) c.toArray(colors, (t + k) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, groundMat);
    ground.receiveShadow = true;
    group.add(ground);
    disposables.push(geo);
  }

  // The road ribbon, its guardrails and their posts, broken where a gap cuts through.
  buildRoad(ci, group, disposables, gap) {
    const z0 = ci * CHUNK_LEN;
    const spans = gap ? [[z0, gap.z0], [gap.z1, z0 + CHUNK_LEN]] : [[z0, z0 + CHUNK_LEN]];
    const XS = [-EDGE_X - 0.6, -EDGE_X, EDGE_X, EDGE_X + 0.6];
    const DY = [-0.9, 0.02, 0.02, -0.9];
    const W = 2 * (EDGE_X + 0.6);
    const posts = [];
    for (const [za, zb] of spans) {
      if (zb - za < 0.5) continue;
      const n = Math.max(1, Math.round((zb - za) / CELL_Z));
      const verts = [], uvs = [], index = [];
      for (let j = 0; j <= n; j++) {
        const z = za + ((zb - za) * j) / n;
        const h = this.profile(z);
        for (let i = 0; i < 4; i++) {
          verts.push(XS[i], h + DY[i], z);
          uvs.push((XS[i] + W / 2) / W, z / ROAD_TEX_Z);
        }
      }
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < 3; i++) {
          const a = j * 4 + i, b = a + 1, c = a + 4, d = a + 5;
          index.push(a, c, b, b, c, d);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(index);
      g.computeVertexNormals();
      const road = new THREE.Mesh(g, roadMat);
      road.receiveShadow = true;
      group.add(road);
      disposables.push(g);

      // guardrails: a strip of steel on posts either side
      for (const s of [-1, 1]) {
        const rv = [], ri = [];
        for (let j = 0; j <= n; j++) {
          const z = za + ((zb - za) * j) / n;
          const h = this.profile(z);
          rv.push(s * (RAIL_X + 0.1), h + 0.45, z, s * (RAIL_X + 0.1), h + 0.82, z);
        }
        for (let j = 0; j < n; j++) ri.push(j * 2, j * 2 + 2, j * 2 + 1, j * 2 + 1, j * 2 + 2, j * 2 + 3);
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.Float32BufferAttribute(rv, 3));
        rg.setIndex(ri);
        rg.computeVertexNormals();
        const rail = new THREE.Mesh(rg, railMat);
        rail.castShadow = true;
        group.add(rail);
        disposables.push(rg);
        for (let z = Math.ceil(za / 4) * 4; z <= zb; z += 4) posts.push([s * (RAIL_X + 0.2), this.profile(z), z]);
      }
    }
    const im = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, y, z], i) => im.setMatrixAt(i, m.makeTranslation(x, y, z)));
    group.add(im);
    disposables.push(im);
  }

  // River at the bottom, warning signs well ahead, and barricades along the edge wherever there's no ramp.
  buildGapDressing(gap, group, disposables) {
    const depth = GAP_DEPTH * 0.72;
    const wg = new THREE.PlaneGeometry(OUTER_HALF * 2, gap.z1 - gap.z0).rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, waterMat);
    water.position.set(0, Math.min(this.profile(gap.z0), this.profile(gap.z1)) - depth, (gap.z0 + gap.z1) / 2);
    group.add(water);
    disposables.push(wg);

    for (const dz of [120, 60]) {
      const sign = makeSign(dz === 120 ? 'BRIDGE OUT' : '⚠ JUMP IT', '#e87a1a', '#1d1f24');
      const z = gap.z0 - GAP_RUNUP - dz;
      for (const s of [-1, 1]) {
        const sp = s < 0 ? sign : sign.clone();
        sp.position.set(s * (RAIL_X + 3), this.height(s * (RAIL_X + 3), z) + 3.5, z);
        group.add(sp);
      }
      disposables.push(sign.material.map, sign.material);
    }

    const ramps = this.rampsFor(Math.floor(gap.z0 / CHUNK_LEN));
    const spots = [];
    for (let px = -RAIL_X + 0.8; px <= RAIL_X - 0.8; px += 1.4) {
      if (!ramps.some((r) => Math.abs(px - r.x) < r.w / 2 + 0.6)) spots.push(px);
    }
    const barTex = stripeTexture(['#ffffff', '#e8332a'], { w: 64, h: 8, horizontal: false, repeat: 1 });
    barTex.repeat.set(2, 1);
    const barMat = new THREE.MeshLambertMaterial({ map: barTex });
    disposables.push(barTex, barMat);
    const z = gap.z0 - 1.2;
    const h = this.profile(z);
    for (let i = 0; i < spots.length; i += 2) {
      const xa = spots[i], xb = spots[Math.min(i + 1, spots.length - 1)];
      const w = Math.max(1.2, xb - xa + 1.2);
      const plank = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.08), barMat);
      plank.position.set((xa + xb) / 2, h + 0.9, z);
      group.add(plank);
      disposables.push(plank.geometry);
      for (const x of [xa, xb]) {
        const leg = new THREE.Mesh(postGeo, postMat);
        leg.position.set(x, h, z);
        leg.scale.y = 1.25;
        group.add(leg);
      }
    }
  }

  buildObstacle(o, group) {
    const h = this.profile(o.z);
    let mesh;
    switch (o.type) {
      case 'broken': {
        const v = buildVehicle(o.vehicle, o.paint, { broken: true });
        mesh = v.group;
        break;
      }
      case 'barrel':
        mesh = partsGroup([[barrelGeo, barrelMat], [barrelBaseGeo, barrelBaseMat]]);
        break;
      case 'jersey':
        mesh = new THREE.Mesh(jerseyGeo, concreteMat);
        mesh.scale.z = o.len;
        mesh.castShadow = true;
        break;
      case 'arrow':
        mesh = partsGroup(arrowBoardParts(o.dir));
        break;
      case 'excavator':
        mesh = partsGroup(excavatorParts);
        break;
      case 'dump':
        mesh = partsGroup(dumpParts);
        break;
      case 'crate':
        mesh = new THREE.Mesh(crateGeo, woodMat);
        mesh.scale.setScalar(o.s);
        mesh.position.y = o.s / 2;
        mesh.castShadow = true;
        break;
      case 'tyre':
        mesh = new THREE.Mesh(tyreGeo, tyreMat);
        mesh.rotation.x = Math.PI / 2;
        mesh.castShadow = true;
        break;
      case 'hay':
        mesh = new THREE.Mesh(hayGeo, strawMat);
        mesh.castShadow = true;
        break;
      case 'rock':
        mesh = new THREE.Mesh(rockGeo, rockMats[o.biome] || rockMats.forest);
        mesh.scale.set(o.s, o.s * 0.8, o.s);
        mesh.castShadow = true;
        break;
      default:
        return;
    }
    // wrap so the per-type offsets inside survive placement
    const holder = new THREE.Group();
    holder.add(mesh);
    if (o.type === 'tyre') mesh.position.y = 0.2;
    if (o.type === 'hay') mesh.position.y = 0.72;
    if (o.type === 'rock') mesh.position.y = o.s * 0.45;
    holder.position.set(o.x, h, o.z);
    holder.rotation.y = o.rot || 0;
    group.add(holder);
    o.mesh = holder;
  }

  zoneSigns(zone, group, disposables) {
    const text = zone.kind === 'merge' ? 'LANE ENDS' : 'ROAD WORK';
    const sign = makeSign(text, '#e87a1a', '#1d1f24');
    const z = zone.z0 - 50;
    const sides = zone.centre ? [-1, 1] : [zone.side];
    sides.forEach((s, i) => {
      const sp = i === 0 ? sign : sign.clone();
      sp.position.set(s * (RAIL_X + 3), this.height(s * (RAIL_X + 3), z) + 3.5, z);
      group.add(sp);
    });
    disposables.push(sign.material.map, sign.material);
  }

  // Instanced roadside scenery for whichever biome each spot falls in.
  buildScenery(ci, group, disposables, rand, gap) {
    const z0 = ci * CHUNK_LEN;
    const place = {};
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const put = (kind, x, z, scale, rot = rand() * Math.PI * 2, color = null) => {
      if (gap && z > gap.z0 - 6 && z < gap.z1 + 6) return;
      p.set(x, this.height(x, z) - 0.2, z);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot);
      s.setScalar(scale);
      (place[kind] ||= []).push([m.compose(p, q, s).clone(), color]);
    };
    for (let i = 0; i < 44; i++) {
      const side = i % 2 ? 1 : -1;
      const z = z0 + rand() * CHUNK_LEN;
      const biome = this.biomePick(z, rand());
      const near = rand() < 0.55;
      const x = side * (near ? RAIL_X + 7 + rand() * 40 : MESH_HALF + rand() * 260);
      if (biome === 'desert') {
        const k = rand();
        if (k < 0.5) put('cactus', x, z, 0.8 + rand() * 0.7);
        else if (k < 0.93) put('rock', x, z, 0.6 + rand() * 1.6);
        else if (!near) put('mesa', side * (300 + rand() * 300), z, 0.6 + rand() * 0.8);
      } else if (biome === 'farm') {
        const k = rand();
        if (k < 0.84) put('tree', x, z, 0.8 + rand() * 0.6);
        else if (k < 0.93) put('barn', side * (RAIL_X + 30 + rand() * 80), z, 1, side > 0 ? -Math.PI / 2 : Math.PI / 2);
        else put('silo', side * (RAIL_X + 30 + rand() * 80), z, 0.8 + rand() * 0.4);
      } else if (biome === 'forest') {
        put('pine', side * (RAIL_X + 5 + rand() * (near ? 30 : 250)), z, 0.8 + rand() * 0.9);
      } else if (biome === 'canyon') {
        const k = rand();
        if (k < 0.6) put('rock', x, z, 0.8 + rand() * 2);
        else if (k < 0.8) put('cactus', x, z, 0.7 + rand() * 0.5);
        else if (!near) put('mesa', side * (200 + rand() * 300), z, 0.7 + rand() * 0.9);
      } else if (biome === 'mountain') {
        if (rand() < 0.7) put('pine', side * (RAIL_X + 8 + rand() * (near ? 30 : 250)), z, 0.7 + rand() * 0.8);
        else put('crag', x, z, 0.8 + rand() * 1.8);
      } else {
        const k = ['b0', 'b1', 'b2', 'b3'][Math.floor(rand() * 4)];
        const bx = side * (RAIL_X + 22 + rand() * (near ? 40 : 220));
        put(k, bx, z, 1, Math.floor(rand() * 4) * (Math.PI / 2), BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)]);
      }
    }
    // street lights through the city, out past the guardrail
    for (let z = z0; z < z0 + CHUNK_LEN; z += 40) {
      if (this.biomeAt(z).a === 'city' || this.biomeAt(z).t > 0.5 && this.biomeAt(z).b === 'city') {
        put('lamp', RAIL_X + 1.6, z, 1, -Math.PI / 2);
        put('lamp', -RAIL_X - 1.6, z + 20, 1, Math.PI / 2);
      }
    }
    const col = new THREE.Color();
    for (const [kind, list] of Object.entries(place)) {
      for (const [geo, mat] of SCENERY[kind]) {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([mm, color], i) => {
          im.setMatrixAt(i, mm);
          if (color !== null) im.setColorAt(i, col.setHex(color));
        });
        im.castShadow = kind !== 'mesa';
        group.add(im);
        disposables.push(im);
      }
    }
  }

  // One coin over the middle of a gap, on the path of a typical jump off the ramp.
  gapCoins(r, addCoin) {
    const lip = r.lip - 1e-3;
    const y0 = this.height(r.x, lip);
    const slope = (y0 - this.height(r.x, lip - 0.6)) / 0.6;
    const mid = (r.gap.z0 + r.gap.z1) / 2;
    const speed = 30;
    let z = lip, y = y0 + 0.7, vz = speed / Math.hypot(1, slope), vy = vz * slope;
    while (z < mid) {
      const dt = 0.02;
      vy -= 12 * dt;
      z += vz * dt;
      y += vy * dt;
      if (y < this.surface(r.x, z) + 0.7) return;
    }
    addCoin(r.x, y, z, true);
  }

  disposeChunk(chunk) {
    this.scene.remove(chunk.group);
    for (const d of chunk.disposables) d.dispose();
  }

  dispose() {
    for (const chunk of this.chunks.values()) this.disposeChunk(chunk);
    this.chunks.clear();
    for (const cache of [this.gaps, this.ramps, this.pads, this.oil, this.layouts, this.crossers]) cache.clear();
  }
}

function makeSign(text, bg = '#1f6b3a', fg = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, 312, 88, 14);
  ctx.fill();
  ctx.strokeStyle = fg;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(12, 12, 296, 72, 10);
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = 'bold 50px Fredoka, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 52, 280);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(7.5, 2.25, 1);
  return sprite;
}
