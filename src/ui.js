// DOM overlays: menu, HUD, the start hint and results.

import { COINS_ENABLED } from './terrain.js';
import { DEFAULT_COLORS, DEFAULT_STYLE, STYLE_IDS, DEFAULT_SENSITIVITY, SENS_MIN, SENS_MAX } from './save.js';
import { STYLES } from './car.js';
import { VEHICLE_NAMES } from './vehicles.js';
import { MAX_HEALTH } from './physics.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString();
export const MPH = 2.23694; // m/s -> mph

const CRASH_LINES = {
  traffic: (v) => `You ran into ${VEHICLE_NAMES[v] || 'another car'}.`,
  broken: () => 'You hit a broken-down car.',
  barrier: () => 'You hit a concrete barrier.',
  barrel: () => 'You ploughed into the roadworks.',
  arrow: () => 'You hit the flashing arrow board. It was flashing.',
  machine: () => 'You hit the roadworks machinery.',
  crate: () => 'You hit some spilled cargo.',
  hay: () => 'You hit a fallen hay bale.',
  tyre: () => 'You hit a lost tyre.',
  rock: () => 'You drove into a rock slide.',
  boulder: () => 'A rolling boulder got you.',
  log: () => 'A runaway log got you.',
  spool: () => 'A runaway cable spool got you.',
  bale: () => 'A rolling hay bale got you.',
  tumbleweed: () => 'Done in by a tumbleweed.',
  rail: () => 'You hit the guardrail.',
  gap: () => 'You drove off a collapsed bridge.',
  landing: () => 'You landed too hard.',
  stuck: () => 'You got wedged in the wreckage.',
};

const PALETTE = [
  '#e84a3a', '#ff9a2e', '#f5c518', '#2fb36b', '#1fb5b5',
  '#2f7fd4', '#8a5cd0', '#f06292', '#f7f7f2', '#23262e',
];

export class UI {
  constructor(handlers) {
    this.h = handlers; // { play, endRun, pause, reset, style(id), colors(colors), sensitivity(k) }
    this.lastScore = -1;
    this.prefsOpen = false; // the preferences panel is up; main.js frames the car close-up
    this.helpOpen = false; // the how-to-play panel is up
    this.buildPrefs();
    $('btn-play').onclick = () => this.h.play();
    $('btn-again').onclick = () => this.h.play();
    $('btn-menu').onclick = () => this.showMenu(this.save);
    $('btn-end').onclick = () => this.h.endRun();
    $('btn-pause').onclick = () => this.h.pause(true);
    $('btn-resume').onclick = () => this.h.pause(false);
    $('btn-pause-end').onclick = () => {
      this.h.pause(false);
      this.h.endRun();
    };
    $('btn-reset').onclick = () => {
      if (confirm('Reset your best score and distance?')) this.h.reset();
    };
  }

  show(screen) {
    for (const id of ['menu', 'results', 'prefs', 'help', 'pause']) $(id).classList.toggle('hidden', id !== screen);
    this.prefsOpen = screen === 'prefs';
    this.helpOpen = screen === 'help';
  }

  // ---------- preferences: body style; body, stripe and rim colours ----------
  buildPrefs() {
    const styles = document.querySelector('#pref-style .styles');
    for (const id of STYLE_IDS) {
      const b = document.createElement('button');
      b.className = 'style-chip';
      b.dataset.style = id;
      b.textContent = STYLES[id].name;
      b.onclick = () => this.setStyle(id);
      styles.append(b);
    }
    for (const row of document.querySelectorAll('.pref[data-pref]')) {
      const key = row.dataset.pref;
      const box = row.querySelector('.swatches');
      for (const color of PALETTE) {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.style.background = color;
        b.dataset.color = color;
        b.setAttribute('aria-label', `${key} ${color}`);
        b.onclick = () => this.setColor(key, color);
        box.append(b);
      }
      // any other colour, via the browser's own picker
      const custom = document.createElement('label');
      custom.className = 'swatch custom';
      custom.title = 'Pick any colour';
      const input = document.createElement('input');
      input.type = 'color';
      input.setAttribute('aria-label', `${key} custom colour`);
      input.oninput = () => this.setColor(key, input.value);
      custom.append(input);
      box.append(custom);
    }
    $('btn-prefs').onclick = () => this.showPrefs();
    $('btn-help').onclick = () => this.show('help');
    $('btn-help-close').onclick = () => this.showMenu(this.save);
    $('btn-prefs-done').onclick = () => this.showMenu(this.save);
    $('btn-prefs-reset').onclick = () => {
      this.save.style = DEFAULT_STYLE;
      this.h.style(DEFAULT_STYLE);
      this.save.colors = { ...DEFAULT_COLORS };
      this.h.colors(this.save.colors);
      this.save.touchSensitivity = DEFAULT_SENSITIVITY;
      this.h.sensitivity(DEFAULT_SENSITIVITY);
      this.refreshPrefs();
    };
    const sens = $('sens');
    sens.min = SENS_MIN;
    sens.max = SENS_MAX;
    sens.step = 0.05;
    sens.oninput = () => {
      this.save.touchSensitivity = Number(sens.value);
      this.h.sensitivity(this.save.touchSensitivity);
      this.showSensitivity();
    };
  }

  showPrefs() {
    this.refreshPrefs();
    this.show('prefs');
  }

  setStyle(id) {
    this.save.style = id;
    this.h.style(id);
    this.refreshPrefs();
  }

  setColor(key, color) {
    this.save.colors = { ...this.save.colors, [key]: color };
    this.h.colors(this.save.colors);
    this.refreshPrefs();
  }

  showSensitivity() {
    $('sens').value = this.save.touchSensitivity;
    $('sens-value').textContent = `${Math.round(this.save.touchSensitivity * 100)}%`;
  }

  // mark the swatch matching each current colour; a colour outside the palette lights up the custom one
  refreshPrefs() {
    this.showSensitivity();
    for (const b of document.querySelectorAll('.style-chip')) b.classList.toggle('selected', b.dataset.style === this.save.style);
    for (const row of document.querySelectorAll('.pref[data-pref]')) {
      const current = this.save.colors[row.dataset.pref];
      let matched = false;
      for (const s of row.querySelectorAll('.swatch:not(.custom)')) {
        const on = s.dataset.color === current;
        s.classList.toggle('selected', on);
        matched ||= on;
      }
      const custom = row.querySelector('.swatch.custom');
      custom.classList.toggle('selected', !matched);
      row.querySelector('input').value = current;
    }
  }

  showMenu(save) {
    this.save = save;
    $('menu-best').textContent = fmt(save.best);
    $('menu-dist').textContent = `${fmt(save.bestDistance)} m`;
    this.show('menu');
    this.setMode('menu');
  }

  // which in-world UI is visible for a game mode
  setMode(mode) {
    const playing = mode === 'ready' || mode === 'run' || mode === 'crash';
    $('hud').classList.toggle('hidden', !playing);
    $('btn-end').classList.toggle('hidden', mode !== 'run');
    $('btn-pause').classList.toggle('hidden', mode !== 'run');
    $('hint').classList.toggle('hidden', mode !== 'ready');
    if (mode !== 'menu') this.show(null);
  }

  updateHud(run, body, best) {
    $('hud-dist').textContent = `${fmt(Math.max(0, run.maxZ))} m`;
    $('hud-speed').textContent = `${fmt(body.speed * MPH)} mph`;
    if (run.score !== this.lastScore) {
      const el = $('hud-score');
      el.textContent = fmt(run.score);
      // pop on bonuses, not on every metre
      if (this.lastScore >= 0 && run.score - this.lastScore > 2) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
      this.lastScore = run.score;
    }
    const toBest = best - run.score;
    $('hud-best').textContent = best > 0 ? (toBest > 0 ? `Best ${fmt(best)} · ${fmt(toBest)} to beat` : '🏁 New best!') : '';
    $('hud-boost').classList.toggle('on', body.boosting);
    const health = body.health / MAX_HEALTH;
    const hm = $('meter-health');
    hm.querySelector('.fill').style.transform = `scaleX(${health})`;
    hm.classList.toggle('warn', health <= 0.5 && health > 0.25);
    hm.classList.toggle('low', health <= 0.25);
    const nm = $('meter-nitro');
    nm.querySelector('.fill').style.transform = `scaleX(${body.nitro})`;
    nm.classList.toggle('on', body.boosting);
    nm.classList.toggle('empty', body.nitro <= 0);
  }

  // the car took a hit: shake the damage meter
  damage() {
    const el = $('meter-health');
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  }

  resetHud() {
    this.lastScore = -1;
  }

  // the Paused card covers the game; the in-run buttons step aside while it's up
  showPause(on) {
    this.show(on ? 'pause' : null);
    for (const id of ['btn-pause', 'btn-end']) $(id).classList.toggle('hidden', on);
  }

  toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  showResults(r, save) {
    this.save = save;
    $('res-title').textContent = r.newBest ? 'New high score!' : r.conked ? 'Totaled!' : r.crash ? 'Wrecked!' : 'Run over';
    const why = CRASH_LINES[r.crash]?.(r.detail) || '';
    // conked out: the last hit was only the final straw
    $('res-why').textContent = r.conked && r.crash !== 'stuck' ? `${why} One knock too many, and the engine gave up.`.trim() : why;
    $('res-best-badge').classList.toggle('hidden', !r.newBest);
    $('res-score').textContent = fmt(r.total);
    $('res-dist').textContent = `${fmt(r.distance)} m`;
    $('res-coins-row').classList.toggle('hidden', !COINS_ENABLED);
    $('res-coins').textContent = `${fmt(r.coins)} × ${fmt(r.coinValue)} = ${fmt(r.coinPoints)}`;
    $('res-boost').textContent = fmt(r.boost);
    $('res-close').textContent = `${fmt(r.close)} · ${fmt(r.closePoints)}`;
    $('res-cones').textContent = `${fmt(r.cones)} · ${fmt(r.conePoints)}`;
    $('res-gaps').textContent = `${fmt(r.gaps)} × 100 = ${fmt(r.gapPoints)}`;
    $('res-air').textContent = fmt(r.air);
    $('res-best').textContent = fmt(save.best);
    this.setMode('results');
    this.show('results');
  }
}
