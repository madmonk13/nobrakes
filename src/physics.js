// Point-mass car physics. Every step is ballistic (gravity); if that puts the car below the
// road it is pushed back to the surface and the into-ground velocity is removed, so hills,
// ramps and jumps all fall out naturally. On the ground the engine always pulls the car up
// toward its cruising speed: there are no brakes. Hitting things costs health, more the
// faster and harder the hit; at zero the car is done (it conks out, or wrecks if the last hit
// was a big one). Dropping into a collapsed bridge is always the end. Once it's over the car
// keeps sliding or rolling under physics but no longer drives.

import * as THREE from 'three';
import { RAIL_X } from './terrain.js';

export const GRAVITY = 12;
const CRASH_MU = 0.9; // sliding along after a wreck
const AIR_DRAG = 0.0008;
const TURN_RATE = 1.7; // rad/s at full steer, at low speed
const TURN_FALLOFF = 45; // the turn rate halves by this speed (m/s)
export const BOOST = 1.35; // nitro raises the cruising speed by this much...
const BOOST_TURN = 1.4; // ...and makes the steering this much twitchier
const NITRO_TIME = 5; // seconds of nitro in a full tank (it only burns while you hold it)
const AIR_TURN = 0.2;
const CENTER = 3; // how fast the wheel straightens up when you let go
const LAT_MAX = 13; // most sideways speed steering can give you
const MAX_YAW = 0.5;
const GRIP = 9; // how fast the tyres pull your velocity round to where the car points
const OIL_GRIP = 0.6;
const ACCEL = 10; // engine: most m/s² of pull...
const ACCEL_K = 1.2; // ...easing off as you near cruising speed
const COAST = 1.2; // above cruising speed (after a pad or the nitro) you slow this gently
const PAD_KICK = 5; // instant m/s from a turbo pad...
const PAD_SURGE = 0.6; // ...then this many seconds of extra push
const PAD_ACCEL = 12;
const RAIL_HARD = 9; // hitting the guardrail this fast sideways is a proper smash, not a scrape
// Damage: health starts at 100 and each hit takes HIT_DAMAGE × hardness × (impact speed − HIT_FREE),
// where the impact speed is how fast you were closing on it (m/s) along the direction you hit it.
export const MAX_HEALTH = 100;
const HIT_DAMAGE = 1.6;
const HIT_FREE = 2; // closing slower than this is just a nudge
const WRECK_HIT = 40; // a finishing hit this big wrecks the car; smaller ones just make it conk out
const CONK_DECEL = 7; // engine dead, rolling to a stop
// How much each kind of obstacle hurts, and for the light ones how much speed you keep
// as you smash straight through them
const HARDNESS = {
  barrier: 1.3, machine: 1.5, broken: 1.0, rock: 1.2, arrow: 0.8,
  barrel: 0.25, hay: 0.3, tyre: 0.35, crate: 0.45,
};
const SMASH_KEEP = { barrel: 0.93, hay: 0.88, tyre: 0.9, crate: 0.85 };
const VEHICLE_MASS = { sedan: 0.9, hatch: 0.85, suv: 1.0, pickup: 1.0, van: 1.05, boxtruck: 1.25, bus: 1.45, semi: 1.5 };
const RAIL_HARDNESS = 0.9;
const LANDING_FREE = 14; // landing harder than this (m/s downward) dents the suspension
const LANDING_DAMAGE = 2.5;
// what each rolling crosser does to you: damage (plus perSpeed per m/s you hit it at), the share
// of your speed you keep, and how hard it shoves you along and up
const CROSSER = {
  boulder: { damage: 55, perSpeed: 0.3, keep: 0.5, kick: 0.9, lift: 3 },
  log: { damage: 38, perSpeed: 0.25, keep: 0.55, kick: 0.8, lift: 3 },
  spool: { damage: 28, perSpeed: 0.2, keep: 0.6, kick: 0.8, lift: 2.5 },
  bale: { damage: 14, perSpeed: 0.1, keep: 0.78, kick: 0.5, lift: 1.5 },
  tumbleweed: { damage: 2, perSpeed: 0, keep: 0.97, kick: 0.05, lift: 0 },
};
export const CAR_HW = 0.92; // half width and half length of the car's footprint
export const CAR_HL = 2.15;
const WALL = 0.8; // ending a step this far inside the ground means you hit a wall: a gap's far side
const FALL_DEPTH = 2; // this far below a gap's rim there's no getting out
const MAX_X = 60;
const STUCK_SPEED = 2.5; // crawling slower than this while the engine's pulling means you're wedged...
const STUCK_GRACE = 1.5; // ...and after this many seconds of it...
const STUCK_DPS = 15; // ...the car takes this much damage a second, so a wedge can't go on for ever
const KNOCK_TIME = 0.6; // after a head-on knock the wheel doesn't straighten itself for this long

const tmpN = new THREE.Vector3();
const near = []; // scratch list of nearby obstacles
const mtv = { nx: 0, nz: 0, depth: 0 };

// Separating-axis test between two rotated rectangles on the road plane. Each is
// { x, z, hw, hl, rot }: half width across, half length along, and rot the yaw (its forward
// axis is (sin rot, cos rot), the same convention as the car's facing and three.js rotation.y).
// On overlap fills mtv with the unit normal to push box a out along (away from b) and how far.
export function boxOverlap(a, b, out) {
  const dx = b.x - a.x, dz = b.z - a.z;
  let best = Infinity;
  for (const box of [a, b]) {
    const s = Math.sin(box.rot), c = Math.cos(box.rot);
    for (const [lx, lz] of [[c, -s], [s, c]]) {
      // projected half sizes of both boxes on this axis
      const ra = a.hw * Math.abs(Math.cos(a.rot) * lx - Math.sin(a.rot) * lz) + a.hl * Math.abs(Math.sin(a.rot) * lx + Math.cos(a.rot) * lz);
      const rb = b.hw * Math.abs(Math.cos(b.rot) * lx - Math.sin(b.rot) * lz) + b.hl * Math.abs(Math.sin(b.rot) * lx + Math.cos(b.rot) * lz);
      const d = dx * lx + dz * lz;
      const overlap = ra + rb - Math.abs(d);
      if (overlap <= 0) return false;
      if (overlap < best) {
        best = overlap;
        const sg = d > 0 ? -1 : 1; // push a away from b
        out.nx = lx * sg;
        out.nz = lz * sg;
      }
    }
  }
  out.depth = best;
  return true;
}

export class CarBody {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.facing = 0; // yaw; forward = (sin, 0, cos)
    this.contact = true;
    this.airTime = 0;
    this.boosting = false;
    this.nitro = 1; // tank level, 0..1
    this.onOil = false;
    this.slip = 0; // sideways speed, for tyre smoke and squeal
    this.surge = 0;
    this.knocked = 0;
    this.stuck = 0; // seconds spent wedged
    this.lastPad = null;
    this.padHits = 0; // pads hit since the game last read it
    this.railHits = []; // { x, y, z, speed, side } guardrail scrapes since last read
    this.obstacleHits = []; // { obstacle, speed, x, z, vel } since last read
    this.vehicleHits = []; // { vehicle, speed, vel } since last read
    this.knockHits = []; // { knockable, vel } since last read
    this.crosserHits = []; // { ball, x, y, z, r, vel } since last read
    this.health = MAX_HEALTH;
    this.damageHits = []; // { amount, kind } since the game last read them
    this.crashed = null; // { kind, speed, detail, conked } once the run is over
    this.landing = null; // { impact, airTime } set on the step the car lands
    this.touchdown = false;
  }

  get speed() {
    return this.vel.length();
  }

  get airborne() {
    return this.airTime > 0.15;
  }

  // The car's footprint as a rotated box, for collisions
  get box() {
    const b = this._box || (this._box = { x: 0, z: 0, hw: CAR_HW, hl: CAR_HL, rot: 0 });
    b.x = this.pos.x;
    b.z = this.pos.z;
    b.rot = this.facing;
    return b;
  }

  // Half extents of the axis-aligned box round the car's footprint at its current heading
  // (what reaches out sideways to the guardrails).
  get extents() {
    const c = Math.abs(Math.cos(this.facing)), s = Math.abs(Math.sin(this.facing));
    return [CAR_HW * c + CAR_HL * s, CAR_HL * c + CAR_HW * s];
  }

  // conked: the engine gave up and the car rolls to a stop, rather than a full wreck
  crash(kind, detail = null, conked = false) {
    if (this.crashed) return;
    this.crashed = { kind, speed: this.vel.length(), detail, conked };
    this.health = 0;
    this.surge = 0;
    this.boosting = false;
  }

  // Take damage from a hit; at zero health the run is over.
  damage(amount, kind, detail = null) {
    if (this.crashed || amount <= 0) return;
    amount = Math.min(amount, this.health);
    this.health -= amount;
    this.damageHits.push({ amount, kind });
    if (this.health <= 0.01) {
      this.health = 0;
      this.crash(kind, detail, amount < WRECK_HIT);
    }
  }

  // Damage for closing on something at impact m/s
  static hitDamage(impact, hardness) {
    return HIT_DAMAGE * hardness * Math.max(0, impact - HIT_FREE);
  }

  // ctl: { steer: -1..1 (positive = right), boost: bool, cruise: m/s }
  step(dt, ctl, terrain) {
    const p = this.pos;
    const v = this.vel;
    this.landing = null;
    this.touchdown = false;
    this.boosting = !this.crashed && ctl.boost && this.nitro > 0;
    if (this.boosting) this.nitro = Math.max(0, this.nitro - dt / NITRO_TIME);

    v.y -= GRAVITY * dt;
    if (this.surge > 0) {
      this.surge = Math.max(0, this.surge - dt);
      v.x += Math.sin(this.facing) * PAD_ACCEL * dt;
      v.z += Math.cos(this.facing) * PAD_ACCEL * dt;
    }
    if (!this.contact) {
      const speed = v.length();
      if (speed > 0) v.multiplyScalar(1 - Math.min(speed, AIR_DRAG * speed * speed * dt) / speed);
      if (!this.crashed) this.turn(ctl.steer * TURN_RATE * AIR_TURN * dt);
    }

    const prevX = p.x, prevZ = p.z;
    p.addScaledVector(v, dt);
    this.checkRails(terrain);

    let ground = terrain.height(p.x, p.z);
    if (!this.crashed) {
      if (ground - p.y > WALL) {
        // slammed into the far wall of a gap: bounce back off it and drop
        p.x = prevX;
        p.z = prevZ;
        v.x *= -0.1;
        v.z *= -0.1;
        ground = terrain.height(p.x, p.z);
        this.crash('gap');
      } else if (terrain.gapAt(p.x, p.z) && p.y < terrain.surface(p.x, p.z) - FALL_DEPTH) {
        this.crash('gap');
      } else {
        const above = p.y - ground;
        this.checkObstacle(terrain, above);
        this.checkVehicle(terrain, above);
        this.checkKnockable(terrain, above);
        this.checkCrosser(terrain);
      }
    }

    const wasAirTime = this.airTime;
    if (p.y <= ground) {
      if (this.airborne) this.touchdown = true;
      p.y = ground;
      const n = terrain.normal(p.x, p.z, tmpN);
      const vn = v.dot(n);
      if (vn < 0) {
        v.addScaledVector(n, -vn);
        if (wasAirTime > 0.3) {
          const impact = -vn;
          if (impact > 12) v.multiplyScalar(Math.max(0.85, 1 - (impact - 12) * 0.012));
          this.landing = { impact, airTime: wasAirTime };
          if (impact > LANDING_FREE) this.damage((impact - LANDING_FREE) * LANDING_DAMAGE, 'landing');
        }
      }
      this.contact = true;
      this.airTime = 0;
      this.onOil = terrain.isOil(p.x, p.z);
      this.groundStep(dt, ctl, n);
      if (!this.crashed) {
        const pad = terrain.padAt(p.x, p.z);
        if (pad && pad !== this.lastPad) {
          v.x += Math.sin(this.facing) * PAD_KICK;
          v.z += Math.cos(this.facing) * PAD_KICK;
          this.surge = PAD_SURGE;
          this.padHits++;
        }
        this.lastPad = pad;
      }
    } else {
      this.contact = false;
      this.airTime += dt;
    }

    // Wedged against a pile-up with the engine pulling but going nowhere: there's no reversing, so
    // after a while the car takes the damage the stalemate deserves
    if (!this.crashed && this.contact && ctl.cruise > 8 && v.length() < STUCK_SPEED) this.stuck += dt;
    else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > STUCK_GRACE) this.damage(STUCK_DPS * dt, 'stuck');
  }

  // Positive dyaw turns right.
  turn(dyaw) {
    this.facing = THREE.MathUtils.clamp(this.facing - dyaw, -MAX_YAW, MAX_YAW);
  }

  // The guardrails hold you on the road and bounce you back with sparks; the harder you hit
  // them the more it hurts. There's no rail across a collapsed bridge, but by then you're flying.
  checkRails(terrain) {
    const p = this.pos, v = this.vel;
    const [ex] = this.extents;
    const lim = RAIL_X - 0.15 - ex;
    if (Math.abs(p.x) <= lim) return;
    if (terrain.gapAt(0, p.z) || terrain.gapAt(0, p.z - 3)) {
      if (Math.abs(p.x) > MAX_X) {
        p.x = Math.sign(p.x) * MAX_X;
        v.x = 0;
      }
      return;
    }
    const side = Math.sign(p.x);
    p.x = side * lim;
    const vin = v.x * side;
    if (vin <= 0) return;
    if (vin > RAIL_HARD) {
      v.x = -side * vin * 0.25;
      v.z *= 0.85;
    } else {
      v.x = -side * vin * 0.3;
      v.z *= 0.985;
    }
    if (!this.crashed) this.facing *= 0.4; // knocked straight
    this.damage(CarBody.hitDamage(vin, RAIL_HARDNESS), 'rail');
    this.railHits.push({ x: side * (RAIL_X - 0.1), y: p.y + 0.6, z: p.z, speed: vin, side });
  }

  // Push the car out of a box it overlaps (mtv from boxOverlap) and bounce it off. (ovx, ovz)
  // is the other thing's velocity. Returns how fast you were closing on it along the contact
  // normal, or 0 if you were already moving apart.
  pushOut(m, ovx = 0, ovz = 0) {
    const p = this.pos, v = this.vel;
    p.x += m.nx * m.depth;
    p.z += m.nz * m.depth;
    const rvx = v.x - ovx, rvz = v.z - ovz;
    const vn = rvx * m.nx + rvz * m.nz; // negative: closing
    if (vn >= 0) return 0;
    const closing = -vn;
    const headOn = Math.abs(m.nz) > 0.7; // hit its end rather than its side
    const e = headOn ? 0.15 : 0.25; // bounce
    let tx = rvx - vn * m.nx, tz = rvz - vn * m.nz; // sliding along the contact
    // a real impact scrubs speed off the slide; just leaning on it (the engine pushing you
    // into a wreck) barely does, or you could never slide out from behind one
    const keep = (headOn ? 0.5 : 0.75) + (headOn ? 0.5 : 0.25) * (1 - Math.min(1, closing / 3));
    tx *= keep;
    tz *= keep;
    v.x = ovx + tx - e * vn * m.nx;
    v.z = ovz + tz - e * vn * m.nz;
    if (headOn && closing > HIT_FREE) {
      // glance off toward its nearer side so you can get round it
      const side = Math.sign(m.nx) || Math.sign(tx) || -Math.sign(this.pos.x) || 1;
      v.x += side * Math.min(4, 1 + closing * 0.15);
      if (!this.crashed) {
        this.facing = THREE.MathUtils.clamp(side * 0.35, -MAX_YAW, MAX_YAW); // nose knocked aside...
        this.knocked = KNOCK_TIME; // ...and it stays that way long enough to slide clear
      }
    }
    return closing;
  }

  // Barriers, machinery, broken-down cars and rocks never move: you bounce off them. Barrels,
  // hay, crates and tyres you smash straight through, losing a little speed.
  checkObstacle(terrain, above) {
    const car = this.box;
    let o = null;
    for (const c of terrain.obstaclesNear(car.z, 10, near)) {
      if (above > c.h) continue;
      const ob = c.box || (c.box = { x: c.x, z: c.z, hw: c.hw, hl: c.hl, rot: c.rot || 0 });
      if (boxOverlap(car, ob, mtv)) {
        o = c;
        break;
      }
    }
    if (!o) return;
    const vel = this.vel.clone();
    const hardness = HARDNESS[o.kind] ?? 1;
    const keep = SMASH_KEEP[o.kind];
    let impact;
    if (keep) {
      o.h = -1; // gone: nothing left there to hit
      impact = Math.max(0, vel.z);
      this.vel.x *= keep;
      this.vel.z *= keep;
    } else {
      impact = this.pushOut(mtv);
      if (impact < HIT_FREE) return; // still leaning on it after the bounce
    }
    this.obstacleHits.push({ obstacle: o, speed: impact, x: this.pos.x, z: this.pos.z, vel });
    this.damage(CarBody.hitDamage(impact, hardness), o.kind, o.type === 'broken' ? o.vehicle : null);
  }

  checkVehicle(terrain, above) {
    if (!terrain.traffic) return;
    const car = this.box;
    let veh = null;
    for (const v of terrain.traffic.vehicles) {
      if (above > v.spec.H || Math.abs(v.z - car.z) > 12) continue;
      const vb = v.box || (v.box = { x: 0, z: 0, hw: v.spec.W / 2, hl: v.spec.L / 2, rot: 0 });
      vb.x = v.x;
      vb.z = v.z;
      vb.rot = v.yaw || 0;
      if (boxOverlap(car, vb, mtv)) {
        veh = v;
        break;
      }
    }
    if (!veh) return;
    const vel = this.vel.clone();
    const impact = this.pushOut(mtv, veh.drift || 0, veh.speed);
    if (impact < HIT_FREE) {
      // leaning on a wreck shoves it along rather than leaving you pinned against it
      if (veh.wrecked) {
        const m = VEHICLE_MASS[veh.type] ?? 1;
        veh.speed += Math.max(0, vel.z - veh.speed) / m;
        veh.drift = (veh.drift || 0) + (vel.x - this.vel.x) * 0.5 / m;
      }
      return;
    }
    this.vehicleHits.push({ vehicle: veh, speed: impact, vel });
    terrain.traffic.bump(veh, vel);
    this.damage(CarBody.hitDamage(impact, VEHICLE_MASS[veh.type] ?? 1), 'traffic', veh.type);
  }

  // Cones and warning triangles just go flying.
  checkKnockable(terrain, above) {
    const car = this.box;
    let k = null;
    for (const c of terrain.knockablesNear(car.z, 6, near)) {
      if (above > c.h) continue;
      if (boxOverlap(car, { x: c.x, z: c.z, hw: c.hw, hl: c.hl, rot: 0 }, mtv)) {
        k = c;
        break;
      }
    }
    if (!k) return;
    k.knocked = true;
    this.knockHits.push({ knockable: k, vel: this.vel.clone() });
  }

  // Something rolling across the road knocks you sideways: a boulder or a log hard, a hay bale
  // softly, and a tumbleweed hardly at all. Jump clear over it and you're fine.
  checkCrosser(terrain) {
    const p = this.pos, v = this.vel;
    // broad check round the car's middle, then the ball against the car's actual box
    const hit = terrain.crosserAt(p.x, p.y + 0.6, p.z, CAR_HL + 0.5);
    if (hit) {
      const s = Math.sin(this.facing), c = Math.cos(this.facing);
      const dx = hit.x - p.x, dz = hit.z - p.z;
      const lx = THREE.MathUtils.clamp(dx * c - dz * s, -CAR_HW, CAR_HW); // nearest point on the car, car frame
      const lz = THREE.MathUtils.clamp(dx * s + dz * c, -CAR_HL, CAR_HL);
      const ly = THREE.MathUtils.clamp(hit.y - p.y, 0, 1.2);
      const ex = dx - (lx * c + lz * s), ez = dz - (-lx * s + lz * c), ey = hit.y - p.y - ly;
      if (ex * ex + ey * ey + ez * ez > hit.r * 0.9 * (hit.r * 0.9)) return;
    }
    // one hit per pass, however long it takes to roll clear (they come round again later)
    if (!hit || terrain.clock - (hit.ball.hitAt ?? -99) < 3) return;
    hit.ball.hitAt = terrain.clock;
    this.crosserHits.push({ ball: hit.ball, x: hit.x, y: hit.y, z: hit.z, r: hit.r, vel: v.clone() });
    const kind = hit.ball.kind, k = CROSSER[kind];
    this.damage(k.damage + v.length() * k.perSpeed, kind);
    v.multiplyScalar(k.keep);
    v.x += hit.ball.dir * hit.ball.speed * k.kick;
    if (k.lift) v.y = Math.max(v.y, 0) + k.lift;
  }

  groundStep(dt, ctl, n) {
    const v = this.vel;
    const speed = v.length();

    if (this.crashed) {
      const decel = this.crashed.conked ? CONK_DECEL : CRASH_MU * GRAVITY * n.y;
      if (speed > 0) v.multiplyScalar(1 - Math.min(speed, decel * dt) / speed);
      this.slip = this.crashed.conked ? 0 : speed;
      return;
    }

    // steering turns the car; the tyres then pull the velocity round to match.
    // Let go and the wheel straightens itself.
    const rate = (TURN_RATE * (this.boosting ? BOOST_TURN : 1) * (this.onOil ? 0.5 : 1)) / (1 + speed / TURN_FALLOFF);
    this.knocked = Math.max(0, this.knocked - dt);
    if (this.knocked > 0) {
      // knocked aside by a head-on hit: you can steer, but it won't straighten on its own yet
      if (Math.abs(ctl.steer) >= 0.08) this.turn(ctl.steer * rate * dt);
    } else if (Math.abs(ctl.steer) < 0.08) this.facing *= Math.exp(-CENTER * dt);
    else this.turn(ctl.steer * rate * dt);
    const maxYaw = Math.min(MAX_YAW, Math.asin(Math.min(1, LAT_MAX / Math.max(speed, 1))));
    this.facing = THREE.MathUtils.clamp(this.facing, -maxYaw, maxYaw);

    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const rx = -fz, rz = fx; // right-hand side of the car
    let vf = v.x * fx + v.z * fz;
    let vl = v.x * rx + v.z * rz;
    vl *= Math.exp(-(this.onOil ? OIL_GRIP : GRIP) * dt);
    this.slip = Math.abs(vl);

    // the engine: always on, always pulling toward cruising speed (or past it on nitro)
    const target = ctl.cruise * (this.boosting ? BOOST : 1);
    const dv = target - vf;
    vf += dv > 0 ? Math.min(dv, Math.min(ACCEL, dv * ACCEL_K + 1) * dt) : Math.max(dv, -COAST * dt);
    v.x = fx * vf + rx * vl;
    v.z = fz * vf + rz * vl;
  }
}
