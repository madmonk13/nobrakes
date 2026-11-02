// Headlights after dark, faked so they cost next to nothing: no real lights, just the lamp
// materials glowing brighter, soft halos round the tail lights, and a pool of light on the road
// ahead of every vehicle. Each vehicle's glow is one merged mesh (one draw call) drawn with a
// single additive material, so the whole lot fades in and out with one opacity.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// a soft round spot; stretched over a long quad it makes an oval pool
const glowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

const glowMat = new THREE.MeshBasicMaterial({
  map: glowTex, vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
  blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
});
glowMat.visible = false;

const POOL = new THREE.Color(0xfff0c8);
const TAIL = new THREE.Color(0xff2a1e);
const HEAD = new THREE.Color(0xfff6dc);

function quad(w, h, color, strength) {
  const g = new THREE.PlaneGeometry(w, h);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(cols, i * 3);
  for (let i = 0; i < cols.length; i++) cols[i] *= strength;
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

// One vehicle's glow, in its own frame (z forward, y up, ground at 0):
// tails/heads: [[x, y, z], ...] lamp centres; pool: { z, len, w } on the road ahead.
export function glowGeometry({ tails = [], heads = [], pool = null, size = 1 }) {
  const parts = [];
  for (const [x, y, z] of tails) parts.push(quad(1.2 * size, 0.75 * size, TAIL, 1).rotateY(Math.PI).translate(x, y, z - 0.05));
  for (const [x, y, z] of heads) parts.push(quad(1.0 * size, 0.7 * size, HEAD, 0.8).translate(x, y, z + 0.05));
  if (pool) {
    // a long faint oval with a brighter one nearer the bonnet
    parts.push(quad(pool.w, pool.len, POOL, 0.4).rotateX(-Math.PI / 2).translate(0, 0.06, pool.z + pool.len * 0.42));
    parts.push(quad(pool.w * 0.75, pool.len * 0.5, POOL, 0.25).rotateX(-Math.PI / 2).translate(0, 0.07, pool.z + pool.len * 0.22));
  }
  return mergeGeometries(parts);
}

export function glowMesh(geo) {
  const m = new THREE.Mesh(geo, glowMat);
  m.renderOrder = 2; // after the opaque world
  return m;
}

// lamp materials that glow brighter after dark: { mat, day, night } emissive colours
const lamps = [];
export function addLamp(mat, nightEmissive) {
  lamps.push({ mat, day: mat.emissive.clone(), night: new THREE.Color(nightEmissive) });
}

// dark: 0 by day, 1 at full night
export function setNight(dark) {
  const k = THREE.MathUtils.smoothstep(dark, 0.25, 0.85);
  glowMat.opacity = k;
  glowMat.visible = k > 0.01;
  for (const l of lamps) l.mat.emissive.copy(l.day).lerp(l.night, k);
}
