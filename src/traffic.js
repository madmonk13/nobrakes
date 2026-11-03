// Same-direction traffic. Vehicles spawn ahead of the player (always slower than you, so
// nothing ever comes up from behind), cruise in their lane, follow whoever is in front,
// signal and change lanes to get round slow vehicles and anything blocking the road, and
// stop if they can't. The player's car counts as traffic too, so once you've crashed (or been
// slowed right down) they brake behind you and steer round. Something rolling across the road
// that reaches a vehicle smashes into it and leaves it wrecked with its hazards on. Before a
// collapsed bridge they pull up short; any that are stopped well out of the player's way
// quietly leave.

import * as THREE from 'three';
import { LANES, LANE_W, laneX, laneOf } from './terrain.js';
import { CAR_L, CAR_W } from './car.js';
import { buildVehicle, randomPaint } from './vehicles.js';
import { setBeam } from './nightlights.js';

const AHEAD = 450; // keep traffic out to here in front of the player...
const BEHIND = 80; // ...and drop it once it's this far behind
const SPAWN_MIN = 360; // new vehicles appear this far ahead, out in the haze
const FOLLOW = 40; // start matching a vehicle in front within this gap
const LOOK = 80; // look this far ahead for things in the lane
const ACCEL = 3;
const BRAKE = 9;
const CHANGE_TIME = 1.8; // seconds to move over a lane
const SIGNAL = 0.9; // seconds of indicator before moving over
const EXIT_AHEAD = 200; // within this of a collapsed bridge, traffic leaves the road...
const EXIT_SEEN = 150; // ...as long as it's at least this far ahead of the player
const BEAM_SEEN = 200; // headlight beams are only kept up to date this far ahead of the player

// Rough mix of traffic, heavier vehicles getting commoner further on.
function pickType(r, z) {
  const heavy = Math.min(0.35, 0.12 + z / 30000);
  const k = r();
  if (k < heavy) return ['boxtruck', 'semi', 'bus', 'semi'][Math.floor(r() * 4)];
  return ['sedan', 'sedan', 'hatch', 'suv', 'suv', 'pickup', 'van'][Math.floor(r() * 7)];
}

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    this.vehicles = [];
    this.terrain = null;
    this.clock = 0;
    // the player's car as the traffic sees it, kept current by setPlayer()
    this.player = { x: 0, z: -1e9, speed: 0, lane: 0, target: 0, spec: { W: CAR_W, L: CAR_L } };
    this.obstacles = []; // scratch list for clearAhead()
    this.hits = []; // { vehicle, ball, x, y, z, r, vel }: crossers that hit a vehicle, for main.js to show
  }

  // The player's car, as a footprint the traffic can follow and steer round: wider when it's
  // slewed sideways in a wreck.
  setPlayer(pos, facing, speed) {
    const p = this.player, s = Math.abs(Math.sin(facing)), c = Math.abs(Math.cos(facing));
    p.x = pos.x;
    p.z = pos.z;
    p.speed = speed;
    p.lane = p.target = laneOf(pos.x);
    p.spec.W = s * CAR_L + c * CAR_W;
    p.spec.L = c * CAR_L + s * CAR_W;
  }

  reset(terrain) {
    for (const v of this.vehicles) this.scene.remove(v.mesh);
    this.vehicles.length = 0;
    this.hits.length = 0;
    this.player.z = -1e9;
    this.terrain = terrain;
    // a light scattering to start with, none right on top of the start line
    for (let z = 50; z < AHEAD; z += 12) this.trySpawn(z, 0, 0.45);
  }

  // How many vehicles per 100 m, rising with distance.
  density(pz) {
    return Math.min(5.5, 1.4 + Math.max(0, pz) / 1400);
  }

  // Desired cruising speeds rise slowly, but stay well under the player's.
  speedFor(type, pz) {
    const base = 14 + Math.min(10, Math.max(0, pz) / 700);
    const heavy = type === 'semi' || type === 'bus' || type === 'boxtruck';
    return base + Math.random() * 7 - (heavy ? 3 : 0);
  }

  trySpawn(z, pz, chance = 1) {
    if (Math.random() > chance) return false;
    const t = this.terrain;
    if (t.nearGap(z, 80) || t.nextGap(z, EXIT_AHEAD + 100)) return false;
    const type = pickType(Math.random, pz);
    const spec = buildVehicle.spec(type);
    // never fill more than five of the eight lanes in one stretch, so there's always a way through
    const busy = new Set();
    for (const o of this.vehicles) if (Math.abs(o.z - z) < 30) busy.add(o.lane).add(o.target);
    if (busy.size >= 5) return false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const lane = Math.floor(Math.random() * LANES);
      if (busy.has(lane) && attempt < 5) continue;
      const x = laneX(lane);
      const clear = !this.vehicles.some((o) => (o.lane === lane || o.target === lane) && Math.abs(o.z - z) < (o.spec.L + spec.L) / 2 + 14);
      if (!clear) continue;
      if (t.blockedAhead(x - 1.4, x + 1.4, z - spec.L / 2 - 8, z + spec.L / 2 + 30) !== Infinity) continue;
      const { group, blinkers, beam } = buildVehicle(type, randomPaint(Math.random, type));
      group.rotation.order = 'YXZ';
      this.scene.add(group);
      const desired = this.speedFor(type, pz);
      this.vehicles.push({
        type, spec, mesh: group, blinkers, beam, x, z, lane, target: lane, fromX: x, laneT: 1, signal: 0,
        speed: desired, desired, wrecked: false, spin: 0, yaw: 0, passed: false, nextThink: Math.random(),
      });
      return true;
    }
    return false;
  }

  // lit: it's dark, so headlight beams show and should stop short of whatever is in front
  update(dt, pz, lit = false) {
    this.clock += dt;
    const t = this.terrain;
    // spawn to keep the density up, and drop what's fallen behind
    const want = (this.density(pz) * (AHEAD + BEHIND)) / 100;
    if (this.vehicles.length < want) this.trySpawn(pz + SPAWN_MIN + Math.random() * (AHEAD - SPAWN_MIN), pz);
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      // Nearing a collapsed bridge, traffic takes the detour while it's still well ahead of you;
      // anything you've nearly caught up with stops short instead.
      const gap = t.nextGap(v.z, EXIT_AHEAD);
      const exiting = gap && gap.z0 - v.z < EXIT_AHEAD && v.z - pz > EXIT_SEEN;
      const stuckAway = v.speed < 0.5 && !v.wrecked && v.z - pz > EXIT_SEEN;
      if (v.z < pz - BEHIND || exiting || stuckAway) {
        this.scene.remove(v.mesh);
        this.vehicles.splice(i, 1);
      }
    }

    const blink = Math.sin(this.clock * 9) > 0;
    for (const v of this.vehicles) {
      if (v.wrecked) {
        // knocked spinning by the player: slide to a stop
        v.speed = Math.max(0, v.speed - 8 * dt);
        v.spin *= Math.exp(-dt * 1.5);
        v.yaw += v.spin * dt;
        v.z += v.speed * dt;
        v.x += v.drift * dt;
        v.drift *= Math.exp(-dt * 2);
      } else {
        this.drive(v, dt);
      }
      const h = t.profile(v.z);
      const slope = (t.profile(v.z + 2) - t.profile(v.z - 2)) / 4;
      v.mesh.position.set(v.x, h, v.z);
      v.mesh.rotation.set(-Math.atan(slope), v.yaw, 0);
      this.checkCrosser(v, h);
      if (lit && v.beam && Math.abs(v.z - pz) < BEAM_SEEN) {
        const hw = v.spec.W / 2 + 0.3, front = v.z + v.spec.L / 2 + 0.3;
        setBeam(v.beam, this.clearAhead(v.x - hw, v.x + hw, front, v.beam.userData.len + 2, v), dt);
      }
      const signalling = !v.wrecked && v.target !== v.lane;
      const dir = Math.sign(laneX(v.target) - laneX(v.lane));
      if (v.blinkers[0]) v.blinkers[0].visible = (v.hazards || (signalling && dir > 0)) && blink;
      if (v.blinkers[1]) v.blinkers[1].visible = (v.hazards || (signalling && dir < 0)) && blink;
    }
  }

  // Something rolling across the road reached v: it smashes into the side of it and breaks up,
  // and v is knocked aside and spun, done for. A tumbleweed just blows on past.
  checkCrosser(v, h) {
    const t = this.terrain, hw = v.spec.W / 2, hl = v.spec.L / 2;
    const hit = t.crosserAt(v.x, h + v.spec.H / 2, v.z, Math.hypot(hw, hl));
    if (!hit || hit.ball.kind === 'tumbleweed') return;
    // the ball against the vehicle's actual (turned) box
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw);
    const dx = hit.x - v.x, dz = hit.z - v.z;
    const lx = Math.max(-hw, Math.min(hw, dx * c - dz * s));
    const lz = Math.max(-hl, Math.min(hl, dx * s + dz * c));
    const ex = dx - (lx * c + lz * s), ez = dz - (-lx * s + lz * c);
    if (ex * ex + ez * ez > hit.r * 0.9 * (hit.r * 0.9)) return;
    const b = hit.ball;
    b.gone = true;
    this.hits.push({ vehicle: v, ball: b, x: hit.x, y: hit.y, z: hit.z, r: hit.r, vel: new THREE.Vector3(-b.dir * b.speed, 0, v.speed) });
    const heavy = v.type === 'semi' || v.type === 'bus' || v.type === 'boxtruck';
    const k = (b.kind === 'boulder' || b.kind === 'log' ? 1 : 0.6) * (heavy ? 0.35 : 1);
    v.wrecked = true;
    v.hazards = true;
    v.speed *= heavy ? 0.7 : 0.45;
    v.drift = b.dir * b.speed * 0.5 * k;
    v.spin = (Math.random() < 0.5 ? -1 : 1) * (0.6 + 1.6 * k);
  }

  // How far ahead of z = front the road is clear between x0 and x1, up to max: the gap to the
  // nearest vehicle (the player's car too) or roadside obstacle. Headlight beams stop there.
  clearAhead(x0, x1, front, max, self = null) {
    let free = max;
    for (let i = 0; i <= this.vehicles.length; i++) {
      const o = i < this.vehicles.length ? this.vehicles[i] : this.player;
      if (o === self || o.z + o.spec.L / 2 < front) continue;
      const hw = o.spec.W / 2;
      if (o.x + hw < x0 || o.x - hw > x1) continue;
      free = Math.min(free, Math.max(0, o.z - o.spec.L / 2 - front));
    }
    if (this.terrain) {
      for (const o of this.terrain.obstaclesNear(front + max / 2, max / 2 + 8, this.obstacles)) {
        if (o.z + o.hl < front || o.x + o.hw < x0 || o.x - o.hw > x1) continue;
        free = Math.min(free, Math.max(0, o.z - o.hl - front));
      }
    }
    return free;
  }

  // The nearest vehicle in front overlapping x-range [x0, x1], and the gap to it.
  leadOf(v, x0, x1) {
    let lead = null, gap = Infinity;
    const front = v.z + v.spec.L / 2;
    for (let i = 0; i <= this.vehicles.length; i++) {
      const o = i < this.vehicles.length ? this.vehicles[i] : this.player;
      if (o === v || o.z <= v.z) continue;
      const hw = o.spec.W / 2;
      if (o.x + hw < x0 || o.x - hw > x1) continue;
      const g = o.z - o.spec.L / 2 - front;
      if (g < gap) {
        gap = g;
        lead = o;
      }
    }
    return { lead, gap };
  }

  laneFree(v, lane, ahead) {
    const x = laneX(lane);
    for (let i = 0; i <= this.vehicles.length; i++) {
      const o = i < this.vehicles.length ? this.vehicles[i] : this.player;
      if (o === v) continue;
      if (o.lane !== lane && o.target !== lane && Math.abs(o.x - x) > LANE_W * 0.8) continue;
      if (o.z > v.z - v.spec.L / 2 - o.spec.L / 2 - 10 && o.z < v.z + v.spec.L / 2 + o.spec.L / 2 + 16) return false;
    }
    return this.terrain.blockedAhead(x - 1.3, x + 1.3, v.z - v.spec.L / 2 - 4, v.z + ahead) === Infinity;
  }

  drive(v, dt) {
    const hw = v.spec.W / 2 + 0.2;
    const front = v.z + v.spec.L / 2;
    // while moving over, watch both lanes
    const x0 = Math.min(v.x, laneX(v.target)) - hw, x1 = Math.max(v.x, laneX(v.target)) + hw;
    const { lead, gap } = this.leadOf(v, x0, x1);
    const blockZ = this.terrain.blockedAhead(x0, x1, front - 2, front + LOOK);
    const room = blockZ - front;

    let want = v.desired;
    if (lead && gap < FOLLOW) want = Math.min(want, lead.speed + (gap - 8) * 0.45);
    if (room < LOOK) want = Math.min(want, Math.max(0, (room - 5) * 0.5));
    want = Math.max(0, want);
    v.speed += Math.max(-BRAKE * dt, Math.min(ACCEL * dt, want - v.speed));

    // decide on a lane change now and then: something in the way, someone slow ahead, or just because
    v.nextThink -= dt;
    if (v.target === v.lane && v.nextThink <= 0) {
      v.nextThink = 0.3 + Math.random() * 0.4;
      const urgent = room < LOOK;
      const slowLead = lead && gap < 30 && lead.speed < v.desired - 2;
      if (urgent || slowLead || Math.random() < 0.015) {
        const options = [v.lane - 1, v.lane + 1].filter((l) => l >= 0 && l < LANES);
        if (Math.random() < 0.5) options.reverse();
        for (const l of options) {
          if (!this.laneFree(v, l, urgent ? LOOK : 90)) continue;
          v.target = l;
          v.fromX = v.x;
          v.laneT = 0;
          v.signal = urgent && room < 35 ? 0 : SIGNAL;
          break;
        }
      }
    }
    if (v.target !== v.lane) {
      if (v.signal > 0) v.signal -= dt;
      else {
        v.laneT = Math.min(1, v.laneT + dt / CHANGE_TIME);
        const k = v.laneT * v.laneT * (3 - 2 * v.laneT);
        const tx = laneX(v.target);
        const nx = v.fromX + (tx - v.fromX) * k;
        v.yaw = v.speed > 1 ? Math.atan2(nx - v.x, v.speed * dt) : 0;
        v.x = nx;
        if (v.laneT >= 1) {
          v.lane = v.target;
          v.yaw = 0;
        }
      }
    }
    v.z += v.speed * dt;
  }

  // The vehicle a car footprint (half-size ex, ez) at (x, z) overlaps, unless flying over it.
  vehicleAt(x, z, ex, ez, heightAbove) {
    for (const v of this.vehicles) {
      if (heightAbove > v.spec.H) continue;
      if (Math.abs(x - v.x) < ex + v.spec.W / 2 && Math.abs(z - v.z) < ez + v.spec.L / 2) return v;
    }
    return null;
  }

  // The player slammed into v at velocity vel: it gets shoved along and spun.
  bump(v, vel) {
    v.wrecked = true;
    const push = Math.max(0, vel.z - v.speed);
    const mass = v.type === 'semi' || v.type === 'bus' ? 0.15 : v.type === 'boxtruck' ? 0.3 : 0.6;
    v.speed += push * mass;
    v.drift = vel.x * mass * 0.6 + (Math.random() - 0.5) * 2;
    v.spin = (Math.random() < 0.5 ? -1 : 1) * Math.min(3, push * mass * 0.15 + 0.4);
    for (const b of v.blinkers) if (b) b.visible = false;
  }
}
