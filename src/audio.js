// Synthesized sound effects (Web Audio, no sample files). Continuous layers for the engine,
// road roar, tyre squeal, wind and the nitro follow the car each frame; everything else is a
// one-shot. Browsers only allow audio after a user gesture, so the context starts on the first
// pointer or key press.

const MUTE_KEY = 'nobrakes.muted';
const COIN_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19]; // pentatonic climb for coin streaks
const GEAR = 14; // m/s per gear, for the engine note

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = loadMuted();
    this.combo = 0;
    this.lastCoin = 0;
    const unlock = () => this.unlock();
    // iOS Safari only unlocks audio on some gesture types, so listen to all of them
    for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
      window.addEventListener(type, unlock, { capture: true });
    }
  }

  unlock() {
    if (this.ctx) {
      // iOS reports 'interrupted' after a call or app switch, not just 'suspended'
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      this.kick();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Game sound, not media: "ambient" keeps the phone from showing a lock-screen / notification
    // player for the page and lets the player's own music carry on (Safari 16.4+). The cost is
    // that the iPhone's silent switch mutes the game. Nothing here may play an <audio> element,
    // since that is what phones treat as music or a podcast.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch {}
    const ctx = (this.ctx = new AC());
    // go quiet whenever the page isn't on screen (locked phone, another app), and carry on when it returns
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') ctx.suspend().catch(() => {});
      else if (ctx.state !== 'running') ctx.resume().catch(() => {});
    });

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);

    // two seconds of white noise, shared by every noisy sound
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.wind = this.loop('lowpass', 300, 0.5);
    this.road = this.loop('lowpass', 500, 0.5);
    this.squeal = this.loop('bandpass', 2200, 8);
    this.rocket = this.loop('lowpass', 380, 0.9);
    this.rumble = ctx.createOscillator();
    this.rumble.type = 'sawtooth';
    this.rumble.frequency.value = 52;
    const rumbleLp = ctx.createBiquadFilter();
    rumbleLp.type = 'lowpass';
    rumbleLp.frequency.value = 160;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumble.connect(rumbleLp).connect(this.rumbleGain).connect(this.master);
    this.rumble.start();

    // engine: two oscillators through a lowpass, pitched by revs through the gears
    this.engineLp = ctx.createBiquadFilter();
    this.engineLp.type = 'lowpass';
    this.engineLp.frequency.value = 600;
    this.engineLp.Q.value = 2;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineLp.connect(this.engineGain).connect(this.master);
    this.engine = [['sawtooth', 1], ['square', 0.5]].map(([type, mult]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 60 * mult;
      o.connect(this.engineLp);
      o.start();
      return { o, mult };
    });
    this.kick();
  }

  // Play a one-sample silent buffer inside the gesture; older iOS only truly starts
  // the context once something has been scheduled during a user activation.
  kick() {
    const b = this.ctx.createBufferSource();
    b.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    b.connect(this.ctx.destination);
    b.start(0);
  }

  // A looping noise source through a filter into its own gain (starts silent).
  loop(type, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(0, Math.random() * 1.5);
    return { filter, gain };
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* preference just won't persist */
    }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  get ready() {
    return this.ctx && this.ctx.state === 'running';
  }

  // ---------- continuous ----------

  // s: { running, idle, speed, contact, slip, airborne, boosting, health: 0..1 }
  update(s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const speed = s.running ? s.speed : 0;
    const k = Math.min(1, speed / 60);

    // wind rush, swelling with speed and a touch stronger in the air
    this.wind.gain.gain.setTargetAtTime(Math.pow(k, 1.4) * (s.airborne ? 0.2 : 0.12), t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(180 + speed * 9, t, 0.2);

    // tyres on asphalt: a low roar, silent in the air
    const onGround = s.running && s.contact;
    this.road.gain.gain.setTargetAtTime(onGround ? Math.min(1, speed / 25) * 0.07 : 0, t, 0.05);
    this.road.filter.frequency.setTargetAtTime(300 + speed * 8, t, 0.08);

    // squeal while sliding sideways
    const sq = onGround ? Math.min(1, Math.max(0, s.slip - 2.5) / 5) : 0;
    this.squeal.gain.gain.setTargetAtTime(sq * 0.1, t, 0.04);
    this.squeal.filter.frequency.setTargetAtTime(1900 + Math.random() * 500, t, 0.02);

    // engine revs climb through each gear and drop on the shift; it idles before the start
    const g = Math.floor(speed / GEAR);
    const rev = speed > 0 ? 0.3 + 0.7 * ((speed % GEAR) / GEAR) * Math.max(0.5, 1 - g * 0.04) : 0.15;
    const f = 42 + rev * 95 + g * 6 + (s.boosting ? 15 : 0);
    for (const e of this.engine) e.o.frequency.setTargetAtTime(f * e.mult, t, 0.05);
    this.engineLp.frequency.setTargetAtTime(400 + rev * 900 + (s.boosting ? 500 : 0), t, 0.08);
    let vol = s.running ? (0.08 + 0.05 * rev) * (s.airborne ? 0.8 : 1) : s.idle ? 0.04 : 0;
    // a badly damaged engine misfires: the note stumbles now and then, more as it gets worse
    const health = s.health ?? 1;
    if (s.running && health < 0.4 && Math.random() < (0.4 - health) * 0.25) vol *= 0.25;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.08);

    const boost = s.running && s.boosting;
    this.rocket.gain.gain.setTargetAtTime(boost ? 0.35 : 0, t, 0.06);
    this.rumbleGain.gain.setTargetAtTime(boost ? 0.14 : 0, t, 0.06);
  }

  // ---------- one-shot helpers ----------

  tone(freq, { type = 'sine', at = 0, dur = 0.2, vol = 0.2, attack = 0.004, slideTo = null, out = this.master } = {}) {
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  burst({ type = 'bandpass', freq = 1000, slideTo = null, q = 1, at = 0, dur = 0.3, vol = 0.3, attack = 0.01 } = {}) {
    const t = this.ctx.currentTime + at;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  // ---------- events ----------

  // Metallic clink: a bright fundamental plus inharmonic bell partials that die fast.
  // Coins picked up in quick succession climb a pentatonic scale.
  coin() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this.combo = now - this.lastCoin < 0.6 ? Math.min(this.combo + 1, COIN_STEPS.length - 1) : 0;
    this.lastCoin = now;
    const f = 1250 * Math.pow(2, COIN_STEPS[this.combo] / 12);
    this.tone(f, { type: 'triangle', dur: 0.32, vol: 0.16 });
    this.tone(f * 2.76, { dur: 0.16, vol: 0.07 });
    this.tone(f * 5.4, { dur: 0.07, vol: 0.04 });
    this.tone(f * 1.5, { type: 'triangle', at: 0.05, dur: 0.22, vol: 0.06 });
  }

  // Start countdown: a short beep for each number, a higher one and a whoosh for Go.
  count(go) {
    if (!this.ready) return;
    this.tone(go ? 1320 : 660, { type: 'square', dur: go ? 0.35 : 0.15, vol: 0.08 });
    if (go) this.burst({ freq: 600, slideTo: 2600, q: 0.8, dur: 0.45, vol: 0.2, attack: 0.03 });
  }

  // Wreck: a heavy metal crunch, scraping and tinkling glass.
  crash(speed = 30) {
    if (!this.ready) return;
    const k = Math.min(1, speed / 40);
    this.tone(70, { dur: 0.4, vol: 0.5, slideTo: 30 });
    this.burst({ type: 'lowpass', freq: 2600, slideTo: 400, q: 0.8, dur: 0.5, vol: 0.45 });
    this.burst({ freq: 900, q: 6, dur: 0.6, vol: 0.12 + 0.12 * k, slideTo: 500 });
    for (let i = 0; i < 4; i++) this.tone(300 + Math.random() * 400, { type: 'square', at: 0.02 + i * 0.03, dur: 0.15, vol: 0.04, slideTo: 120 });
    for (let i = 0; i < 7; i++) this.tone(3000 + Math.random() * 3500, { at: 0.12 + Math.random() * 0.5, dur: 0.08, vol: 0.035 });
  }

  // Off the edge of a collapsed bridge: a long falling whistle, then a distant splash.
  fall() {
    if (!this.ready) return;
    this.tone(1200, { type: 'triangle', dur: 1.4, vol: 0.12, slideTo: 180 });
    this.burst({ freq: 900, slideTo: 200, q: 1, dur: 1.2, vol: 0.12, attack: 0.1 });
    this.tone(70, { at: 1.5, dur: 0.4, vol: 0.25, slideTo: 35 });
    this.burst({ type: 'lowpass', freq: 1400, slideTo: 300, q: 0.5, at: 1.5, dur: 0.9, vol: 0.3 });
  }

  // Turbo pad: rising zip and a quick arpeggio.
  pad() {
    if (!this.ready) return;
    this.burst({ freq: 500, slideTo: 4000, q: 1.2, dur: 0.4, vol: 0.3, attack: 0.02 });
    this.tone(300, { type: 'square', dur: 0.28, vol: 0.06, slideTo: 1200 });
    [660, 880, 1320].forEach((f, i) => this.tone(f, { type: 'triangle', at: 0.04 + i * 0.05, dur: 0.14, vol: 0.09 }));
  }

  // Landing: a suspension thump, bigger for harder landings.
  landing(impact) {
    if (!this.ready) return;
    const k = Math.min(1, impact / 20);
    this.tone(95, { dur: 0.22, vol: 0.12 + 0.3 * k, slideTo: 40 });
    this.burst({ type: 'lowpass', freq: 700 + 700 * k, q: 0.5, dur: 0.2 + 0.2 * k, vol: 0.12 + 0.25 * k });
  }

  // Bonus: two-note chime.
  chime() {
    if (!this.ready) return;
    this.tone(1046, { type: 'triangle', dur: 0.25, vol: 0.12 });
    this.tone(1568, { type: 'triangle', at: 0.09, dur: 0.35, vol: 0.12 });
  }

  // Run over: a little fanfare for a new best, otherwise a gentle sign-off.
  runEnd(newBest) {
    if (!this.ready) return;
    if (newBest) {
      [523, 659, 784, 1046].forEach((f, i) =>
        this.tone(f, { type: 'triangle', at: i * 0.11, dur: i === 3 ? 0.6 : 0.18, vol: 0.16 }));
      this.tone(1568, { at: 0.33, dur: 0.6, vol: 0.05 });
    } else {
      this.tone(659, { type: 'triangle', dur: 0.2, vol: 0.12 });
      this.tone(523, { type: 'triangle', at: 0.14, dur: 0.4, vol: 0.12 });
    }
  }

  // What you hit, before the crunch: a plastic barrel, wood or straw, or a dull heavy thud.
  thud(kind) {
    if (!this.ready) return;
    if (kind === 'barrel' || kind === 'arrow') {
      this.tone(220, { type: 'triangle', dur: 0.18, vol: 0.25, slideTo: 110 });
      this.burst({ freq: 700, q: 2, dur: 0.15, vol: 0.2 });
    } else if (kind === 'crate' || kind === 'hay') {
      this.tone(160, { type: 'triangle', dur: 0.2, vol: 0.3, slideTo: 80 });
      this.burst({ freq: 420, q: 2, dur: 0.2, vol: 0.25 });
      for (let i = 0; i < 3; i++) this.burst({ freq: 1200 + Math.random() * 800, q: 2, at: 0.05 + i * 0.06, dur: 0.08, vol: 0.1 });
    } else {
      this.tone(60, { dur: 0.3, vol: 0.45, slideTo: 30 });
      this.burst({ type: 'lowpass', freq: 500, q: 0.7, dur: 0.3, vol: 0.35 });
    }
  }

  // Guardrail scrape: a short metallic screech.
  scrape(speed) {
    if (!this.ready) return;
    const k = Math.min(1, speed / 8);
    this.burst({ freq: 3200, q: 4, dur: 0.3, vol: 0.12 + 0.12 * k, slideTo: 2200 });
    this.tone(900, { type: 'sawtooth', dur: 0.2, vol: 0.04 + 0.04 * k, slideTo: 600 });
  }

  // Cone or triangle knocked flying: a hollow plastic pock.
  knock() {
    if (!this.ready) return;
    this.tone(520, { type: 'triangle', dur: 0.1, vol: 0.18, slideTo: 300 });
    this.burst({ freq: 1500, q: 3, dur: 0.06, vol: 0.12 });
  }

  // A car you just squeezed past leans on its horn: two notes together, a little off.
  horn(truck = false) {
    if (!this.ready) return;
    const base = truck ? 160 : 330 + Math.random() * 40;
    for (const m of [1, 1.26]) this.tone(base * m, { type: 'square', dur: 0.45, vol: 0.035, attack: 0.02 });
  }

  // Stamping on the brake that isn't there: a dry squeak.
  noBrakes() {
    if (!this.ready) return;
    this.tone(1400, { type: 'square', dur: 0.08, vol: 0.04, slideTo: 1000 });
    this.tone(1300, { type: 'square', at: 0.11, dur: 0.08, vol: 0.04, slideTo: 900 });
  }

  // The engine gives up: a few dying coughs, a clank, then the hiss of steam.
  conk() {
    if (!this.ready) return;
    [0, 0.22, 0.5].forEach((at, i) => {
      this.tone(70 - i * 12, { type: 'sawtooth', at, dur: 0.16, vol: 0.18 - i * 0.04, slideTo: 35 });
      this.burst({ type: 'lowpass', freq: 600, q: 1, at, dur: 0.14, vol: 0.2 - i * 0.05 });
    });
    this.tone(1100, { type: 'square', at: 0.72, dur: 0.06, vol: 0.05, slideTo: 700 });
    this.burst({ type: 'highpass', freq: 3000, q: 0.5, at: 0.8, dur: 1.8, vol: 0.12, attack: 0.15 });
  }

  // Nitro refill picked up: a hiss of gas and a rising two-note ping.
  refill() {
    if (!this.ready) return;
    this.burst({ type: 'highpass', freq: 2500, slideTo: 5000, q: 0.7, dur: 0.35, vol: 0.14 });
    this.tone(880, { type: 'triangle', dur: 0.12, vol: 0.12 });
    this.tone(1320, { type: 'triangle', at: 0.09, dur: 0.22, vol: 0.12 });
  }

  // Wrench picked up: two ratchet clicks and a bright ding.
  repair() {
    if (!this.ready) return;
    for (let i = 0; i < 3; i++) this.burst({ freq: 2400, q: 6, at: i * 0.06, dur: 0.035, vol: 0.18 });
    this.tone(1046, { type: 'triangle', at: 0.2, dur: 0.18, vol: 0.12 });
    this.tone(1568, { type: 'triangle', at: 0.3, dur: 0.35, vol: 0.12 });
  }

  click() {
    if (!this.ready) return;
    this.tone(900, { type: 'triangle', dur: 0.05, vol: 0.06, slideTo: 600 });
  }
}
