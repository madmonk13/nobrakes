// Low-poly traffic: sedans, hatchbacks, SUVs, pickups, vans, box trucks, buses and semis.
// Each type's parts are merged into one geometry per material and built once, so a vehicle
// is a handful of meshes that share geometry; only the paint material differs between them.
// Vehicles face +z with their origin on the road under their centre.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowGeometry, glowMesh, addLamp } from './nightlights.js';

const SPECS = {
  sedan: { L: 4.5, W: 1.8, H: 1.48, wheelR: 0.33, axles: [1.4, -1.4], lower: [0.3, 0.92], cabin: { z0: -1.3, z1: 0.8, y1: 1.42, inset: 0.12 } },
  hatch: { L: 3.9, W: 1.75, H: 1.5, wheelR: 0.31, axles: [1.2, -1.2], lower: [0.3, 0.92], cabin: { z0: -1.85, z1: 0.5, y1: 1.44, inset: 0.1 } },
  suv: { L: 4.8, W: 1.95, H: 1.82, wheelR: 0.4, axles: [1.5, -1.5], lower: [0.4, 1.12], cabin: { z0: -2.3, z1: 0.9, y1: 1.75, inset: 0.1 } },
  pickup: { L: 5.3, W: 2.0, H: 1.86, wheelR: 0.42, axles: [1.7, -1.7], lower: [0.42, 1.12], cabin: { z0: -0.4, z1: 1.2, y1: 1.8, inset: 0.1 }, bed: true },
  van: { L: 5.2, W: 2.0, H: 2.3, wheelR: 0.38, axles: [1.7, -1.8], tall: { y0: 0.38, y1: 2.3, band: [1.4, 1.9] } },
  boxtruck: { L: 7.6, W: 2.4, H: 3.5, wheelR: 0.5, axles: [2.6, -2.4], cab: { z0: 2.0, z1: 3.8, y0: 0.5, y1: 2.6, band: [1.65, 2.25] }, cargo: { z0: -3.8, z1: 1.9, y0: 0.75, y1: 3.5 } },
  bus: { L: 11.5, W: 2.5, H: 3.2, wheelR: 0.52, axles: [3.8, -3.4], tall: { y0: 0.45, y1: 3.2, band: [1.7, 2.6] } },
  semi: { L: 17, W: 2.5, H: 4.0, wheelR: 0.52, axles: [7.2, 4.4, 3.3, -6.2, -7.3], cab: { z0: 5.0, z1: 8.5, y0: 0.6, y1: 3.3, band: [2.1, 2.8] }, cargo: { z0: -8.5, z1: 4.4, y0: 1.25, y1: 4.0 } },
};
export const VEHICLE_TYPES = Object.keys(SPECS);
export const VEHICLE_NAMES = {
  sedan: 'a sedan', hatch: 'a hatchback', suv: 'an SUV', pickup: 'a pickup', van: 'a van',
  boxtruck: 'a box truck', bus: 'a bus', semi: 'a semi truck',
};

const PAINTS = [0xd8dde2, 0xf4f4f0, 0x23262b, 0xc0392b, 0x2f6fbf, 0x5a6470, 0x2e8b57, 0xe0a33a, 0x7a3e9d, 0x1f4e79, 0xd8dde2, 0xf4f4f0, 0x5a6470];
const BUS_PAINTS = [0xf2b417, 0xf2b417, 0xf4f4f0, 0x2f6fbf];
export function randomPaint(r = Math.random, type = 'sedan') {
  const list = type === 'bus' ? BUS_PAINTS : PAINTS;
  return list[Math.floor(r() * list.length)];
}

const paintMats = new Map();
function paintMat(hex) {
  let m = paintMats.get(hex);
  if (!m) paintMats.set(hex, (m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true })));
  return m;
}
export const glassMat = new THREE.MeshPhongMaterial({ color: 0x23303d, shininess: 90, specular: 0x8899aa });
export const darkMat = new THREE.MeshLambertMaterial({ color: 0x1d1f23, flatShading: true });
export const tailMat = new THREE.MeshLambertMaterial({ color: 0xff3a30, emissive: 0xa01010 });
export const headMat = new THREE.MeshLambertMaterial({ color: 0xfff6d8, emissive: 0x8a8060 });
addLamp(tailMat, 0xff2a1a);
addLamp(headMat, 0xfff2c8);
export const chromeMat = new THREE.MeshLambertMaterial({ color: 0xb8bec6 });
const cargoMat = new THREE.MeshLambertMaterial({ color: 0xeef0f2, flatShading: true });
// one material for every broken-down car's hazard lights, blinked by Terrain.animate()
export const hazardMat = new THREE.MeshLambertMaterial({ color: 0xffa83a, emissive: 0xff9a1a });
// turn signals: shown or hidden per vehicle by the traffic
export const blinkerMat = new THREE.MeshLambertMaterial({ color: 0xffb030, emissive: 0xff8a00 });
const smokeMat = new THREE.MeshLambertMaterial({ color: 0xcfd2d6, transparent: true, opacity: 0.55, depthWrite: false });

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

// Parts for one type, grouped by material key: paint, glass, dark, cargo, tail, head, chrome.
function partsFor(type) {
  const s = SPECS[type];
  const P = { paint: [], glass: [], dark: [], cargo: [], tail: [], head: [], chrome: [], blinkL: [], blinkR: [] };
  const { L, W } = s;
  let tailY = 0.8, headY = 0.75, frontZ = L / 2, rearZ = -L / 2;
  if (s.cabin) {
    const [y0, y1] = s.lower;
    P.paint.push(box(W, y1 - y0, L, 0, (y0 + y1) / 2, 0));
    P.dark.push(box(W + 0.04, 0.18, 0.14, 0, y0 + 0.08, L / 2), box(W + 0.04, 0.18, 0.14, 0, y0 + 0.08, -L / 2));
    const c = s.cabin;
    const cw = W - c.inset * 2;
    P.glass.push(box(cw, c.y1 - y1, c.z1 - c.z0, 0, (y1 + c.y1) / 2, (c.z0 + c.z1) / 2));
    P.paint.push(box(cw + 0.02, 0.07, c.z1 - c.z0 - 0.3, 0, c.y1 + 0.03, (c.z0 + c.z1) / 2 - 0.05));
    // pillars either side of the side windows
    for (const z of [c.z0 + 0.12, (c.z0 + c.z1) / 2, c.z1 - 0.12]) P.paint.push(box(cw + 0.03, c.y1 - y1, 0.1, 0, (y1 + c.y1) / 2, z));
    if (s.bed) {
      const bz0 = -L / 2, bz1 = c.z0;
      for (const sx of [-1, 1]) P.paint.push(box(0.08, 0.42, bz1 - bz0, sx * (W / 2 - 0.04), y1 + 0.21, (bz0 + bz1) / 2));
      P.paint.push(box(W, 0.42, 0.08, 0, y1 + 0.21, bz0 + 0.04));
      P.dark.push(box(W - 0.16, 0.02, bz1 - bz0 - 0.1, 0, y1 + 0.01, (bz0 + bz1) / 2));
    }
    tailY = y1 - 0.14;
    headY = y1 - 0.18;
  } else if (s.tall) {
    const t = s.tall;
    P.paint.push(box(W, t.y1 - t.y0, L, 0, (t.y0 + t.y1) / 2, 0));
    P.glass.push(box(W + 0.03, t.band[1] - t.band[0], L - 0.5, 0, (t.band[0] + t.band[1]) / 2, -0.1));
    P.glass.push(box(W - 0.3, t.band[1] - t.band[0] + 0.15, 0.04, 0, (t.band[0] + t.band[1]) / 2 + 0.05, L / 2 + 0.01));
    P.dark.push(box(W + 0.04, 0.22, 0.14, 0, t.y0 + 0.1, L / 2), box(W + 0.04, 0.22, 0.14, 0, t.y0 + 0.1, -L / 2));
    tailY = t.y0 + 0.55;
    headY = t.y0 + 0.4;
  } else {
    const c = s.cab, g = s.cargo;
    P.paint.push(box(W, c.y1 - c.y0, c.z1 - c.z0, 0, (c.y0 + c.y1) / 2, (c.z0 + c.z1) / 2));
    P.glass.push(box(W + 0.03, c.band[1] - c.band[0], c.z1 - c.z0 - 0.6, 0, (c.band[0] + c.band[1]) / 2, (c.z0 + c.z1) / 2 - 0.1));
    P.glass.push(box(W - 0.3, c.band[1] - c.band[0], 0.04, 0, (c.band[0] + c.band[1]) / 2, c.z1 + 0.01));
    P.cargo.push(box(W + 0.04, g.y1 - g.y0, g.z1 - g.z0, 0, (g.y0 + g.y1) / 2, (g.z0 + g.z1) / 2));
    P.dark.push(box(W - 0.3, 0.32, L, 0, 0.62, 0));
    P.dark.push(box(W + 0.04, 0.24, 0.14, 0, c.y0 + 0.1, L / 2), box(W + 0.04, 0.24, 0.14, 0, 0.7, -L / 2));
    tailY = 0.95;
    headY = c.y0 + 0.4;
  }
  for (const sx of [-1, 1]) {
    P.tail.push(box(0.36, 0.14, 0.05, sx * (W / 2 - 0.28), tailY, rearZ - 0.02));
    P.head.push(box(0.34, 0.13, 0.05, sx * (W / 2 - 0.3), headY, frontZ + 0.02));
    const bl = sx > 0 ? P.blinkL : P.blinkR;
    bl.push(box(0.14, 0.14, 0.06, sx * (W / 2 - 0.06), tailY, rearZ - 0.03), box(0.12, 0.1, 0.06, sx * (W / 2 - 0.05), headY, frontZ + 0.03));
  }
  // after dark: halos round the tail lights and a pool of headlight on the road ahead
  const glow = glowGeometry({
    tails: [-1, 1].map((sx) => [sx * (W / 2 - 0.28), tailY, rearZ]),
    pool: { z: frontZ + 0.3, len: Math.min(14, 8 + W * 2.5), w: W * 2.3 },
    size: W > 2.2 ? 1.2 : 1,
  });
  const tw = type === 'semi' || type === 'boxtruck' || type === 'bus' ? 0.4 : 0.26;
  for (const z of s.axles) {
    for (const sx of [-1, 1]) {
      P.dark.push(new THREE.CylinderGeometry(s.wheelR, s.wheelR, tw, 10).rotateZ(Math.PI / 2).translate(sx * (W / 2 - tw / 2 + 0.02), s.wheelR, z));
      P.chrome.push(new THREE.CylinderGeometry(s.wheelR * 0.55, s.wheelR * 0.55, 0.02, 8).rotateZ(Math.PI / 2).translate(sx * (W / 2 + 0.03), s.wheelR, z));
    }
  }
  const out = { glow };
  for (const [k, list] of Object.entries(P)) if (list.length) out[k] = mergeGeometries(list.map((g) => g.toNonIndexed()));
  return out;
}

const cache = new Map();
const MAT = { glass: glassMat, dark: darkMat, cargo: cargoMat, tail: tailMat, head: headMat, chrome: chromeMat, blinkL: blinkerMat, blinkR: blinkerMat };

// Raised bonnet and a wisp of steam for a broken-down car.
function brokenExtras(s, paint) {
  const g = new THREE.Group();
  const top = s.cabin ? s.lower[1] : s.tall ? s.tall.y0 + 0.8 : s.cab.y0 + 1.4;
  const hoodLen = s.cabin ? s.L / 2 - s.cabin.z1 - 0.1 : 0.9;
  // hinged at its back edge (by the windscreen) and swung up at the front
  const hood = new THREE.Mesh(new THREE.BoxGeometry(s.W - 0.1, 0.05, hoodLen).translate(0, 0, hoodLen / 2), paintMat(paint));
  hood.position.set(0, top + 0.02, s.cabin ? s.cabin.z1 + 0.05 : s.L / 2 - hoodLen);
  hood.rotation.x = -0.9;
  hood.castShadow = true;
  g.add(hood);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.08), hazardMat);
    h.position.set(sx * (s.W / 2 - 0.08), (s.cabin ? s.lower[1] : 1.0) - 0.1, sz * (s.L / 2 + 0.04));
    g.add(h);
  }
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + i * 0.15, 0), smokeMat);
    puff.position.set((i - 1) * 0.2, top + 0.5 + i * 0.55, s.L / 2 - 0.6 - i * 0.2);
    g.add(puff);
  }
  return g;
}

// Returns { group, spec, blinkers: [left, right] }
export function buildVehicle(type, paint, { broken = false } = {}) {
  let parts = cache.get(type);
  if (!parts) cache.set(type, (parts = partsFor(type)));
  const s = SPECS[type];
  const group = new THREE.Group();
  const blinkers = [];
  for (const [k, geo] of Object.entries(parts)) {
    if (k === 'glow') {
      if (!broken) group.add(glowMesh(geo)); // a broken-down car's lights are off
      continue;
    }
    const mesh = new THREE.Mesh(geo, k === 'paint' ? paintMat(paint) : MAT[k]);
    mesh.castShadow = k === 'paint' || k === 'cargo';
    if (k === 'blinkL' || k === 'blinkR') {
      mesh.visible = false;
      blinkers[k === 'blinkL' ? 0 : 1] = mesh;
    }
    group.add(mesh);
  }
  if (broken) group.add(brokenExtras(s, paint));
  return { group, spec: s, blinkers };
}
buildVehicle.spec = (type) => SPECS[type];
