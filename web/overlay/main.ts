import type { ForgeSnapshot, QueuedBoss } from '../../engine/forge-protocol';
import { createGame, type GameState } from '../../engine/simulation';
import { drawBoss } from '../play/renderer';
import { ForgeClient } from '../shared/forge-client';
import { forgeMarkSvg, specimenSvg } from '../shared/iso';
import { OverlayShowtime } from './showtime';
import { CHECK_LABELS, forgeProgress } from './progress';

const show = new OverlayShowtime();

function el<T extends HTMLElement = HTMLElement>(id: string) { const element = document.getElementById(id); if (!element) throw new Error(`Missing ${id}`); return element as T; }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className = '') { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; }
const canvas = el<HTMLCanvasElement>('portrait'), ctx = canvas.getContext('2d');
let portrait: GameState | null = null, cardKey = '', state: ForgeSnapshot | null = null;
el('brand-mark').innerHTML = forgeMarkSvg();
// Spec colors and shapes are schema-validated on the server; check again before building markup.
const safeColor = (value: string | undefined) => (value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#cbf579');
const provenance = (boss: QueuedBoss) => boss.mode === 'replay' ? 'CACHED REPLAY · NO LIVE CODEX' : boss.mode === 'codex' ? 'LIVE CODEX' : 'HOUSE FALLBACK';
function renderCard(boss: QueuedBoss | undefined, active: boolean) {
  const key = `${boss?.id ?? ''}:${active}`; if (key === cardKey) return; cardKey = key;
  el('card-label').textContent = !boss ? 'THE NEXT CHALLENGE' : active ? 'IN THE ARENA / CURRENT FIGHT' : 'UP NEXT / SERVER VERIFIED';
  el('boss-name').textContent = boss?.spec.meta.name ?? 'The forge is warming up.';
  el('creator').textContent = boss ? `FORGED FOR @${boss.spec.meta.creator}` : 'A good idea is all it takes.';
  el('quote').textContent = boss ? `“${boss.spec.meta.sourceQuote}”` : 'Describe a boss. Let the forge earn its place.';
  el('reading').replaceChildren(...(boss?.spec.meta.reading.map((text) => node('li', text)) ?? []));
  const origin = el('boss-origin'); origin.textContent = boss ? provenance(boss) : 'WAITING FOR VERIFIED BOSSES';
  origin.className = `origin${boss?.mode === 'codex' ? ' live' : boss?.mode === 'replay' ? ' replay' : ''}`;
  el('spec-mark').innerHTML = boss && /^[a-z]+$/.test(boss.spec.look.shape) ? specimenSvg(boss.spec.look.shape, safeColor(boss.spec.look.palette[0]), 34) : '';
  const gate = el('gate'); gate.hidden = !boss;
  if (boss) {
    const stats = [[`${boss.gate.wins}/5`, 'DODGER WINS'], [`${Math.round((boss.gate.safeFraction ?? 0) * 100)}%`, 'SAFE SPACE'], [`~${Math.round(boss.gate.ttkSeconds ?? 0)}s`, 'ESTIMATED TTK']];
    gate.replaceChildren(...stats.map(([value, label]) => { const block = node('div', ''); block.append(node('strong', value!), node('small', label!)); return block; }), node('p', `✓ SERVER VERIFIED · ${boss.gate.errors} ERRORS · STANDARD`, 'verified'));
    portrait = createGame(boss.spec, 17); portrait.boss.x = canvas.width / 2; portrait.boss.y = canvas.height / 2;
  } else portrait = null;
}
function renderToasts() {
  const latest = state?.toasts.filter((toast) => Date.now() - toast.at < 12000).slice(-3) ?? [];
  const container = el('toasts'), key = latest.map((toast) => toast.id).join('|');
  if (container.dataset.key === key) return; container.dataset.key = key;
  container.replaceChildren(...latest.map((toast) => { const item = node('div', '', `toast ${toast.kind}${toast.source === 'demo' ? ' demo' : ''}`); item.append(node('small', toast.source === 'demo' ? 'SIMULATED DEMO EVENT' : toast.source === 'twitch' ? 'TWITCH' : 'LOCAL FORGE'), node('div', toast.message)); return item; }));
}
const client = new ForgeClient((snapshot) => {
  state = snapshot;
  const mode = el('mode'); mode.textContent = snapshot.mode === 'replay' ? 'CACHED REPLAY · NO LIVE CODEX' : 'LIVE CODEX';
  mode.classList.toggle('replay', snapshot.mode === 'replay');
  el('twitch').textContent = snapshot.twitch.status === 'demo' ? 'SIMULATED CHAT · OFF' : snapshot.twitch.status === 'connected' ? `@${snapshot.twitch.channel} · ${snapshot.twitch.reward === 'active' ? 'POINTS + CHAT' : 'CHAT'}` : snapshot.twitch.status.toUpperCase();
  renderCard(snapshot.activeFight?.boss ?? snapshot.queue[0], !!snapshot.activeFight);
  el('queue-count').textContent = `${snapshot.queue.length} / 5`;
  el('queue').replaceChildren(...(snapshot.queue.length ? snapshot.queue.map((boss, index) => {
    const row = node('article', '', 'queue-row'), body = node('div', '');
    body.append(node('h3', boss.spec.meta.name), node('p', `@${boss.spec.meta.creator}`), node('small', `${boss.mode === 'replay' ? 'CACHED REPLAY' : boss.mode === 'house' ? 'HOUSE' : 'LIVE CODEX'} · VERIFIED ${boss.gate.wins}/5`, boss.mode === 'codex' ? 'live' : '')); row.append(node('span', String(index + 1).padStart(2, '0')), body); return row;
  }) : [node('p', 'The next verified boss lands here.', 'empty')]));
  const progress = forgeProgress(snapshot);
  el('activity').textContent = progress?.activity ?? (snapshot.jobs.some((job) => job.status === 'pending') ? 'Waiting for moderator approval.' : 'Ready for the next idea.');
  el('forge-progress').hidden = !progress;
  el('progress-files').textContent = progress?.files ?? '';
  el('progress-gate').textContent = progress?.gateLabel ?? '';
  el('progress-checks').replaceChildren(...(progress?.checks.map((check) => node('li', `${check.passed ? '✓' : '✕'} ${CHECK_LABELS[check.id]}`, check.passed ? 'pass' : 'fail')) ?? []));
  el('ticker').replaceChildren(...snapshot.events.slice(-3).reverse().map((event) => {
    const item = node('li', ''); item.append(node('span', `${event.mode === 'replay' ? 'CACHED' : event.mode.toUpperCase()} / ${event.phase.toUpperCase()}`, `tk${event.mode === 'codex' ? ' codex' : ''}`), node('span', event.message)); return item;
  }));
  renderToasts();
  show.render(snapshot);
}, (online) => { el('connection').textContent = online ? '● CONNECTED' : '○ OFFLINE · DISPLAY FROZEN'; el('overlay').classList.toggle('disconnected', !online); });
function resize() { document.documentElement.style.setProperty('--scale', String(Math.min(innerWidth / 1920, innerHeight / 1080))); }
resize(); window.addEventListener('resize', resize);
const timer = setInterval(() => {
  if (ctx) { ctx.clearRect(0, 0, canvas.width, canvas.height); if (portrait) { ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); const scale = Math.min(1, 33 / portrait.spec.look.size); ctx.scale(scale, scale); ctx.translate(-canvas.width / 2, -canvas.height / 2); drawBoss(ctx, portrait, performance.now() / 1000); ctx.restore(); } }
  renderToasts();
}, 100);
window.addEventListener('pagehide', () => { client.close(); clearInterval(timer); show.close(); });
