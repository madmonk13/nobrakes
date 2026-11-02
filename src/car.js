// The player's car, in one of several body styles picked in Settings (coupe, muscle car, hot
// hatch, pickup, supercar, roadster). Each body is an extruded side profile with a racing
// stripe; the wheels are separate so they can spin and the front pair can steer. Nesting:
// group (placed and oriented on the road by main.js) > spin (crash tumbles, pivoting
// at the car's middle) > tilt (body roll and squat) > body parts and wheels. As it takes
// damage the paint dulls, the front bumper sags and the spoiler (if it has one) works loose.
// Every style shares the same footprint, so the choice is only skin deep: the physics
// hitbox is the same for all of them.

import * as THREE from 'three';
import { DEFAULT_COLORS, DEFAULT_STYLE } from './save.js';
import { tailMat, headMat, glassMat } from './vehicles.js';
import { glowGeometry, glowMesh } from './nightlights.js';

export const CAR_L = 4.4;
export const CAR_W = 1.9;
const PIVOT_Y = 0.6;

// Side profiles (z forward, y up), extruded across the car's width. `cabin` gives the indexes
// of the cowl, the front and back of the roof, and the rear deck, which the windows are drawn
// from. bumper: [front y, front z, rear y, rear z]; head and tail: [y, z, tilt] of the lights;
// exhaust: [y, z]; wing: the spoiler's { y, z, w, strut } or null.
export const STYLES = {
  coupe: {
    name: 'Coupe',
    body: [[-2.2, 0.28], [2.2, 0.28], [2.26, 0.5], [2.16, 0.7], [0.95, 0.83], [0.15, 1.18], [-0.85, 1.21], [-1.75, 0.95], [-2.2, 0.9], [-2.26, 0.6]],
    cabin: [4, 5, 6, 7],
    wheel: { r: 0.34, front: 1.4, rear: -1.35 },
    bumper: [0.36, 2.22, 0.36, -2.24],
    head: [0.6, 2.215, -0.46],
    tail: [0.78, -2.23, 0],
    exhaust: [0.3, -2.3],
    wing: { y: 1.18, z: -1.98, w: CAR_W - 0.1, strut: 0.26 },
  },
  muscle: {
    name: 'Muscle',
    body: [[-2.25, 0.3], [2.25, 0.3], [2.3, 0.55], [2.25, 0.82], [0.7, 0.9], [-0.02, 1.25], [-0.75, 1.27], [-1.6, 1.0], [-2.25, 0.96], [-2.3, 0.6]],
    cabin: [4, 5, 6, 7],
    wheel: { r: 0.37, front: 1.45, rear: -1.35 },
    bumper: [0.38, 2.31, 0.38, -2.31],
    head: [0.68, 2.29, -0.15],
    tail: [0.8, -2.29, 0],
    exhaust: [0.32, -2.35],
    wing: { y: 1.0, z: -2.12, w: CAR_W - 0.06, strut: 0 }, // a ducktail on the boot lid
    extras: (add, m) => {
      // hood scoop
      add(new THREE.BoxGeometry(0.62, 0.12, 0.8).translate(0, 0.93, 1.35), m.paint);
      add(new THREE.BoxGeometry(0.5, 0.07, 0.04).translate(0, 0.95, 1.76), m.dark, false);
    },
  },
  hatch: {
    name: 'Hot Hatch',
    body: [[-2.05, 0.3], [2.1, 0.3], [2.18, 0.55], [2.1, 0.78], [1.0, 0.92], [0.2, 1.38], [-1.68, 1.38], [-2.0, 1.05], [-2.08, 0.9], [-2.1, 0.6]],
    cabin: [4, 5, 6, 7],
    wheel: { r: 0.33, front: 1.35, rear: -1.3 },
    bumper: [0.38, 2.12, 0.38, -2.1],
    head: [0.66, 2.13, -0.5],
    tail: [0.95, -2.06, 0],
    exhaust: [0.3, -2.14],
    wing: { y: 1.42, z: -1.78, w: CAR_W - 0.2, strut: 0 }, // a roof spoiler over the hatch
  },
  pickup: {
    name: 'Pickup',
    body: [[-2.25, 0.38], [2.25, 0.38], [2.3, 0.62], [2.22, 0.98], [1.15, 1.06], [0.55, 1.58], [-0.5, 1.6], [-0.62, 1.12], [-2.25, 1.12], [-2.3, 0.7]],
    cabin: [4, 5, 6, 7],
    wheel: { r: 0.42, front: 1.5, rear: -1.4 },
    bumper: [0.48, 2.32, 0.48, -2.32],
    head: [0.82, 2.27, -0.2],
    tail: [0.92, -2.3, 0],
    exhaust: [0.36, -2.36],
    wing: null,
    extras: (add, m) => {
      // a cover over the load bed, and a light bar on the cab roof
      add(new THREE.BoxGeometry(CAR_W - 0.16, 0.04, 1.5).translate(0, 1.14, -1.38), m.dark, false);
      add(new THREE.BoxGeometry(1.1, 0.1, 0.16).translate(0, 1.66, -0.05), m.dark, false);
      for (const sx of [-0.36, 0, 0.36]) add(new THREE.BoxGeometry(0.22, 0.07, 0.03).translate(sx, 1.66, 0.04), headMat, false);
    },
  },
  supercar: {
    name: 'Supercar',
    body: [[-2.25, 0.25], [2.25, 0.25], [2.32, 0.38], [2.0, 0.55], [0.55, 0.8], [-0.15, 1.06], [-0.95, 1.07], [-2.0, 0.88], [-2.3, 0.85], [-2.3, 0.5]],
    cabin: [4, 5, 6, 7],
    wheel: { r: 0.36, front: 1.42, rear: -1.42 },
    bumper: [0.3, 2.28, 0.32, -2.33],
    head: [0.5, 2.13, -1.0],
    tail: [0.72, -2.32, 0],
    exhaust: [0.34, -2.36],
    wing: { y: 1.12, z: -2.02, w: CAR_W, strut: 0.24 },
    extras: (add, m) => {
      // side intakes behind the doors
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.22, 0.6).translate(sx * (CAR_W / 2 + 0.005), 0.55, -0.85), m.dark, false);
    },
  },
  roadster: {
    name: 'Roadster',
    body: [[-2.15, 0.3], [2.15, 0.3], [2.22, 0.5], [2.12, 0.68], [0.75, 0.82], [-1.1, 0.84], [-1.8, 0.87], [-2.15, 0.84], [-2.2, 0.55]],
    cabin: null, // open top: just a windscreen, no roof
    wheel: { r: 0.33, front: 1.35, rear: -1.3 },
    bumper: [0.36, 2.17, 0.36, -2.18],
    head: [0.6, 2.17, -0.55],
    tail: [0.74, -2.18, 0],
    exhaust: [0.3, -2.25],
    wing: null,
    extras: (add, m) => {
      // cockpit, two seats with headrests, roll hoops and the windscreen
      add(new THREE.BoxGeometry(CAR_W - 0.34, 0.05, 1.5).translate(0, 0.83, -0.25), m.dark, false);
      for (const sx of [-0.4, 0.4]) {
        add(new THREE.BoxGeometry(0.5, 0.42, 0.14).rotateX(-0.2).translate(sx, 1.02, -0.72), m.dark);
        add(new THREE.BoxGeometry(0.3, 0.2, 0.1).translate(sx, 1.32, -0.78), m.dark, false);
        add(new THREE.TorusGeometry(0.24, 0.035, 5, 10, Math.PI).translate(sx, 1.06, -0.95), m.rims);
      }
      add(new THREE.BoxGeometry(CAR_W - 0.12, 0.42, 0.04).rotateX(-0.55).translate(0, 1.0, 0.66), glassMat, false);
      add(new THREE.BoxGeometry(CAR_W - 0.06, 0.05, 0.06).rotateX(-0.55).translate(0, 1.18, 0.55), m.dark, false);
    },
  },
};

// The windows: windscreen, side windows and rear glass, just proud of the body
function glassProfile(body, [ci, fi, bi, di]) {
  const [cowl, rf, rb, deck] = [body[ci], body[fi], body[bi], body[di]];
  const belt = cowl[1] + 0.02;
  return [
    [cowl[0] + 0.04, cowl[1] + 0.015], [rf[0] + 0.03, rf[1] + 0.02], [rf[0] - 0.09, rf[1] - 0.01],
    [rb[0] + 0.05, rb[1] - 0.03], [rb[0] - 0.01, rb[1] + 0.015], [deck[0] - 0.04, deck[1] + 0.01],
    [deck[0] + 0.15, belt], [cowl[0] - 0.15, belt],
  ];
}

function profileGeo(points, width, lift = 0) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y + lift) : s.moveTo(z, y + lift)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); // shape x -> +z, extrusion -> -x
  g.translate(width / 2, 0, 0);
  return g;
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

export function buildCar(styleName = DEFAULT_STYLE) {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  spin.position.y = PIVOT_Y;
  spin.rotation.order = 'YXZ';
  const tilt = new THREE.Group();
  tilt.position.y = -PIVOT_Y;
  group.add(spin);
  spin.add(tilt);

  const paint = new THREE.MeshPhongMaterial({ color: DEFAULT_COLORS.body, shininess: 60, specular: 0x444444, flatShading: true });
  const stripe = new THREE.MeshPhongMaterial({ color: DEFAULT_COLORS.stripe, shininess: 60, specular: 0x444444, flatShading: true });
  const rims = new THREE.MeshLambertMaterial({ color: DEFAULT_COLORS.rims });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1c20, flatShading: true });
  const mats = { paint, stripe, rims, dark };
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x66d9ff, transparent: true, opacity: 0.85, depthWrite: false });
  const flameCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });

  // the parts of the current body style, rebuilt whenever the style changes
  let style, bumper, wing, flames, wheels, wheelR;
  const geos = [];

  function build(name) {
    for (const g of geos) g.dispose();
    geos.length = 0;
    tilt.clear();
    style = STYLES[name] || STYLES[DEFAULT_STYLE];
    const S = style;
    const add = (geo, mat, shadow = true, parent = tilt) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      parent.add(m);
      geos.push(geo);
      return m;
    };
    add(profileGeo(S.body, CAR_W), paint);
    if (S.cabin) add(profileGeo(glassProfile(S.body, S.cabin), CAR_W + 0.02), glassMat, false);
    for (const sx of [-0.18, 0.18]) add(profileGeo(S.body, 0.2, 0.012).translate(sx, 0, 0), stripe, false);

    // front bumper hangs from its left end, so it can droop at the right when it's damaged
    const [byF, bzF, byR, bzR] = S.bumper;
    bumper = new THREE.Group();
    bumper.position.set(-(CAR_W + 0.04) / 2, byF, bzF);
    add(box(CAR_W + 0.04, 0.16, 0.12, (CAR_W + 0.04) / 2, 0, 0), dark, true, bumper);
    tilt.add(bumper);
    add(box(CAR_W + 0.04, 0.16, 0.12, 0, byR, bzR), dark, false);

    // spoiler, on a pivot at its left end so it can work loose
    wing = null;
    if (S.wing) {
      const { y, z, w, strut } = S.wing;
      wing = new THREE.Group();
      wing.position.set(-0.6, y, z);
      add(box(w, 0.06, 0.38, 0.6, 0, 0), stripe, true, wing);
      tilt.add(wing);
      if (strut) for (const sx of [-0.6, 0.6]) add(box(0.06, strut, 0.12, sx, y - strut / 2 - 0.02, z), dark, false);
    }

    const [hy, hz, ht] = S.head, [ty, tz, tt] = S.tail, [ey, ez] = S.exhaust;
    for (const sx of [-1, 1]) {
      // tilted to sit flush on the nose (rotate before placing, or it swings round the origin)
      add(new THREE.BoxGeometry(0.42, 0.11, 0.05).rotateX(ht).translate(sx * 0.62, hy, hz), headMat, false);
      add(new THREE.BoxGeometry(0.46, 0.12, 0.05).rotateX(tt).translate(sx * 0.62, ty, tz), tailMat, false);
      add(box(0.1, 0.08, 0.3, sx * 0.4, ey, ez), dark, false); // exhausts
    }
    S.extras?.(add, mats);

    // after dark: tail-light halos and a pool of headlight on the road ahead
    const glowGeo = glowGeometry({
      tails: [-1, 1].map((sx) => [sx * 0.62, ty, tz]),
      pool: { z: bzF - 0.5, len: 26, w: 6 },
    });
    geos.push(glowGeo);
    tilt.add(glowMesh(glowGeo));

    // boost flames out of the exhausts
    flames = [];
    for (const sx of [-1, 1]) {
      const f = new THREE.Group();
      add(new THREE.ConeGeometry(0.12, 0.9, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.45), flameMat, false, f);
      add(new THREE.ConeGeometry(0.06, 0.5, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.25), flameCoreMat, false, f);
      f.position.set(sx * 0.4, ey, ez - 0.15);
      f.visible = false;
      tilt.add(f);
      flames.push(f);
    }

    // wheels: a pivot (steers) holding a spinner (rolls) holding tyre and rim
    wheelR = S.wheel.r;
    const tyreGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.28, 14).rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(wheelR * 0.62, wheelR * 0.62, 0.3, 10).rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.31, wheelR * 1.15, 0.07);
    geos.push(tyreGeo, rimGeo, spokeGeo);
    wheels = [];
    for (const [sx, z, front] of [[-1, S.wheel.front, true], [1, S.wheel.front, true], [-1, S.wheel.rear, false], [1, S.wheel.rear, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (CAR_W / 2 - 0.12), wheelR, z);
      const spinner = new THREE.Group();
      pivot.add(spinner);
      const tyre = new THREE.Mesh(tyreGeo, dark);
      tyre.castShadow = true;
      spinner.add(tyre, new THREE.Mesh(rimGeo, rims));
      for (let k = 0; k < 2; k++) {
        const sp = new THREE.Mesh(spokeGeo, rims);
        sp.rotation.x = (k * Math.PI) / 2;
        spinner.add(sp);
      }
      tilt.add(pivot);
      wheels.push({ pivot, spinner, front });
    }
    const d = shownDamage;
    shownDamage = -1;
    showDamage(Math.max(0, d));
  }

  let roll = 0, squat = 0, steerAngle = 0, wheelAngle = 0;
  let crashYaw = 0, crashYawV = 0, crashRoll = 0, crashRollV = 0;
  let jolt = 0, joltSide = 1; // a shudder after each hit
  const basePaint = new THREE.Color(DEFAULT_COLORS.body), baseStripe = new THREE.Color(DEFAULT_COLORS.stripe);
  const grime = new THREE.Color(0x3b3833);
  let shownDamage = -1;
  function showDamage(d) {
    if (Math.abs(d - shownDamage) < 0.01) return;
    shownDamage = d;
    paint.color.copy(basePaint).lerp(grime, d * 0.45);
    stripe.color.copy(baseStripe).lerp(grime, d * 0.5);
    bumper.rotation.z = -Math.max(0, d - 0.3) * 0.35;
    if (wing) wing.rotation.z = -Math.max(0, d - 0.55) * 0.5;
  }

  build(styleName);

  return {
    group,
    setStyle(name) {
      build(name);
    },
    setColors(c) {
      basePaint.set(c.body);
      baseStripe.set(c.stripe);
      rims.color.set(c.rims);
      const d = shownDamage;
      shownDamage = -1;
      showDamage(Math.max(0, d));
    },
    // a hit: the body shudders
    dent() {
      jolt = 1;
      joltSide = Math.random() < 0.5 ? -1 : 1;
    },
    reset() {
      roll = squat = steerAngle = wheelAngle = jolt = 0;
      showDamage(0);
      crashYaw = crashYawV = crashRoll = crashRollV = 0;
      spin.rotation.set(0, 0, 0);
      tilt.rotation.set(0, 0, 0);
      for (const f of flames) f.visible = false;
    },
    // s: { steer, airborne, boosting, crashed, conked, speed, damage: 0..1 }
    animate(dt, s) {
      showDamage(s.damage);
      jolt = Math.max(0, jolt - dt * 4);
      const k = 1 - Math.exp(-dt * 10);
      wheelAngle += (s.speed / wheelR) * dt;
      steerAngle += (s.steer * 0.42 - steerAngle) * k;
      for (const w of wheels) {
        w.spinner.rotation.x = wheelAngle;
        w.pivot.rotation.y = w.front ? -steerAngle : 0;
      }
      // lean out of turns, squat under boost, and droop the suspension in the air
      const rollTarget = s.airborne || s.crashed ? 0 : s.steer * 0.06 * Math.min(1, s.speed / 20);
      roll += (rollTarget - roll) * k;
      squat += ((s.boosting ? 0.04 : 0) - squat) * k;
      const shudder = jolt * jolt * Math.sin(jolt * 40) * 0.06;
      tilt.rotation.z = roll + shudder * joltSide;
      tilt.rotation.x = -squat + shudder * 0.5;
      for (const w of wheels) w.pivot.position.y = wheelR - (s.airborne ? 0.08 : 0);

      for (const f of flames) {
        f.visible = s.boosting;
        if (s.boosting) f.scale.set(1, 1, 0.7 + Math.random() * 0.6);
      }

      if (s.crashed && s.conked) {
        // the engine died: it just rolls to a stop on its wheels
        spin.rotation.set(0, 0, 0);
        return;
      }
      if (s.crashed) {
        if (crashYawV === 0 && crashRollV === 0) {
          // first frame of the wreck: set it spinning, and rolling if it was fast
          crashYawV = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.min(6, s.speed * 0.15));
          crashRollV = s.speed > 25 ? (Math.random() < 0.5 ? -1 : 1) * Math.min(10, s.speed * 0.2) : 0.001;
        }
        crashYaw += crashYawV * dt;
        crashYawV *= Math.exp(-dt * 1.6);
        crashRoll += crashRollV * dt;
        crashRollV *= Math.exp(-dt * 1.4);
        // settle back on its wheels (or its roof) once the roll dies down
        if (Math.abs(crashRollV) < 1.5) {
          const rest = Math.round(crashRoll / Math.PI) * Math.PI;
          crashRoll += (rest - crashRoll) * Math.min(1, dt * 4);
        }
        spin.rotation.set(0, crashYaw, crashRoll);
        return;
      }
      spin.rotation.set(0, 0, 0);
    },
  };
}
