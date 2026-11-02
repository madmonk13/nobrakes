// Best scores and the car's style and colours, stored in localStorage. Every access is guarded so the
// game still runs (without saving) in private windows or when storage is blocked.

const KEY = 'nobrakes.save.v1';

export const DEFAULT_SENSITIVITY = 0.75; // touch steering: 1 = a 60 px drag is full lock, lower asks for a longer drag
export const SENS_MIN = 0.3;
export const SENS_MAX = 1.5;
export const DEFAULT_COLORS = { body: '#e84a3a', stripe: '#f7f7f2', rims: '#c0c6cc' };
export const DEFAULT_STYLE = 'coupe';
export const STYLE_IDS = ['coupe', 'muscle', 'hatch', 'pickup', 'supercar', 'roadster'];
const HEX = /^#[0-9a-f]{6}$/i;

export function defaultSave() {
  return {
    version: 1,
    best: 0, // best score
    bestDistance: 0,
    runs: 0,
    style: DEFAULT_STYLE, // preference: the car's body style
    colors: { ...DEFAULT_COLORS }, // preferences: body, stripe and rim colours
    touchSensitivity: DEFAULT_SENSITIVITY, // preference: how touch steering responds to a drag
  };
}

// keep only well-formed colours, so a hand-edited or old save can't break the car
function cleanColors(colors) {
  const out = { ...DEFAULT_COLORS };
  for (const k of Object.keys(out)) if (typeof colors?.[k] === 'string' && HEX.test(colors[k])) out[k] = colors[k].toLowerCase();
  return out;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const save = { ...defaultSave(), ...JSON.parse(raw) };
    save.colors = cleanColors(save.colors);
    if (!STYLE_IDS.includes(save.style)) save.style = DEFAULT_STYLE;
    const sens = Number(save.touchSensitivity);
    save.touchSensitivity = Number.isFinite(sens) ? Math.min(SENS_MAX, Math.max(SENS_MIN, sens)) : DEFAULT_SENSITIVITY;
    return save;
  } catch {
    return defaultSave();
  }
}

export function writeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // storage unavailable; scores last for this session only
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
