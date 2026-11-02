// Keyboard plus touch/mouse on the game canvas. The first finger down steers by how far it
// has been dragged sideways from where it landed, and putting a second finger down fires the
// nitro (you keep steering with the first while it burns).

const BLOCKED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
const STEER_PX = 60; // drag this far sideways for full lock (at sensitivity 1)

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.steerPx = STEER_PX;
    this.pointers = new Map(); // id -> { startX, x, y }
    this.steerId = null; // the pointer that steers
    this.onKeyDown = null;
    this.onPointerDown = null;

    window.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.onKeyDown?.(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.pointers.clear();
      this.steerId = null;
    });

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { startX: e.clientX, x: e.clientX, y: e.clientY });
      if (this.steerId === null) this.steerId = e.pointerId;
      this.onPointerDown?.();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (e.pointerId !== this.steerId) return;
      // hand steering to a finger that's still down, starting from where it is now
      this.steerId = null;
      for (const [id, p] of this.pointers) {
        p.startX = p.x;
        this.steerId = id;
        break;
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // 1 is the original feel; lower needs a longer drag for the same turn, higher a shorter one
  setSensitivity(k) {
    this.steerPx = STEER_PX / k;
  }

  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  // -1..1, positive = right
  steer() {
    let s = 0;
    if (this.down('ArrowLeft', 'KeyA')) s -= 1;
    if (this.down('ArrowRight', 'KeyD')) s += 1;
    const p = this.pointers.get(this.steerId);
    if (p) s += (p.x - p.startX) / this.steerPx;
    return Math.max(-1, Math.min(1, s));
  }

  boost() {
    if (this.down('ArrowUp', 'KeyW', 'Space', 'ShiftLeft', 'ShiftRight')) return true;
    return this.pointers.size >= 2; // two fingers down
  }
}
