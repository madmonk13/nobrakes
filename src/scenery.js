// Distant mountains, clouds, and the tyre smoke and sparks thrown up by the car.

import * as THREE from 'three';
import { mulberry32 } from './rng.js';

const ROCK = new THREE.Color(0x8d9bb0);
const SNOW = new THREE.Color(0xffffff);

// One craggy peak: a cone with a concave profile, ridges, a leaning summit and a
// ragged snow line. Displacement depends only on position, so seam vertices agree.
function peakGeometry(r, radius, h) {
  const geo = new THREE.ConeGeometry(radius, h, 11, 6);
  const p = Array.from({ length: 6 }, () => r() * Math.PI * 2);
  const leanX = (r() - 0.5) * 0.5 * radius, leanZ = (r() - 0.5) * 0.5 * radius;
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y + h / 2) / h; // 0 at the base, 1 at the summit
    const a = Math.atan2(v.x, v.z);
    const ridge = 1 + 0.22 * Math.sin(3 * a + p[0]) + 0.12 * Math.sin(5 * a + p[1]) + 0.08 * Math.sin(8 * a + p[2] + t * 4);
    const concave = Math.pow(1 - t, 1.05) / Math.max(1e-3, 1 - t) * (1 + 0.25 * Math.sin(Math.PI * t)); // full shoulders, wide skirts
    const s = t < 1 ? ridge * concave : 0;
    v.x *= s;
    v.z *= s;
    v.y += h * 0.07 * Math.sin(a * 2 + p[3] + t * 6) * t * (1 - t) * 4;
    v.x += leanX * t * t;
    v.z += leanZ * t * t;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = geo.toNonIndexed();
  geo.dispose();
  // colour whole faces so the snow line stays crisp in flat shading
  const fp = flat.attributes.position;
  const colors = new Float32Array(fp.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < fp.count; f += 3) {
    const y = (fp.getY(f) + fp.getY(f + 1) + fp.getY(f + 2)) / 3;
    const x = (fp.getX(f) + fp.getX(f + 1) + fp.getX(f + 2)) / 3;
    const z = (fp.getZ(f) + fp.getZ(f + 1) + fp.getZ(f + 2)) / 3;
    const t = (y + h / 2) / h;
    const line = 0.55 + 0.1 * Math.sin(Math.atan2(x, z) * 4 + p[4]) + (r() - 0.5) * 0.08;
    c.copy(t > line ? SNOW : ROCK).offsetHSL(0, 0, (r() - 0.5) * 0.05);
    for (let k = 0; k < 3; k++) c.toArray(colors, (f + k) * 3);
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  return flat;
}

// A ring of big low-poly ranges that follows the camera so it never gets closer.
export class Mountains {
  constructor(scene) {
    this.group = new THREE.Group();
    const r = mulberry32(1234);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
    const COUNT = 40;
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2 + r() * 0.1;
      const dist = 900 + r() * 250;
      const cx = Math.sin(a) * dist, cz = Math.cos(a) * dist;
      // main peak plus a couple of lower shoulders so ranges overlap instead of standing alone
      const subs = 1 + Math.floor(r() * 3);
      for (let k = 0; k < subs; k++) {
        const main = k === 0;
        const h = main ? 140 + r() * 180 : 70 + r() * 100;
        const radius = (main ? 170 : 110) + r() * 120;
        const mesh = new THREE.Mesh(peakGeometry(r, radius, h), material);
        const off = main ? 0 : (r() < 0.5 ? -1 : 1) * (130 + r() * 110);
        mesh.position.set(cx + Math.cos(a) * off, h / 2 - 60, cz - Math.sin(a) * off);
        mesh.rotation.y = r() * Math.PI * 2;
        this.group.add(mesh);
      }
    }
    scene.add(this.group);
  }

  follow(camera) {
    this.group.position.set(camera.position.x, camera.position.y - 120, camera.position.z);
  }
}

// Soft cumulus drawn from overlapping puffs: bright tops, a faint blue-grey underside.
function cloudTexture(r) {
  const W = 256, H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const base = H * 0.72;
  const puffs = [];
  const n = 6 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = W * (0.16 + 0.68 * t) + (r() - 0.5) * 14;
    const rad = H * (0.16 + 0.2 * Math.sin(Math.PI * t) + r() * 0.08);
    puffs.push([x, base - rad * (0.45 + r() * 0.35), rad]);
  }
  // silhouette first in plain white, so overlapping puffs merge without seams
  for (const [x, y, rad] of puffs) {
    const g = ctx.createRadialGradient(x, y, rad * 0.7, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // then a gentle cool shade toward the underside, painted only where the cloud is
  ctx.globalCompositeOperation = 'source-atop';
  const shade = ctx.createLinearGradient(0, base - H * 0.45, 0, base);
  shade.addColorStop(0, 'rgba(214,228,245,0)');
  shade.addColorStop(1, 'rgba(206,222,242,0.75)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  // fade the flat bottom out softly
  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, base - 6, 0, base + 14);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, base - 6, W, H - base + 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const CLOUD_COUNT = 22;

// Fair-weather clouds on a slowly turning ring that follows the camera like the mountains.
export class Clouds {
  constructor(scene) {
    this.group = new THREE.Group();
    const r = mulberry32(777);
    const textures = Array.from({ length: 5 }, () => cloudTexture(r));
    this.clouds = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const material = new THREE.SpriteMaterial({
        map: textures[i % textures.length], fog: false, transparent: true,
        depthWrite: false, opacity: 0.85 + r() * 0.15,
      });
      const sprite = new THREE.Sprite(material);
      const w = 120 + r() * 170;
      sprite.scale.set(w, w * 0.5, 1);
      this.clouds.push({
        sprite,
        angle: (i / CLOUD_COUNT) * Math.PI * 2 + r() * 0.25,
        dist: 480 + r() * 480,
        height: 90 + r() * 210,
        drift: 0.004 + r() * 0.006,
      });
      this.group.add(sprite);
    }
    scene.add(this.group);
  }

  // Multiplies every cloud's colour, for sunsets and moonlit nights.
  setTint(color) {
    for (const c of this.clouds) c.sprite.material.color.copy(color);
  }

  update(dt, camera) {
    for (const c of this.clouds) {
      c.angle += c.drift * dt;
      c.sprite.position.set(Math.sin(c.angle) * c.dist, c.height, Math.cos(c.angle) * c.dist);
    }
    this.group.position.set(camera.position.x, camera.position.y, camera.position.z);
  }
}

const SMOKE_COUNT = 500;

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

// Tyre smoke when the car slides (on oil, swerving hard, or wrecked), smoke pouring off a
// wreck, and sparks off the guardrail. One Points cloud with per-particle colour.
export class Smoke {
  constructor(scene) {
    this.positions = new Float32Array(SMOKE_COUNT * 3).fill(-99999);
    this.colors = new Float32Array(SMOKE_COUNT * 3);
    this.base = new Float32Array(SMOKE_COUNT * 3);
    this.vel = new Float32Array(SMOKE_COUNT * 3);
    this.life = new Float32Array(SMOKE_COUNT);
    this.maxLife = new Float32Array(SMOKE_COUNT);
    this.spark = new Uint8Array(SMOKE_COUNT);
    this.next = 0;
    this.carry = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.7, map: puffTexture(), vertexColors: true, alphaTest: 0.02,
        transparent: true, opacity: 0.75, depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  puff(x, y, z, vx, vy, vz, life, color, spark = false) {
    const i = this.next;
    this.next = (this.next + 1) % SMOKE_COUNT;
    const o = i * 3;
    this.positions[o] = x;
    this.positions[o + 1] = y;
    this.positions[o + 2] = z;
    this.vel[o] = vx;
    this.vel[o + 1] = vy;
    this.vel[o + 2] = vz;
    this.base[o] = ((color >> 16) & 255) / 255;
    this.base[o + 1] = ((color >> 8) & 255) / 255;
    this.base[o + 2] = (color & 255) / 255;
    this.life[i] = this.maxLife[i] = life;
    this.spark[i] = spark ? 1 : 0;
  }

  // Smoke from the rear tyres while sliding, more the harder you slide.
  emit(body, dt) {
    if (!body.contact || body.speed < 3) return;
    const slide = body.onOil ? Math.max(body.slip, 4) : body.slip;
    if (slide < 2.5 && !body.crashed) return;
    this.carry += dt * Math.min(120, slide * (body.crashed ? 6 : 8));
    const fx = Math.sin(body.facing), fz = Math.cos(body.facing);
    while (this.carry >= 1) {
      this.carry -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.puff(
        body.pos.x - fx * 1.4 - fz * side * 0.8, body.pos.y + 0.2, body.pos.z - fz * 1.4 + fx * side * 0.8,
        body.vel.x * 0.3 + (Math.random() - 0.5) * 1.5, 0.6 + Math.random(), body.vel.z * 0.3 + (Math.random() - 0.5) * 1.5,
        0.7 + Math.random() * 0.5, body.onOil ? 0x55555c : 0xd8d8d8,
      );
    }
  }

  // Dark smoke curling off a wrecked car.
  wreck(pos, dt) {
    this.carry += dt * 30;
    while (this.carry >= 1) {
      this.carry -= 1;
      this.puff(pos.x + (Math.random() - 0.5) * 0.8, pos.y + 1.0, pos.z + (Math.random() - 0.5) * 0.8,
        (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8, 1.6 + Math.random(), 0x3a3a3e);
    }
  }

  // Smoke trailing off the bonnet of a damaged car: grey and thin at first, thick and dark
  // as it gets near the end. level: 0..1.
  damaged(body, level, dt) {
    this.hoodCarry = (this.hoodCarry || 0) + dt * (4 + level * 26);
    const fx = Math.sin(body.facing), fz = Math.cos(body.facing);
    const shade = Math.round(0xc8 - level * 0x90);
    const color = (shade << 16) | (shade << 8) | shade;
    while (this.hoodCarry >= 1) {
      this.hoodCarry -= 1;
      this.puff(body.pos.x + fx * 1.3 + (Math.random() - 0.5) * 0.6, body.pos.y + 0.9, body.pos.z + fz * 1.3,
        body.vel.x * 0.85 + (Math.random() - 0.5), 0.8 + Math.random() * 1.2, body.vel.z * 0.85 + (Math.random() - 0.5),
        0.35 + level * 0.45 + Math.random() * 0.25, color);
    }
  }

  // Steam and smoke pouring out of the bonnet once the engine has given up.
  steam(body, dt) {
    this.carry += dt * 24;
    const fx = Math.sin(body.facing), fz = Math.cos(body.facing);
    while (this.carry >= 1) {
      this.carry -= 1;
      this.puff(body.pos.x + fx * 1.3 + (Math.random() - 0.5) * 0.8, body.pos.y + 0.9, body.pos.z + fz * 1.3 + (Math.random() - 0.5) * 0.6,
        body.vel.x * 0.8 + (Math.random() - 0.5) * 0.8, 1.2 + Math.random() * 1.4, body.vel.z * 0.8 + (Math.random() - 0.5) * 0.8,
        1.4 + Math.random() * 0.8, Math.random() < 0.5 ? 0xe8e8e8 : 0x5a5a5e);
    }
  }

  sparks(hit, vel) {
    for (let k = 0; k < 14; k++) {
      this.puff(hit.x, hit.y, hit.z,
        vel.x * 0.4 - hit.side * Math.random() * 4, 1 + Math.random() * 3, vel.z * 0.7 + (Math.random() - 0.5) * 4,
        0.25 + Math.random() * 0.25, 0xffc040, true);
    }
  }

  update(dt) {
    for (let i = 0; i < SMOKE_COUNT; i++) {
      if (this.life[i] <= 0) continue;
      const o = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[o + 1] = -99999;
        continue;
      }
      if (this.spark[i]) this.vel[o + 1] -= 12 * dt;
      else {
        const drag = Math.exp(-dt * 1.5);
        this.vel[o] *= drag;
        this.vel[o + 2] *= drag;
      }
      this.positions[o] += this.vel[o] * dt;
      this.positions[o + 1] += this.vel[o + 1] * dt;
      this.positions[o + 2] += this.vel[o + 2] * dt;
      // fade by darkening toward the fog-free sky isn't possible per point, so fade colour toward white haze
      const k = this.life[i] / this.maxLife[i];
      const fade = this.spark[i] ? 1 : Math.min(1, k * 1.5);
      for (let c = 0; c < 3; c++) this.colors[o + c] = this.base[o + c] * fade + (1 - fade) * 0.85;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.positions.fill(-99999);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
