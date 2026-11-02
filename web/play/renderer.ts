import { ARENA, PLAYER, TICK_RATE } from '../../engine/constants';
import { activeModifiers, arenaMargin, laserAngle, laserEnd, type GameState, type Point } from '../../engine/simulation';

// The arena is drawn as a live technical drawing: ink field, drafting grid, rulers, range rings,
// line-art bosses and crisp, high-contrast bullets. Everything here is visual only; the simulation
// owns positions, timing and hitboxes.

const INK = '#07080A', PAPER = '#ECEBE5', ACCENT = '#CBF579', DANGER = '#FF6B4A';
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace';
const SANS = '"Inter Tight Variable", "Inter Tight", "Helvetica Neue", Arial, sans-serif';

interface Particle extends Point { vx: number; vy: number; life: number; maxLife: number; color: string; radius: number }
interface Ring extends Point { age: number; life: number; color: string; reach: number }
export class Effects {
  particles: Particle[] = [];
  rings: Ring[] = [];
  shake = 0;
  flash = 0;
  /** Phase-change sweep: 1 → 0 as the scan line crosses the drawing. */
  sweep = 0;
  sweepLabel = '';
  /** Seconds since the fight ended (won/lost), for the closing treatment. */
  ended = -1;
  private serial = 0;
  readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  consume(game: GameState) {
    for (const event of game.events) {
      const count = event.kind === 'bossHit' ? 2 : event.kind === 'hit' ? 26 : event.kind === 'won' ? 90 : event.kind === 'lost' ? 30 : 16;
      const color = event.kind === 'hit' ? DANGER : event.kind === 'bossHit' ? PAPER : game.spec.look.palette[0]!;
      if (event.kind === 'hit') { this.shake = this.reducedMotion ? 0 : 11; this.flash = this.reducedMotion ? 0 : 0.6; }
      if (event.kind === 'phase') {
        this.shake = this.reducedMotion ? 0 : 6; this.sweep = this.reducedMotion ? 0 : 1;
        this.sweepLabel = `PHASE ${String(game.boss.phase + 1).padStart(2, '0')}`;
        this.rings.push({ x: event.x, y: event.y, age: 0, life: 1.1, color, reach: 260 });
      }
      if (event.kind === 'won' || event.kind === 'lost') {
        this.ended = 0; this.shake = this.reducedMotion ? 0 : 7;
        if (!this.reducedMotion) for (let index = 0; index < 4; index++) this.rings.push({ x: event.x, y: event.y, age: -index * 0.22, life: 1.6, color, reach: 520 });
      }
      if (event.kind === 'minionDown') this.rings.push({ x: event.x, y: event.y, age: 0, life: 0.45, color, reach: 40 });
      if (this.reducedMotion && event.kind === 'bossHit') continue;
      for (let index = 0; index < count && this.particles.length < 350; index++) {
        const value = ++this.serial;
        const angle = value * 2.399963;
        const speed = 30 + (value * 37 % 170);
        const life = 0.2 + (value % 11) * 0.035;
        this.particles.push({ x: event.x, y: event.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life, maxLife: life, color, radius: event.kind === 'won' ? 2.4 : 1.6 });
      }
    }
  }

  update(dt: number) {
    this.shake = Math.max(0, this.shake - dt * 38);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.sweep = Math.max(0, this.sweep - dt * 0.9);
    if (this.ended >= 0) this.ended += dt;
    this.particles = this.particles.filter((particle) => {
      particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.life -= dt;
      return particle.life > 0;
    });
    this.rings = this.rings.filter((ring) => (ring.age += dt) < ring.life);
  }
}

/* ---------- small drawing helpers ---------- */
function line(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}
function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string | CanvasGradient | CanvasPattern) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2); ctx.fill();
}
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0, radius), 0, Math.PI * 2); ctx.stroke();
}
function polygon(ctx: CanvasRenderingContext2D, radius: number, points: number, offset = 0) {
  ctx.beginPath();
  for (let index = 0; index < points; index++) {
    const angle = offset + index * Math.PI * 2 / points;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
const hex = (color: string, alpha: number) => `${color}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;
// Canvas text does not trigger font loading by itself (capture mode hides all DOM text), so request the faces.
if (typeof document !== 'undefined' && document.fonts?.load) { void document.fonts.load(`10px ${MONO}`).catch(() => {}); void document.fonts.load(`600 12px ${SANS}`).catch(() => {}); }
const fontsReady = () =>typeof document !== 'undefined' && document.fonts?.check?.(`10px ${MONO}`) === true;

/* ---------- the drafting sheet (static, cached) ---------- */
let sheet: HTMLCanvasElement | null = null, sheetHasFonts = false;
function drawingSheet(): HTMLCanvasElement {
  const ready = fontsReady();
  if (sheet && (sheetHasFonts || !ready)) return sheet;
  const { width, height } = ARENA;
  sheet = document.createElement('canvas'); sheet.width = width; sheet.height = height; sheetHasFonts = ready;
  const ctx = sheet.getContext('2d')!;
  ctx.fillStyle = INK; ctx.fillRect(0, 0, width, height);
  const wash = ctx.createRadialGradient(width / 2, 170, 30, width / 2, 300, 720);
  wash.addColorStop(0, '#15181d'); wash.addColorStop(0.55, '#0b0d10'); wash.addColorStop(1, INK);
  ctx.fillStyle = wash; ctx.fillRect(0, 0, width, height);
  // Minor and major grid.
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 24) { ctx.strokeStyle = x % 96 === 0 ? '#ECEBE512' : '#ECEBE507'; line(ctx, { x: x + 0.5, y: 0 }, { x: x + 0.5, y: height }); }
  for (let y = 0; y <= height; y += 24) { ctx.strokeStyle = y % 96 === 0 ? '#ECEBE512' : '#ECEBE507'; line(ctx, { x: 0, y: y + 0.5 }, { x: width, y: y + 0.5 }); }
  // Major grid crosses.
  ctx.strokeStyle = '#ECEBE52A';
  for (let x = 96; x < width; x += 96) for (let y = 96; y < height; y += 96) { line(ctx, { x: x - 3, y: y + 0.5 }, { x: x + 4, y: y + 0.5 }); line(ctx, { x: x + 0.5, y: y - 3 }, { x: x + 0.5, y: y + 4 }); }
  // Rulers on all four edges.
  ctx.strokeStyle = '#ECEBE540'; ctx.fillStyle = '#ECEBE555'; ctx.font = `9px ${MONO}`;
  for (let x = 0; x <= width; x += 12) {
    const size = x % 96 === 0 ? 9 : x % 48 === 0 ? 6 : 3;
    line(ctx, { x: x + 0.5, y: 0 }, { x: x + 0.5, y: size }); line(ctx, { x: x + 0.5, y: height }, { x: x + 0.5, y: height - size });
    if (x % 96 === 0 && x > 0 && x < width) { ctx.textAlign = 'left'; ctx.fillText(String(x), x + 3, 18); }
  }
  for (let y = 0; y <= height; y += 12) {
    const size = y % 96 === 0 ? 9 : y % 48 === 0 ? 6 : 3;
    line(ctx, { x: 0, y: y + 0.5 }, { x: size, y: y + 0.5 }); line(ctx, { x: width, y: y + 0.5 }, { x: width - size, y: y + 0.5 });
    if (y % 96 === 0 && y > 0 && y < height) { ctx.textAlign = 'left'; ctx.fillText(String(y), 12, y - 3); }
  }
  // Corner registration marks.
  ctx.strokeStyle = '#ECEBE566';
  for (const [cx, cy] of [[22, 30], [width - 22, 30], [22, height - 22], [width - 22, height - 22]] as const) {
    ring(ctx, cx, cy, 5); line(ctx, { x: cx - 9, y: cy }, { x: cx + 9, y: cy }); line(ctx, { x: cx, y: cy - 9 }, { x: cx, y: cy + 9 });
  }
  // Grain.
  for (let index = 0; index < 900; index++) {
    const x = (index * 137.5 + 31) % width, y = (index * 229.3 + 71) % height;
    ctx.fillStyle = index % 5 ? '#ffffff05' : '#ffffff0b'; ctx.fillRect(x, y, 1, 1);
  }
  return sheet;
}

/* ---------- bullet sprites: pre-rendered bloom + crisp body (no per-bullet shadowBlur) ---------- */
const sprites = new Map<string, HTMLCanvasElement>();
function bulletSprite(color: string, shape: string, radius: number, armed: boolean): HTMLCanvasElement {
  const key = `${color}|${shape}|${radius}|${armed}`;
  const cached = sprites.get(key); if (cached) return cached;
  const pad = Math.ceil(radius * 2.6 + 8), size = pad * 2;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!; ctx.translate(pad, pad);
  // Bloom.
  const bloom = ctx.createRadialGradient(0, 0, radius * 0.4, 0, 0, pad);
  bloom.addColorStop(0, hex(color, armed ? 0.42 : 0.16)); bloom.addColorStop(0.45, hex(color, armed ? 0.12 : 0.05)); bloom.addColorStop(1, hex(color, 0));
  circle(ctx, 0, 0, pad, bloom);
  const body = () => {
    if (shape === 'diamond' || shape === 'shard') { ctx.save(); ctx.scale(shape === 'shard' ? 1.7 : 1, 1); polygon(ctx, radius + 1, 4); ctx.restore(); }
    else if (shape === 'capsule') { ctx.beginPath(); ctx.ellipse(0, 0, radius * 1.6, radius * 0.75, 0, 0, Math.PI * 2); }
    else { ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); }
  };
  // Dark keyline keeps every bullet legible over other bullets and lasers.
  body(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#000000AA'; ctx.stroke();
  body(); ctx.fillStyle = armed ? color : hex(color, 0.45); ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = armed ? '#FFFFFFB0' : hex(color, 0.8); body(); ctx.stroke();
  if (armed) {
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.75);
    core.addColorStop(0, '#FFFFFFF0'); core.addColorStop(1, '#FFFFFF00');
    circle(ctx, 0, 0, radius * 0.75, core);
  }
  if (sprites.size > 400) sprites.clear();
  sprites.set(key, canvas); return canvas;
}

/* ---------- boss: line art with an inner glow ---------- */
const glows = new Map<string, HTMLCanvasElement>();
function bossGlow(color: string, size: number): HTMLCanvasElement {
  const key = `${color}|${size}`; const cached = glows.get(key); if (cached) return cached;
  const reach = Math.ceil(size * 3.2), canvas = document.createElement('canvas'); canvas.width = canvas.height = reach * 2;
  const ctx = canvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(reach, reach, size * 0.2, reach, reach, reach);
  glow.addColorStop(0, hex(color, 0.32)); glow.addColorStop(0.35, hex(color, 0.1)); glow.addColorStop(1, hex(color, 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, reach * 2, reach * 2);
  glows.set(key, canvas); return canvas;
}

export function drawBoss(ctx: CanvasRenderingContext2D, game: GameState, time: number) {
  const { look } = game.spec, { boss } = game;
  const size = look.size, main = look.palette[0]!, light = look.palette[1]!;
  ctx.save(); ctx.translate(boss.x, boss.y);
  const glow = bossGlow(main, size); ctx.drawImage(glow, -glow.width / 2, -glow.height / 2);

  // Aura, drawn as fine construction lines.
  ctx.lineWidth = 1;
  if (look.aura === 'flame') {
    for (let index = 0; index < 24; index++) {
      const angle = index * Math.PI / 12 + time * 0.13;
      const reach = size * (1.32 + Math.sin(time * 3 + index * 2) * 0.12) + (index % 2 ? 0 : 6);
      ctx.strokeStyle = hex(main, index % 2 ? 0.35 : 0.7);
      line(ctx, { x: Math.cos(angle) * size * 1.08, y: Math.sin(angle) * size * 1.08 }, { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
    }
  } else if (look.aura === 'glitch') {
    for (let index = 0; index < 5; index++) {
      const offset = Math.sin(time * 7 + index * 3);
      ctx.fillStyle = hex(index % 2 ? light : main, 0.45);
      ctx.fillRect(-size * 1.5 + offset * 12, (index - 2) * size * 0.55, size * (0.9 + offset * 0.6), 1.5);
    }
  } else if (look.aura === 'sparkle') {
    for (let index = 0; index < 10; index++) {
      const angle = index * 0.628 + time * 0.25, reach = size * (1.45 + (index % 3) * 0.14);
      const x = Math.cos(angle) * reach, y = Math.sin(angle) * reach, s = 2 + Math.sin(time * 4 + index) * 1.5;
      ctx.strokeStyle = hex(light, 0.8); line(ctx, { x: x - s, y }, { x: x + s, y }); line(ctx, { x, y: y - s }, { x, y: y + s });
    }
  } else {
    for (let index = 0; index < 3; index++) {
      ctx.strokeStyle = hex(main, 0.28 - index * 0.06);
      ctx.beginPath(); ctx.ellipse(0, 0, size * (1.55 + index * 0.2), size * 0.5, time * 0.2 + index * 1.1, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // Rotating dimension ring with ticks.
  ctx.save(); ctx.rotate(time * 0.15); ctx.strokeStyle = hex(main, 0.45); ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]); ring(ctx, 0, 0, size * 1.28); ctx.setLineDash([]);
  for (let index = 0; index < 4; index++) { ctx.rotate(Math.PI / 2); line(ctx, { x: size * 1.2, y: 0 }, { x: size * 1.38, y: 0 }); }
  ctx.restore();

  // Body: ink fill + palette tint, double keyline, then shape details.
  const body = (fill: boolean) => {
    ctx.fillStyle = hex(main, 0.16); ctx.strokeStyle = main; ctx.lineWidth = 1.8;
    if (fill) { ctx.save(); ctx.fillStyle = '#0B0D10E6'; ctx.fill(); ctx.restore(); ctx.fill(); }
    ctx.stroke();
  };
  switch (look.shape) {
    case 'mech': {
      ctx.save(); ctx.rotate(Math.sin(time) * 0.03);
      polygon(ctx, size * 1.08, 8, Math.PI / 8); ctx.strokeStyle = hex(main, 0.35); ctx.lineWidth = 1; ctx.stroke();
      polygon(ctx, size, 8, Math.PI / 8); body(true);
      ctx.strokeStyle = main; ctx.lineWidth = 1.2; ctx.fillStyle = '#0B0D10';
      ctx.fillRect(-size * 0.8, -size * 0.36, size * 1.6, size * 0.72); ctx.strokeRect(-size * 0.8, -size * 0.36, size * 1.6, size * 0.72);
      const visor = ctx.createLinearGradient(-size * 0.5, 0, size * 0.5, 0);
      visor.addColorStop(0, hex(light, 0.2)); visor.addColorStop(0.5, light); visor.addColorStop(1, hex(light, 0.2));
      ctx.fillStyle = visor; ctx.fillRect(-size * 0.52, -size * 0.07, size * 1.04, size * 0.14);
      for (const side of [-1, 1]) for (let index = 0; index < 3; index++) { ctx.strokeStyle = main; ctx.strokeRect((index - 1) * size * 0.25 - 4, side * size * 0.58 - 3, 8, 6); }
      polygon(ctx, size * 0.2, 4); ctx.fillStyle = PAPER; ctx.fill(); ctx.restore(); break;
    }
    case 'blob': {
      ctx.beginPath();
      for (let index = 0; index <= 64; index++) {
        const angle = index * Math.PI * 2 / 64, radius = size * (1 + Math.sin(angle * 5 + time * 3) * 0.1);
        const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
        if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      body(true);
      ctx.strokeStyle = hex(main, 0.35); ctx.lineWidth = 1; ring(ctx, 0, 0, size * 0.72);
      circle(ctx, -size * 0.31, -size * 0.06, size * 0.15, light); circle(ctx, size * 0.31, -size * 0.06, size * 0.15, light);
      circle(ctx, -size * 0.31, -size * 0.06, size * 0.05, INK); circle(ctx, size * 0.31, -size * 0.06, size * 0.05, INK);
      ctx.strokeStyle = light; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, size * 0.14, size * 0.3, 0.25, Math.PI - 0.25); ctx.stroke(); break;
    }
    case 'crystal': {
      ctx.save(); ctx.scale(0.85, 1.25); ctx.rotate(Math.sin(time * 0.6) * 0.13);
      polygon(ctx, size, 4); body(true);
      ctx.strokeStyle = hex(main, 0.7); ctx.lineWidth = 1;
      line(ctx, { x: 0, y: -size }, { x: -size * 0.4, y: 0 }); line(ctx, { x: 0, y: -size }, { x: size * 0.4, y: 0 });
      line(ctx, { x: -size, y: 0 }, { x: size, y: 0 }); line(ctx, { x: -size * 0.4, y: 0 }, { x: 0, y: size });
      line(ctx, { x: size * 0.4, y: 0 }, { x: 0, y: size });
      const open = game.tick < boss.coreOpenUntil;
      polygon(ctx, size * 0.28, 4); ctx.fillStyle = open ? '#FFFFFF' : light; ctx.fill();
      if (open) { ctx.strokeStyle = '#FFFFFF'; polygon(ctx, size * 0.42, 4); ctx.stroke(); }
      ctx.restore(); break;
    }
    case 'eye': {
      ctx.beginPath(); ctx.ellipse(0, 0, size, size * 0.62, 0, 0, Math.PI * 2); body(true);
      ctx.strokeStyle = hex(main, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 0, size * 1.12, size * 0.74, 0, 0, Math.PI * 2); ctx.stroke();
      const look = Math.sin(time * 0.9) * size * 0.12;
      ctx.strokeStyle = main; ctx.lineWidth = 1.4; ring(ctx, look, 0, size * 0.48);
      for (let index = 0; index < 16; index++) {
        const a = index * Math.PI / 8; ctx.strokeStyle = hex(main, 0.6);
        line(ctx, { x: look + Math.cos(a) * size * 0.28, y: Math.sin(a) * size * 0.28 }, { x: look + Math.cos(a) * size * 0.46, y: Math.sin(a) * size * 0.46 });
      }
      circle(ctx, look, 0, size * 0.24, INK); circle(ctx, look + size * 0.08, -size * 0.12, size * 0.08, light); break;
    }
    case 'skull': {
      polygon(ctx, size, 7, -Math.PI / 2); body(true);
      ctx.strokeStyle = hex(main, 0.4); ctx.lineWidth = 1; polygon(ctx, size * 1.1, 7, -Math.PI / 2); ctx.stroke();
      for (const side of [-1, 1]) { ctx.strokeStyle = main; ctx.lineWidth = 1.4; ring(ctx, side * size * 0.33, -size * 0.1, size * 0.22); circle(ctx, side * size * 0.33, -size * 0.1, size * 0.1, light); }
      ctx.strokeStyle = main;
      for (let index = -2; index <= 2; index++) line(ctx, { x: index * size * 0.13, y: size * 0.36 }, { x: index * size * 0.13, y: size * 0.62 });
      line(ctx, { x: -size * 0.32, y: size * 0.36 }, { x: size * 0.32, y: size * 0.36 }); break;
    }
    case 'serpent': {
      for (let index = 6; index >= 0; index--) {
        const x = Math.sin(time * 2 - index * 0.5) * size * 0.5, y = index * size * 0.24, r = size * (0.55 - index * 0.055);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0B0D10'; ctx.fill(); ctx.fillStyle = hex(main, 0.12 + (6 - index) * 0.02); ctx.fill();
        ctx.strokeStyle = hex(main, 1 - index * 0.1); ctx.lineWidth = index ? 1.2 : 1.8; ctx.stroke();
      }
      circle(ctx, -size * 0.15, -4, 3.5, light); circle(ctx, size * 0.15, -4, 3.5, light); break;
    }
  }
  ctx.restore();
}

/* ---------- the frame ---------- */
export function renderGame(ctx: CanvasRenderingContext2D, game: GameState, time: number, effects: Effects, lobby: boolean) {
  const width = ARENA.width, height = ARENA.height;
  const calm = effects.reducedMotion;
  const main = game.spec.look.palette[0]!;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(drawingSheet(), 0, 0);
  ctx.save();
  ctx.translate(Math.sin(time * 97) * effects.shake, Math.cos(time * 113) * effects.shake);

  // Range rings and crosshair centred on the boss.
  const boss = game.boss;
  if (game.status !== 'won') {
    ctx.lineWidth = 1; ctx.font = `9px ${MONO}`; ctx.textAlign = 'left';
    ctx.strokeStyle = '#ECEBE50F'; line(ctx, { x: boss.x, y: 0 }, { x: boss.x, y: height }); line(ctx, { x: 0, y: boss.y }, { x: width, y: boss.y });
    for (const radius of [120, 240, 360, 480]) {
      ctx.strokeStyle = radius === 240 ? hex(main, 0.16) : '#ECEBE512'; ring(ctx, boss.x, boss.y, radius);
      ctx.fillStyle = '#ECEBE545'; ctx.fillText(`R${radius}`, boss.x + radius * 0.707 + 4, boss.y + radius * 0.707 - 4);
    }
  }

  // Playable bounds (shrinks with arena modifiers), drawn as a dashed drafting rectangle.
  const margin = arenaMargin(game);
  const bx = margin + 14, by = margin + 14, bw = width - margin * 2 - 28, bh = height - margin * 2 - 28;
  ctx.strokeStyle = margin > 0 ? hex(DANGER, 0.55) : '#ECEBE52E'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
  ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh); ctx.setLineDash([]);
  ctx.strokeStyle = margin > 0 ? DANGER : '#ECEBE566';
  for (const [x, y, dx, dy] of [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]] as const) {
    line(ctx, { x, y }, { x: x + dx * 12, y }); line(ctx, { x, y }, { x, y: y + dy * 12 });
  }

  // Attack warnings: locked to the future attack's origin and direction.
  for (const pending of game.pending) {
    const color = pending.attack.params.color, attack = pending.attack;
    ctx.strokeStyle = hex(color, 0.6); ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
    if (attack.emitter === 'aimed' || attack.emitter === 'fan' || attack.emitter === 'homing') {
      line(ctx, pending, { x: pending.x + Math.cos(pending.angle) * 900, y: pending.y + Math.sin(pending.angle) * 900 });
    }
    ctx.setLineDash([]);
    const pulse = calm ? 0 : Math.sin(time * 7) * 6;
    ctx.strokeStyle = hex(color, 0.85); ring(ctx, pending.x, pending.y, 16 + pulse);
    ctx.strokeStyle = hex(color, 0.4); ring(ctx, pending.x, pending.y, 26 + pulse);
  }

  // Lasers: telegraph as a measured lane, then fire.
  for (const laser of game.lasers) {
    const active = game.tick >= laser.fireTick;
    const end = laserEnd(laser, game.tick), angle = laserAngle(laser, game.tick);
    const nx = -Math.sin(angle) * laser.width / 2, ny = Math.cos(angle) * laser.width / 2;
    if (!active) {
      const progress = Math.max(0, Math.min(1, 1 - (laser.fireTick - game.tick) / Math.max(1, laser.fireTick - laser.born)));
      if (laser.sweep !== 0) {
        ctx.beginPath(); ctx.moveTo(laser.x, laser.y);
        ctx.arc(laser.x, laser.y, laser.length, laser.angle, laser.angle + laser.sweep, laser.sweep < 0); ctx.closePath();
        ctx.fillStyle = hex(laser.color, 0.07); ctx.fill();
      }
      ctx.strokeStyle = hex(laser.color, 0.55); ctx.lineWidth = 1; ctx.setLineDash([10, 8]);
      line(ctx, { x: laser.x + nx, y: laser.y + ny }, { x: end.x + nx, y: end.y + ny });
      line(ctx, { x: laser.x - nx, y: laser.y - ny }, { x: end.x - nx, y: end.y - ny });
      ctx.setLineDash([2, 6]); ctx.strokeStyle = hex(laser.color, 0.8); line(ctx, laser, end); ctx.setLineDash([]);
      // Charge fill shows how soon it fires.
      ctx.strokeStyle = hex(laser.color, 0.35 + progress * 0.5); ctx.lineWidth = Math.max(1, laser.width * progress * 0.5);
      line(ctx, laser, { x: laser.x + (end.x - laser.x) * progress, y: laser.y + (end.y - laser.y) * progress });
    } else {
      ctx.lineCap = 'round';
      ctx.strokeStyle = hex(laser.color, 0.16); ctx.lineWidth = laser.width + 26; line(ctx, laser, end);
      ctx.strokeStyle = hex(laser.color, 0.5); ctx.lineWidth = laser.width + 6; line(ctx, laser, end);
      ctx.strokeStyle = laser.color; ctx.lineWidth = laser.width; line(ctx, laser, end);
      ctx.strokeStyle = '#FFFFFFE6'; ctx.lineWidth = Math.max(2, laser.width * 0.35); line(ctx, laser, end);
      ctx.lineCap = 'butt';
    }
    ctx.strokeStyle = laser.color; ctx.lineWidth = 1.2; ring(ctx, laser.x, laser.y, 10);
    circle(ctx, laser.x, laser.y, 4, active ? '#FFFFFF' : laser.color);
  }

  // Scripted telegraphs and boss movement warnings.
  for (const warning of game.script?.telegraphs ?? []) {
    ctx.strokeStyle = hex(ACCENT, 0.65); ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
    ring(ctx, warning.x, warning.y, warning.radius); ctx.setLineDash([]);
    ctx.strokeStyle = hex(ACCENT, 0.3); ring(ctx, warning.x, warning.y, warning.radius + 6);
  }
  const motion = boss.motion;
  if (motion && game.tick < motion.fireTick) {
    ctx.strokeStyle = hex(DANGER, 0.5); ctx.setLineDash([9, 9]);
    if (motion.kind === 'charge') {
      ctx.lineWidth = 1;
      const a = Math.atan2(motion.to.y - motion.from.y, motion.to.x - motion.from.x), w = game.spec.look.size * 0.75;
      const ox = -Math.sin(a) * w, oy = Math.cos(a) * w;
      line(ctx, { x: motion.from.x + ox, y: motion.from.y + oy }, { x: motion.to.x + ox, y: motion.to.y + oy });
      line(ctx, { x: motion.from.x - ox, y: motion.from.y - oy }, { x: motion.to.x - ox, y: motion.to.y - oy });
      ctx.fillStyle = hex(DANGER, 0.06); ctx.beginPath(); ctx.moveTo(motion.from.x + ox, motion.from.y + oy); ctx.lineTo(motion.to.x + ox, motion.to.y + oy);
      ctx.lineTo(motion.to.x - ox, motion.to.y - oy); ctx.lineTo(motion.from.x - ox, motion.from.y - oy); ctx.closePath(); ctx.fill();
    } else { ctx.lineWidth = 1.5; ring(ctx, motion.to.x, motion.to.y, game.spec.look.size + 10); }
    ctx.setLineDash([]);
  }

  // Player shots: thin accent strokes.
  ctx.strokeStyle = hex(ACCENT, 0.75); ctx.lineWidth = 2;
  for (const shot of game.shots) line(ctx, shot, { x: shot.x - shot.vx * 0.02, y: shot.y - shot.vy * 0.02 });

  // Minions as hairline polygons with a measured HP bar.
  for (const minion of game.minions) {
    ctx.save(); ctx.translate(minion.x, minion.y); ctx.rotate(calm ? minion.angle : time + minion.angle);
    polygon(ctx, 13, minion.kind === 'turret' ? 4 : minion.kind === 'kamikaze' ? 3 : 6);
    ctx.fillStyle = '#0B0D10D0'; ctx.fill(); ctx.fillStyle = hex(main, 0.18); ctx.fill();
    ctx.strokeStyle = main; ctx.lineWidth = 1.3; ctx.stroke();
    circle(ctx, 0, 0, 3, game.spec.look.palette[1]!); ctx.restore();
    ctx.fillStyle = '#ECEBE526'; ctx.fillRect(minion.x - 14, minion.y + 20, 28, 2);
    ctx.fillStyle = main; ctx.fillRect(minion.x - 14, minion.y + 20, 28 * Math.max(0, minion.hp / minion.maxHp), 2);
  }

  // Boss and its leader-line label.
  if (game.status !== 'won') {
    drawBoss(ctx, game, calm ? 0 : time);
    // Leader line goes up-right, or down-right when the boss sits under the title block.
    const size = game.spec.look.size, lx = boss.x + size * 1.5, ly = boss.y - size * 1.25 < 112 ? boss.y + size * 1.25 : boss.y - size * 1.25;
    ctx.strokeStyle = '#ECEBE555'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(boss.x + size * 0.9, boss.y + Math.sign(ly - boss.y) * size * 0.75); ctx.lineTo(lx, ly); ctx.lineTo(lx + 28, ly); ctx.stroke();
    ctx.font = `10px ${MONO}`; ctx.fillStyle = '#ECEBE599'; ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(boss.x)}, ${Math.round(boss.y)}`, lx + 32, ly + 3);
  }

  // Bullets: cached sprites (bloom + keyline + core). Round bullets skip rotation.
  for (const bullet of game.bullets) {
    const sprite = bulletSprite(bullet.color, bullet.shape, bullet.radius, game.tick >= bullet.armedAt);
    if (bullet.shape === 'diamond' || bullet.shape === 'shard' || bullet.shape === 'capsule') {
      ctx.save(); ctx.translate(bullet.x, bullet.y); ctx.rotate(bullet.angle);
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2); ctx.restore();
    } else ctx.drawImage(sprite, bullet.x - sprite.width / 2, bullet.y - sprite.height / 2);
  }

  // Player: a precise reticle with the true hitbox.
  const player = game.player;
  if (!lobby && game.status !== 'lost') {
    ctx.save(); ctx.translate(player.x, player.y);
    ctx.globalAlpha = game.tick < player.invulnerableUntil && Math.floor(game.tick / 5) % 2 ? 0.35 : 1;
    const thrust = ctx.createRadialGradient(0, 14, 0, 0, 14, 20);
    thrust.addColorStop(0, hex(ACCENT, 0.35)); thrust.addColorStop(1, hex(ACCENT, 0));
    circle(ctx, 0, 14, 20, thrust);
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(10, 10); ctx.lineTo(0, 5); ctx.lineTo(-10, 10); ctx.closePath();
    ctx.fillStyle = '#0B0D10'; ctx.fill(); ctx.fillStyle = hex(ACCENT, 0.22); ctx.fill();
    ctx.strokeStyle = PAPER; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = hex(PAPER, player.focused ? 0.85 : 0.35); ctx.lineWidth = 1;
    const r = player.focused ? 22 : 26;
    for (let index = 0; index < 4; index++) {
      const a = index * Math.PI / 2 + Math.PI / 4;
      line(ctx, { x: Math.cos(a) * r, y: Math.sin(a) * r }, { x: Math.cos(a) * (r + 6), y: Math.sin(a) * (r + 6) });
    }
    if (player.focused) {
      ctx.setLineDash([2, 4]); ring(ctx, 0, 0, r); ctx.setLineDash([]);
      circle(ctx, 0, 0, PLAYER.radius + 2.5, INK); circle(ctx, 0, 0, PLAYER.radius, '#FFFFFF');
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 1; ring(ctx, 0, 0, PLAYER.radius + 2.5);
    } else circle(ctx, 0, 0, 2, ACCENT);
    ctx.restore();
  }

  // Shockwave rings and particles.
  for (const item of effects.rings) {
    if (item.age < 0) continue;
    const t = item.age / item.life, ease = 1 - (1 - t) ** 3;
    ctx.strokeStyle = hex(item.color, (1 - t) * 0.8); ctx.lineWidth = 1.5 - t;
    ring(ctx, item.x, item.y, 12 + ease * item.reach);
  }
  for (const particle of effects.particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife);
    ctx.fillStyle = particle.color; ctx.fillRect(particle.x - particle.radius / 2, particle.y - particle.radius / 2, particle.radius, particle.radius);
  }
  ctx.globalAlpha = 1;

  const darkness = activeModifiers(game).find((modifier) => modifier.kind === 'darkness');
  if (darkness?.kind === 'darkness') {
    const mask = ctx.createRadialGradient(player.x, player.y, 70, player.x, player.y, 300);
    mask.addColorStop(0, '#00000000'); mask.addColorStop(1, `rgba(0,0,0,${darkness.strength})`);
    ctx.fillStyle = mask; ctx.fillRect(-20, -20, width + 40, height + 40);
  }
  ctx.restore();

  // Phase sweep: a scan line crossing the sheet with its label.
  if (effects.sweep > 0) {
    const y = (1 - effects.sweep) * (height + 80) - 40;
    const band = ctx.createLinearGradient(0, y - 60, 0, y);
    band.addColorStop(0, hex(main, 0)); band.addColorStop(1, hex(main, 0.16));
    ctx.fillStyle = band; ctx.fillRect(0, y - 60, width, 60);
    ctx.strokeStyle = main; ctx.lineWidth = 1; line(ctx, { x: 0, y }, { x: width, y });
    ctx.font = `600 11px ${MONO}`; ctx.fillStyle = main; ctx.textAlign = 'right';
    ctx.fillText(`${effects.sweepLabel} ── PATTERN CHANGE`, width - 34, y - 8);
  }

  // HUD: a ruled title block, stable during screen shake.
  const hp = Math.max(0, game.boss.hp / game.spec.hp);
  ctx.fillStyle = '#07080ADD'; ctx.fillRect(40, 30, width - 80, 62);
  ctx.strokeStyle = '#ECEBE526'; ctx.lineWidth = 1; ctx.strokeRect(40.5, 30.5, width - 81, 61);
  line(ctx, { x: 40, y: 58.5 }, { x: width - 40, y: 58.5 });
  ctx.font = `600 12px ${SANS}`; ctx.fillStyle = PAPER; ctx.textAlign = 'left';
  ctx.fillText(game.spec.meta.name.toUpperCase(), 56, 49);
  const nameWidth = ctx.measureText(game.spec.meta.name.toUpperCase()).width;
  ctx.font = `10px ${MONO}`; ctx.fillStyle = '#ECEBE577';
  ctx.fillText(`/ BY @${game.spec.meta.creator}`, 66 + nameWidth, 49);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ECEBE5AA';
  ctx.fillText(`PHASE ${String(game.boss.phase + 1).padStart(2, '0')}/${String(game.spec.phases.length).padStart(2, '0')}   ${String(Math.ceil(game.boss.hp)).padStart(4, '0')} HP`, width - 56, 49);
  const barX = 56, barW = width - 112, barY = 72;
  ctx.fillStyle = '#ECEBE51A'; ctx.fillRect(barX, barY, barW, 4);
  ctx.fillStyle = main; ctx.fillRect(barX, barY, barW * hp, 4);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(barX + barW * hp - 1, barY - 3, 2, 10);
  for (let index = 0; index <= 20; index++) { ctx.fillStyle = '#ECEBE530'; ctx.fillRect(barX + barW * index / 20, barY + 7, 1, index % 5 ? 2 : 4); }
  for (const phase of game.spec.phases.slice(1)) {
    const x = barX + barW * phase.hpBelow;
    ctx.fillStyle = PAPER; ctx.fillRect(x - 0.5, barY - 4, 1, 12);
    ctx.font = `9px ${MONO}`; ctx.textAlign = 'center'; ctx.fillStyle = '#ECEBE588'; ctx.fillText(`${Math.round(phase.hpBelow * 100)}%`, x, barY + 18);
  }

  // Title-block footer.
  ctx.textAlign = 'left'; ctx.font = `10px ${MONO}`; ctx.fillStyle = '#ECEBE566';
  const seconds = Math.floor(game.tick / TICK_RATE);
  ctx.fillText(`FIG. 01 — ${game.spec.look.shape.toUpperCase()} · SEED ${game.seed} · T+${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, 40, height - 24);
  ctx.textAlign = 'right'; ctx.fillText(`${ARENA.width} × ${ARENA.height} / ${TICK_RATE} HZ / ${String(game.bullets.length).padStart(3, '0')} LIVE`, width - 40, height - 24);

  // End-of-fight treatment: the drawing is "signed off".
  if (effects.ended >= 0 && (game.status === 'won' || game.status === 'lost')) {
    const t = Math.min(1, effects.ended / 0.8);
    ctx.fillStyle = `rgba(7,8,10,${0.35 * t})`; ctx.fillRect(0, 0, width, height);
    if (game.status === 'won') {
      ctx.save(); ctx.translate(boss.x, boss.y); ctx.globalAlpha = 1 - t;
      ctx.setLineDash([4, 6]); ctx.strokeStyle = main; ring(ctx, 0, 0, game.spec.look.size * (1 + t)); ctx.setLineDash([]);
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  // Damage: a red frame bleed instead of a full-screen wash.
  if (effects.flash > 0) {
    const edge = ctx.createRadialGradient(width / 2, height / 2, height * 0.35, width / 2, height / 2, height * 0.85);
    edge.addColorStop(0, 'rgba(255,107,74,0)'); edge.addColorStop(1, `rgba(255,107,74,${effects.flash * 0.55})`);
    ctx.fillStyle = edge; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = `rgba(255,107,74,${effects.flash})`; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
  }
}
