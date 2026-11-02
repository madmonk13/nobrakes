// Coin pickup effect: the coin hops up over the car, spins and shrinks away,
// with a burst of golden glints. Ghost coins ride along with the car so they
// stay in view at any speed.

import * as THREE from 'three';
import { coinGeo, coinMat, concreteChunkMat, rockMats, woodMat, strawMat, tyreMat, ROLLER_DEBRIS } from './terrain.js';
import { glassMat } from './vehicles.js';

const GHOSTS = 24;
const GHOST_LIFE = 0.42;
const GLINTS = 240;
const GLINTS_PER_COIN = 10;
const GLINT_LIFE = 0.5;
const HOP = new THREE.Vector3(0, 2.6, 0); // where the ghost coin ends up, relative to the car

function glintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,214,70,1)');
  g.addColorStop(0.6, 'rgba(240,160,20,0.7)');
  g.addColorStop(1, 'rgba(240,160,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  // four-point star streaks
  ctx.fillStyle = 'rgba(255,236,150,1)';
  ctx.fillRect(15, 1, 2, 30);
  ctx.fillRect(1, 15, 30, 2);
  return new THREE.CanvasTexture(c);
}

const ease = (t) => 1 - Math.pow(1 - t, 3);

export class CoinFx {
  constructor(scene) {
    this.ghosts = [];
    for (let i = 0; i < GHOSTS; i++) {
      const material = coinMat.map((m) => {
        const c = m.clone();
        c.transparent = true;
        return c;
      });
      const mesh = new THREE.Mesh(coinGeo, material);
      mesh.visible = false;
      scene.add(mesh);
      this.ghosts.push({ mesh, t: 1, from: new THREE.Vector3() });
    }
    this.nextGhost = 0;

    this.glintPos = new Float32Array(GLINTS * 3).fill(-99999);
    this.glintCol = new Float32Array(GLINTS * 3);
    this.glintVel = new Float32Array(GLINTS * 3);
    this.glintLife = new Float32Array(GLINTS);
    this.nextGlint = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.glintPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.glintCol, 3));
    this.glints = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.7, map: glintTexture(), vertexColors: true, transparent: true,
        depthWrite: false, alphaTest: 0.02,
      }),
    );
    this.glints.frustumCulled = false;
    scene.add(this.glints);
  }

  // pos: the coin's world position at pickup; body: the car it flies to
  collect(pos, body) {
    const g = this.ghosts[this.nextGhost];
    this.nextGhost = (this.nextGhost + 1) % GHOSTS;
    g.t = 0;
    g.from.copy(pos).sub(body.pos);
    g.mesh.visible = true;
    g.mesh.position.copy(pos);

    for (let k = 0; k < GLINTS_PER_COIN; k++) {
      const i = this.nextGlint;
      this.nextGlint = (this.nextGlint + 1) % GLINTS;
      const o = i * 3;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 2 - 0.5;
      const s = 3 + Math.random() * 3;
      this.glintPos[o] = pos.x;
      this.glintPos[o + 1] = pos.y;
      this.glintPos[o + 2] = pos.z;
      // inherit most of the car's velocity so the burst doesn't streak backwards
      this.glintVel[o] = body.vel.x * 0.85 + Math.cos(a) * s;
      this.glintVel[o + 1] = body.vel.y * 0.85 + up * s;
      this.glintVel[o + 2] = body.vel.z * 0.85 + Math.sin(a) * s;
      this.glintLife[i] = GLINT_LIFE * (0.6 + Math.random() * 0.4);
    }
  }

  update(dt, body) {
    for (const g of this.ghosts) {
      if (g.t >= 1) continue;
      g.t = Math.min(1, g.t + dt / GHOST_LIFE);
      const m = g.mesh;
      if (g.t >= 1) {
        m.visible = false;
        continue;
      }
      const e = ease(g.t);
      m.position.copy(g.from).lerp(HOP, e).add(body.pos);
      m.position.y += Math.sin(g.t * Math.PI) * 0.6; // little arc on the way up
      const scale = g.t < 0.3 ? 1 + g.t * 1.5 : 1.45 * (1 - (g.t - 0.3) / 0.7) + 0.1;
      m.scale.setScalar(scale);
      m.rotation.y += dt * 22;
      const opacity = g.t < 0.6 ? 1 : 1 - (g.t - 0.6) / 0.4;
      for (const mat of m.material) mat.opacity = opacity;
    }

    for (let i = 0; i < GLINTS; i++) {
      if (this.glintLife[i] <= 0) continue;
      const o = i * 3;
      this.glintLife[i] -= dt;
      if (this.glintLife[i] <= 0) {
        this.glintPos[o + 1] = -99999;
        continue;
      }
      this.glintVel[o + 1] -= 6 * dt;
      this.glintPos[o] += this.glintVel[o] * dt;
      this.glintPos[o + 1] += this.glintVel[o + 1] * dt;
      this.glintPos[o + 2] += this.glintVel[o + 2] * dt;
      // flicker between white-hot and gold so the burst twinkles
      const tw = 0.75 + 0.25 * Math.sin(this.glintLife[i] * 60 + i);
      this.glintCol[o] = 1;
      this.glintCol[o + 1] = tw;
      this.glintCol[o + 2] = tw * 0.8;
    }
    this.glints.geometry.attributes.position.needsUpdate = true;
    this.glints.geometry.attributes.color.needsUpdate = true;
  }
}

// Hazard hits: a burst of tumbling pieces in the right material (plastic, concrete, wood, straw,
// rock, glass, paint) that bounce on the road, and knocked cones and triangles that cartwheel away.
const DEBRIS = 90;
const DEBRIS_LIFE = 1.8;
const chunkGeo = new THREE.IcosahedronGeometry(1, 0);
const shardGeo = new THREE.TetrahedronGeometry(1, 0);
const plateGeo = new THREE.BoxGeometry(1, 0.25, 1);
const orangeMat = new THREE.MeshLambertMaterial({ color: 0xff6a13, flatShading: true });
const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf2f2ee, flatShading: true });
const darkMat = new THREE.MeshLambertMaterial({ color: 0x2a2c31, flatShading: true });
const yellowMat = new THREE.MeshLambertMaterial({ color: 0xf2b417, flatShading: true });
const paintMats = new Map();
function paintMat(hex) {
  let m = paintMats.get(hex);
  if (!m) paintMats.set(hex, (m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true })));
  return m;
}

export class HazardFx {
  constructor(scene, terrainRef) {
    this.terrainRef = terrainRef; // () => current terrain, for bouncing off the road
    this.pieces = [];
    for (let i = 0; i < DEBRIS; i++) {
      const mesh = new THREE.Mesh(chunkGeo, darkMat);
      mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      this.pieces.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, size: 1 });
    }
    this.next = 0;
    this.tumblers = [];
    this.wobbles = [];
  }

  spawn(geo, mat, size, pos, vel) {
    const p = this.pieces[this.next];
    this.next = (this.next + 1) % DEBRIS;
    p.mesh.geometry = geo;
    p.mesh.material = mat;
    p.mesh.visible = true;
    p.mesh.position.copy(pos);
    p.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    p.size = size;
    p.mesh.scale.setScalar(size);
    p.vel.copy(vel);
    p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14);
    p.life = DEBRIS_LIFE * (0.7 + Math.random() * 0.3);
  }

  // n pieces from (x, y, z), flung along with vel plus a random scatter
  burst(list, n, x, y, z, vel, scatter = 4, carry = 0.5) {
    const pos = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const [geo, mat, size] = list[i % list.length];
      pos.set(x + (Math.random() - 0.5) * 1.2, y + Math.random() * 0.8, z + (Math.random() - 0.5) * 1.2);
      v.copy(vel).multiplyScalar(carry * (0.6 + Math.random() * 0.6));
      v.x += (Math.random() - 0.5) * scatter * 2;
      v.y += 2 + Math.random() * scatter;
      v.z += (Math.random() - 0.5) * scatter * 2;
      this.spawn(geo, mat, size * (0.6 + Math.random() * 0.8), pos, v);
    }
  }

  // Shards of glass and flecks of paint: every crash makes some.
  crunch(x, y, z, vel, paint = 0xe84a3a) {
    this.burst([[shardGeo, glassMat, 0.12], [plateGeo, paintMat(paint), 0.25], [shardGeo, glassMat, 0.08]], 14, x, y, z, vel, 4, 0.35);
  }

  // hit: { obstacle, vel, x, z } from the physics
  obstacle(hit, carPaint) {
    const o = hit.obstacle;
    const terrain = this.terrainRef();
    const g = terrain ? terrain.profile(o.z) : 0;
    const vel = hit.vel;
    const pieces = {
      barrel: [[plateGeo, orangeMat, 0.35], [plateGeo, whiteMat, 0.3], [chunkGeo, darkMat, 0.15]],
      barrier: [[chunkGeo, concreteChunkMat, 0.25], [chunkGeo, concreteChunkMat, 0.15]],
      arrow: [[plateGeo, darkMat, 0.3], [chunkGeo, yellowMat, 0.12]],
      machine: [[plateGeo, yellowMat, 0.3], [chunkGeo, darkMat, 0.2]],
      crate: [[plateGeo, woodMat, 0.35], [plateGeo, woodMat, 0.2]],
      hay: [[chunkGeo, strawMat, 0.3], [plateGeo, strawMat, 0.2]],
      tyre: [[chunkGeo, tyreMat, 0.2]],
      rock: [[chunkGeo, rockMats[o.biome] || rockMats.forest, 0.3], [chunkGeo, rockMats[o.biome] || rockMats.forest, 0.15]],
      broken: [[plateGeo, paintMat(o.paint || 0xcccccc), 0.3], [shardGeo, glassMat, 0.12]],
    }[o.kind] || [[chunkGeo, darkMat, 0.2]];
    this.burst(pieces, o.kind === 'barrel' || o.kind === 'hay' || o.kind === 'crate' ? 16 : 10, hit.x, g + 0.5, hit.z + 1, vel, 4, 0.5);
    this.crunch(hit.x, g + 0.7, hit.z, vel, carPaint);
    // light things go flying with the car; heavy ones just rock
    if (o.mesh && (o.kind === 'barrel' || o.kind === 'crate' || o.kind === 'hay' || o.kind === 'tyre')) {
      this.fling(o.mesh, vel, 0.8);
      o.h = -1; // gone: nothing left there to hit
    } else if (o.mesh) {
      this.wobble(o.mesh, 0.06);
    }
  }

  // A traffic vehicle you hit: glass and paint everywhere.
  vehicle(hit, carPaint) {
    const v = hit.vehicle;
    const terrain = this.terrainRef();
    const g = terrain ? terrain.profile(v.z) : 0;
    const paint = v.mesh.children[0]?.material?.color?.getHex?.() ?? 0xcccccc;
    this.burst([[plateGeo, paintMat(paint), 0.3], [shardGeo, glassMat, 0.12], [chunkGeo, darkMat, 0.15]], 16, v.x, g + 0.8, v.z - v.spec.L / 2, hit.vel, 4, 0.3);
    this.crunch(v.x, g + 0.8, v.z - v.spec.L / 2, hit.vel, carPaint);
  }

  crosser(hit, carPaint) {
    const b = hit.ball;
    const list = b.kind === 'boulder' ? [[chunkGeo, rockMats[b.biome] || rockMats.forest, 0.35]] : [[chunkGeo, ROLLER_DEBRIS[b.kind], b.kind === 'log' ? 0.25 : 0.12]];
    this.burst(list, b.kind === 'bale' || b.kind === 'tumbleweed' ? 20 : 12, hit.x, hit.y - hit.r * 0.5, hit.z, new THREE.Vector3(b.dir * b.speed, 0, 0), 4, 0.6);
    if (b.kind !== 'tumbleweed') this.crunch(hit.x, hit.y, hit.z, hit.vel, carPaint);
  }

  // A cone or warning triangle cartwheels off ahead of the car.
  knock(hit) {
    const k = hit.knockable;
    if (k.mesh) this.fling(k.mesh, hit.vel, 1.05);
  }

  fling(mesh, vel, carry) {
    const v = vel.clone().multiplyScalar(carry);
    v.x += (Math.random() - 0.5) * 8;
    v.y = Math.max(0, v.y) + 4 + Math.random() * 4;
    this.tumblers.push({ mesh, vel: v, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(16), t: 0 });
  }

  wobble(mesh, amp) {
    if (this.wobbles.some((w) => w.mesh === mesh)) return;
    this.wobbles.push({ mesh, t: 0, amp, baseX: mesh.rotation.x, baseZ: mesh.rotation.z });
  }

  update(dt) {
    const terrain = this.terrainRef();
    for (const p of this.pieces) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const m = p.mesh;
      if (p.life <= 0) {
        m.visible = false;
        continue;
      }
      p.vel.y -= 12 * dt;
      m.position.addScaledVector(p.vel, dt);
      m.rotation.x += p.spin.x * dt;
      m.rotation.y += p.spin.y * dt;
      m.rotation.z += p.spin.z * dt;
      const floor = terrain ? terrain.height(m.position.x, m.position.z) + p.size * 0.3 : -Infinity;
      if (m.position.y < floor) {
        m.position.y = floor;
        if (p.vel.y < 0) p.vel.y *= -0.3;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
        p.spin.multiplyScalar(0.7);
      }
      m.scale.setScalar(p.size * Math.min(1, p.life / 0.4));
    }

    for (let i = this.tumblers.length - 1; i >= 0; i--) {
      const tb = this.tumblers[i];
      const m = tb.mesh;
      tb.t += dt;
      tb.vel.y -= 12 * dt;
      m.position.addScaledVector(tb.vel, dt);
      m.rotation.x += tb.spin.x * dt;
      m.rotation.y += tb.spin.y * dt;
      m.rotation.z += tb.spin.z * dt;
      const floor = terrain ? terrain.height(m.position.x, m.position.z) : -Infinity;
      if (m.position.y < floor) {
        m.position.y = floor;
        if (tb.vel.y < 0) tb.vel.y *= -0.35;
        tb.vel.x *= 0.75;
        tb.vel.z *= 0.75;
        tb.spin.multiplyScalar(0.6);
      }
      if (tb.t > 4) {
        m.visible = false;
        this.tumblers.splice(i, 1);
      }
    }

    for (let i = this.wobbles.length - 1; i >= 0; i--) {
      const w = this.wobbles[i];
      w.t += dt;
      const k = Math.max(0, 1 - w.t / 1.1);
      w.mesh.rotation.z = w.baseZ + Math.sin(w.t * 22) * w.amp * k;
      w.mesh.rotation.x = w.baseX + Math.sin(w.t * 17) * w.amp * 0.5 * k;
      if (k === 0) this.wobbles.splice(i, 1);
    }
  }
}
