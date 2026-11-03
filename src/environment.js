// Time of day and weather. A day/night cycle recolours the sky, fog, lights and clouds
// (no extra lights: night is a bright moonlit blue so the road stays easy to read),
// and rain showers come and go. Rain is one Points object animated entirely in the vertex
// shader (each point drawn as a thin streak), wrapped in a box that travels with the camera.

import * as THREE from 'three';

export const DAY_LENGTH = 300; // seconds for a full day and night
const SNOW_DESKTOP = 5000;
const SNOW_MOBILE = 2500;
const SNOW_BOX = new THREE.Vector3(50, 30, 64);
const FLAKE_SIZE = 0.9; // metres: the height of a raindrop's streak
const FOG_NEAR = 90;
const FOG_FAR = 520;
const FOG_FAR_SNOW = 300; // visibility closes in during heavy rain

// Keyframes around the day; t = 0 is sunrise. Colours are hex, light values are intensities.
const KEYS = [
  { t: 0.0, top: 0x4a6fa8, mid: 0xf0b48a, horizon: 0xffd9b0, fog: 0xead8cc, sun: 0xffc890, sunI: 1.3, sky: 0xffe6d0, ground: 0xc0c4d6, hemiI: 1.45, cloud: 0xffe2cc, night: 0.15 },
  { t: 0.08, top: 0x5aa9e6, mid: 0xa9d6fa, horizon: 0xd4ecff, fog: 0xd4ecff, sun: 0xfff3dd, sunI: 2.0, sky: 0xe2f2ff, ground: 0xb4c6da, hemiI: 1.7, cloud: 0xffffff, night: 0 },
  { t: 0.42, top: 0x5aa9e6, mid: 0xa9d6fa, horizon: 0xd4ecff, fog: 0xd4ecff, sun: 0xfff3dd, sunI: 2.0, sky: 0xe2f2ff, ground: 0xb4c6da, hemiI: 1.7, cloud: 0xffffff, night: 0 },
  { t: 0.5, top: 0x3d5a9a, mid: 0xe89a7a, horizon: 0xffc79a, fog: 0xe6c6b8, sun: 0xff9a60, sunI: 1.2, sky: 0xffd8c0, ground: 0xb0a8be, hemiI: 1.35, cloud: 0xffc8a8, night: 0.2 },
  { t: 0.58, top: 0x0c1838, mid: 0x1f3466, horizon: 0x3a5488, fog: 0x34497a, sun: 0xa8c0ff, sunI: 0.75, sky: 0xa8bcf0, ground: 0x6f82a8, hemiI: 1.25, cloud: 0x7083ad, night: 1 },
  { t: 0.92, top: 0x0c1838, mid: 0x1f3466, horizon: 0x3a5488, fog: 0x34497a, sun: 0xa8c0ff, sunI: 0.75, sky: 0xa8bcf0, ground: 0x6f82a8, hemiI: 1.25, cloud: 0x7083ad, night: 1 },
];
// Sun and moon share one low arc across the sky ahead of the course (+z), kept in front of
// the chase camera so you can watch them cross: rising ahead-left (+x, "east"), highest
// straight ahead, setting ahead-right. The sun is up for the first half of the cycle and
// the moon for the second.
const ARC_SIDE = 0.8; // with ARC_AHEAD: rises and sets 45° either side of straight ahead
const ARC_AHEAD = 0.8;
const ARC_SWELL = 0.4; // swings a little further ahead at its height
const ARC_RISE = 0.344; // highest point about 16° above the horizon, just over the mountains
const SKY_DIST = 1400;
// The light follows the same sweep from left to right so shadows swing through the day,
// but it stays behind the player, high enough to keep the course front-lit and shadows short.
const LIGHT_ELEV_MIN = THREE.MathUtils.degToRad(32);
const LIGHT_ELEV_MAX = THREE.MathUtils.degToRad(58);
const HANDOVER = 0.04; // share of the cycle over which the light swaps between sun and moon

// Where a body sits on the arc; theta 0 = rising, PI/2 = highest, PI = setting.
function arc(theta, out) {
  const s = Math.sin(theta);
  return out.set(Math.cos(theta) * ARC_SIDE, s * ARC_RISE, ARC_AHEAD + s * ARC_SWELL).normalize();
}

// Light direction for a body at theta, clamped to the part of the arc where it is up.
function lightFor(theta, out) {
  const t = Math.min(Math.PI, Math.max(0, theta));
  const elev = LIGHT_ELEV_MIN + (LIGHT_ELEV_MAX - LIGHT_ELEV_MIN) * Math.sin(t);
  const hx = Math.cos(t) * 0.75, hz = -1; // swings left to right, always from behind
  const hl = Math.hypot(hx, hz);
  return out.set((hx / hl) * Math.cos(elev), Math.sin(elev), (hz / hl) * Math.cos(elev));
}

// Angle along the arc for a body that is up during [start, start + 0.5) of the cycle.
// Below the horizon it snaps to whichever end it is nearer, for the light handover.
function arcAngle(phase, start) {
  const u = (((phase - start) % 1) + 1) % 1;
  return u < 0.5 ? u * 2 * Math.PI : u < 0.75 ? Math.PI : 0;
}

const COLOR_FIELDS = ['top', 'mid', 'horizon', 'fog', 'sun', 'sky', 'ground', 'cloud'];
const NUM_FIELDS = ['sunI', 'hemiI', 'night'];
for (const k of KEYS) for (const f of COLOR_FIELDS) k[f] = new THREE.Color(k[f]);

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function glowTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  draw(c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SNOW_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uOrigin;
  uniform vec3 uBox;
  uniform float uScale;
  uniform float uIntensity;
  uniform vec2 uWind;
  uniform vec3 uCamVel;
  uniform float uAspect;
  attribute float aSeed;
  varying float vAlpha;
  varying vec2 vDir;
  varying float vLen;
  void main() {
    vec3 p = position;
    float fall = 16.0 + aSeed * 6.0;
    p.y -= uTime * fall;
    p.x += uTime * uWind.x;
    p.z += uTime * uWind.y;
    p = mod(p - uOrigin + uBox * 0.5, uBox) + uOrigin - uBox * 0.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // a drop's streak lies along its motion relative to the car: straight down when parked,
    // swept back and out from the road ahead at speed
    vec3 rel = vec3(uWind.x, -fall, uWind.y) - uCamVel;
    vec4 a = gl_Position;
    vec4 b = projectionMatrix * (mv + modelViewMatrix * vec4(rel * 0.05, 0.0));
    vec2 d = vec2(0.0, 1.0);
    if (a.w > 0.01 && b.w > 0.01) {
      vec2 s = (b.xy / b.w - a.xy / a.w) * vec2(uAspect, 1.0);
      if (dot(s, s) > 1e-10) d = normalize(s);
    }
    vDir = d;
    vLen = clamp(length(rel) / 22.0, 1.0, 2.5); // faster past, longer streak
    float dist = max(0.5, -mv.z);
    gl_PointSize = max(1.0, uScale * vLen * (0.6 + aSeed * 0.8) / dist);
    // aSeed doubles as the threshold, so light rain is just fewer drops
    vAlpha = step(aSeed, uIntensity) * clamp(1.6 - dist / (uBox.z * 0.5), 0.0, 1.0);
  }
`;
const SNOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying vec2 vDir;
  varying float vLen;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    c.y = -c.y;
    float along = dot(c, vDir);
    float across = dot(c, vec2(-vDir.y, vDir.x));
    if (abs(across) > 0.035 / vLen || vAlpha <= 0.0) discard;
    gl_FragColor = vec4(uColor, vAlpha * (1.0 - abs(along) * 2.0) * 0.55);
  }
`;

export class Environment {
  constructor(scene, { hemi, sun, clouds }) {
    this.scene = scene;
    this.hemi = hemi;
    this.sun = sun;
    this.clouds = clouds;
    this.clock = DAY_LENGTH * 0.12; // start in the morning
    this.p = {};
    for (const f of COLOR_FIELDS) this.p[f] = new THREE.Color();

    // sky gradient, redrawn a few times a second as the colours drift
    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 2;
    this.skyCanvas.height = 256;
    this.skyTex = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = this.skyTex;
    scene.fog = new THREE.Fog(0xd4ecff, FOG_NEAR, FOG_FAR);
    this.skyTimer = 0;

    // sky bodies: stars on a dome, and a sun and moon that travel the arc
    this.sky = new THREE.Group();
    const n = 900;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.random() * 0.92; // upper hemisphere only
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 1500, y * 1500, Math.sin(a) * r * 1500], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.moonMat = new THREE.SpriteMaterial({
      map: glowTexture((ctx) => {
        const g = ctx.createRadialGradient(64, 64, 14, 64, 64, 64);
        g.addColorStop(0, 'rgba(220,232,255,0.7)');
        g.addColorStop(1, 'rgba(220,232,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#f4f7ff';
        ctx.beginPath();
        ctx.arc(64, 64, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(170,184,214,0.5)'; // a few maria
        for (const [x, y, r] of [[57, 57, 6], [72, 68, 5], [60, 74, 4]]) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
      fog: false, transparent: true, opacity: 0, depthWrite: false,
    });
    this.moon = new THREE.Sprite(this.moonMat);
    this.moon.scale.setScalar(300);
    this.sunMat = new THREE.SpriteMaterial({
      map: glowTexture((ctx) => {
        const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,250,230,0.9)');
        g.addColorStop(0.35, 'rgba(255,236,190,0.35)');
        g.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = '#fffaf0';
        ctx.beginPath();
        ctx.arc(64, 64, 20, 0, Math.PI * 2);
        ctx.fill();
      }),
      fog: false, transparent: true, depthWrite: false,
    });
    this.sunSprite = new THREE.Sprite(this.sunMat);
    this.sunSprite.scale.setScalar(360);
    // drawn before the clouds (which don't write depth and are drawn at the default order 0), so the
    // sun and moon sit behind drifting clouds; stars go first of all. Hills and mountains write
    // depth, so they still hide all three as they rise and set behind the scenery
    this.stars.renderOrder = -2;
    this.moon.renderOrder = this.sunSprite.renderOrder = -1;
    this.sky.add(this.stars, this.moon, this.sunSprite);
    this.lightDir = lightFor(arcAngle(this.phase, 0), new THREE.Vector3()); // unit vector toward the sun or moon light
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();
    scene.add(this.sky);

    // rain
    const count = matchMedia('(pointer: coarse)').matches ? SNOW_MOBILE : SNOW_DESKTOP;
    const sp = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      sp.set([Math.random() * SNOW_BOX.x, Math.random() * SNOW_BOX.y, Math.random() * SNOW_BOX.z], i * 3);
      seeds[i] = Math.random();
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    snowGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.snowMat = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERT,
      fragmentShader: SNOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uBox: { value: SNOW_BOX.clone() },
        uScale: { value: 300 },
        uCamVel: { value: new THREE.Vector3() },
        uAspect: { value: 1 },
        uIntensity: { value: 0 },
        uWind: { value: new THREE.Vector2(1.2, -3.0) },
        uColor: { value: new THREE.Color(0xffffff) },
      },
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(snowGeo, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    scene.add(this.snow);

    // weather: alternate clear spells and showers of varying strength
    this.snowing = false;
    this.weatherTimer = 25; // first shower comes soon after starting
    this.snowTarget = 0;
    this.camPrev = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.tmpC = new THREE.Vector3();
    this.camSeen = false;
    this.snowLevel = 0;
    this.forced = null;
  }

  // 0..1 through the day, 0 = sunrise
  get phase() {
    return (this.clock / DAY_LENGTH) % 1;
  }

  setPhase(t) {
    this.clock = ((t % 1) + 1) % 1 * DAY_LENGTH;
  }

  // Debug/override: a number 0..1 pins the rain at that strength, null hands it back to the weather.
  setSnow(level) {
    this.forced = level;
  }

  palette(t) {
    let i = KEYS.length - 1;
    for (let k = 0; k < KEYS.length; k++) if (KEYS[k].t <= t) i = k;
    const a = KEYS[i], b = KEYS[(i + 1) % KEYS.length];
    const span = (b.t - a.t + 1) % 1 || 1;
    const u = smooth(((t - a.t + 1) % 1) / span);
    for (const f of COLOR_FIELDS) this.p[f].copy(a[f]).lerp(b[f], u);
    for (const f of NUM_FIELDS) this.p[f] = a[f] + (b[f] - a[f]) * u;
    return this.p;
  }

  updateWeather(dt) {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.snowing = !this.snowing;
      this.snowTarget = this.snowing ? 0.4 + Math.random() * 0.6 : 0;
      this.weatherTimer = this.snowing ? 30 + Math.random() * 40 : 40 + Math.random() * 50;
    }
    const target = this.forced ?? this.snowTarget;
    this.snowLevel += (target - this.snowLevel) * Math.min(1, dt * 0.25);
    if (Math.abs(target - this.snowLevel) < 0.002) this.snowLevel = target;
  }

  update(dt, camera, renderer) {
    this.clock += dt;
    this.updateWeather(dt);
    const p = this.palette(this.phase);
    const snow = this.snowLevel;

    // overcast while it rains: flatten the sky toward the horizon colour and soften the sun
    const grey = snow * 0.55;
    p.top.lerp(p.horizon, grey);
    p.mid.lerp(p.horizon, grey);
    this.hemi.color.copy(p.sky);
    this.hemi.groundColor.copy(p.ground);
    this.hemi.intensity = p.hemiI + snow * 0.15;
    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunI * (1 - snow * 0.4);
    this.scene.fog.color.copy(p.fog);
    this.scene.fog.far = FOG_FAR + (FOG_FAR_SNOW - FOG_FAR) * snow;
    if (this.clouds) this.clouds.setTint(p.cloud);

    this.skyTimer -= dt;
    if (this.skyTimer <= 0) {
      this.skyTimer = 0.2;
      const ctx = this.skyCanvas.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, `#${p.top.getHexString()}`);
      grad.addColorStop(0.55, `#${p.mid.getHexString()}`);
      grad.addColorStop(1, `#${p.horizon.getHexString()}`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 2, 256);
      this.skyTex.needsUpdate = true;
    }

    const clear = 1 - snow * 0.85; // sun, moon and stars hide behind the rain clouds
    this.dark = p.night; // how dark it is, for the headlights (rain clouds don't hide them)
    const night = p.night * clear;
    this.starMat.opacity = night;
    this.stars.visible = night > 0.01;
    this.sky.position.copy(camera.position);

    // sun and moon on their arcs, fading as they reach the horizon
    const phase = this.phase;
    const sunTheta = arcAngle(phase, 0), moonTheta = arcAngle(phase, 0.5);
    const horizonFade = (y) => Math.min(1, Math.max(0, (y + 0.01) / 0.06));
    arc(sunTheta, this.sunSprite.position).multiplyScalar(SKY_DIST);
    arc(moonTheta, this.moon.position).multiplyScalar(SKY_DIST);
    const sunUp = phase < 0.5 ? horizonFade(this.sunSprite.position.y / SKY_DIST) : 0;
    const moonUp = phase >= 0.5 ? horizonFade(this.moon.position.y / SKY_DIST) : 0;
    this.sunMat.opacity = sunUp * clear;
    this.sunMat.color.copy(p.sun);
    this.sunSprite.visible = this.sunMat.opacity > 0.01;
    this.moonMat.opacity = moonUp * clear;
    this.moon.visible = this.moonMat.opacity > 0.01;

    // light from whichever body is up, blended across sunrise and sunset
    const w = 0.5 + 0.5 * Math.max(-1, Math.min(1, Math.sin(phase * 2 * Math.PI) / Math.sin(HANDOVER * 2 * Math.PI)));
    lightFor(sunTheta, this.tmpA);
    lightFor(moonTheta, this.tmpB);
    this.lightDir.copy(this.tmpB).lerp(this.tmpA, w * w * (3 - 2 * w)).normalize();

    // how the camera is moving, so the rain's streaks can lean into it (smoothed; a jump is not a speed)
    if (this.camSeen && dt > 0) {
      const v = this.tmpC.copy(camera.position).sub(this.camPrev).divideScalar(dt);
      if (v.length() > 150) v.set(0, 0, 0);
      this.camVel.lerp(v, 1 - Math.exp(-dt * 10));
    }
    this.camPrev.copy(camera.position);
    this.camSeen = true;

    this.snow.visible = snow > 0.01;
    if (this.snow.visible) {
      const u = this.snowMat.uniforms;
      u.uTime.value = this.clock % 10000;
      u.uIntensity.value = snow;
      // centre the box a little ahead of the camera, where the car is heading
      camera.getWorldDirection(u.uOrigin.value);
      u.uOrigin.value.y = 0;
      u.uOrigin.value.multiplyScalar(14).add(camera.position);
      u.uCamVel.value.copy(this.camVel);
      u.uAspect.value = camera.aspect;
      // pixels per metre at 1 m: keeps flakes the same real size on any screen
      const h = renderer.domElement.height;
      u.uScale.value = (FLAKE_SIZE * h) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      u.uColor.value.setRGB(0.8, 0.86, 0.95).lerp(p.sky, 0.3 + 0.4 * p.night);
    }
  }
}
