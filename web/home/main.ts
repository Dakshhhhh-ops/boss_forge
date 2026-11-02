import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { TICK_RATE } from '../../engine/constants';
import { createDodger, dodge, type DodgerState } from '../../engine/dodger';
import { GATE_POLICY } from '../../engine/fairness-policy';
import { createGame, stepGame, type GameState } from '../../engine/simulation';
import { findWinningBot } from '../play/autopilot';
import { houseBosses } from '../play/house-bosses';
import { Effects, renderGame } from '../play/renderer';
import { codexSvg, twitchSvg } from '../shared/brand-marks';
import { forgeMarkSvg, specimenSvg } from '../shared/iso';

gsap.registerPlugin(ScrollTrigger, SplitText);

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/* ---------- Brand marks ---------- */
for (const el of document.querySelectorAll<HTMLElement>('[data-mark]')) el.innerHTML = el.dataset.mark === 'twitch' ? twitchSvg() : codexSvg();
for (const el of document.querySelectorAll<HTMLElement>('[data-forge-mark]')) el.innerHTML = forgeMarkSvg();

/* ---------- FIG. 01: the real engine, with the gate's reference bot playing ---------- */
const canvas = $<HTMLCanvasElement>('hero-arena');
const ctx = canvas.getContext('2d')!;
const SHOW_SECONDS = 25, SEED = GATE_POLICY.seeds[0]!;
const dots = [...$('arena-dots').children] as HTMLElement[];
const card = $('arena-card');
const botSeeds = new Map<number, number>();
let index = 0, game: GameState, bot: DodgerState, effects: Effects, shownFor = 0, accumulator = 0;

function load(next: number) {
  index = next % houseBosses.length;
  const spec = houseBosses[index]!;
  // The engine is deterministic: pick a bot seed that wins this exact fight, so the preview shows a good run.
  if (!botSeeds.has(index)) botSeeds.set(index, findWinningBot(spec, SEED));
  game = createGame(spec, SEED); bot = createDodger(botSeeds.get(index)!); effects = new Effects();
  shownFor = 0; accumulator = 0;
  const quote = `“${spec.meta.sourceQuote}”`;
  $('arena-count').textContent = `${String(index + 1).padStart(2, '0')} / ${String(houseBosses.length).padStart(2, '0')}`;
  $('card-kicker').textContent = `House boss ${String(index + 1).padStart(2, '0')} · ${spec.look.shape}`;
  $('card-name').textContent = spec.meta.name;
  $('card-quote').textContent = quote;
  $('foot-name').textContent = spec.meta.name;
  $('foot-quote').textContent = spec.meta.sourceQuote;
  dots.forEach((dot, i) => dot.classList.toggle('on', i === index));
  card.classList.remove('out'); card.classList.add('in');
  window.setTimeout(() => card.classList.add('out'), reduceMotion ? 0 : 1600);
}

function step(dt: number) {
  accumulator += dt; shownFor += dt;
  while (accumulator >= 1 / TICK_RATE) {
    stepGame(game, dodge(game, bot)); effects.consume(game); accumulator -= 1 / TICK_RATE;
    if (game.status === 'won' || game.status === 'lost') break;
  }
  effects.update(dt);
}

load(0);
if (reduceMotion) {
  // One still, mid-fight.
  for (let tick = 0; tick < TICK_RATE * 14; tick++) stepGame(game!, dodge(game!, bot!));
  renderGame(ctx, game!, 14, effects!, false);
} else {
  let visible = true, last = 0, endedAt = 0;
  new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; }, { threshold: 0.05 }).observe(canvas);
  const frame = (now: number) => {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    if (visible && !document.hidden) {
      step(dt);
      renderGame(ctx, game, now / 1000, effects, false);
      const over = game.status === 'won' || game.status === 'lost';
      if (over && !endedAt) endedAt = now;
      if (shownFor > SHOW_SECONDS || (endedAt && now - endedAt > 2200)) { endedAt = 0; load(index + 1); }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* ---------- Example request pipeline (clearly labelled as an example) ---------- */
const rows = [...document.querySelectorAll<HTMLElement>('#pipe li')];
const codexSteps = [...document.querySelectorAll<HTMLElement>('#pipe .steps span')];
if (reduceMotion) {
  rows.forEach((row) => row.classList.add('on'));
  codexSteps.forEach((s) => s.classList.add('done'));
} else {
  const timeline: [number, () => void][] = [
    [0, () => { rows.forEach((r) => r.classList.remove('on', 'live')); codexSteps.forEach((s) => s.classList.remove('done', 'live')); }],
    [400, () => rows[0]!.classList.add('on')],
    [1500, () => rows[1]!.classList.add('on')],
    [2600, () => rows[2]!.classList.add('on')],
    [3400, () => { rows[3]!.classList.add('on', 'live'); codexSteps[0]!.classList.add('live'); }],
    [4300, () => { codexSteps[0]!.classList.replace('live', 'done'); codexSteps[1]!.classList.add('live'); }],
    [5300, () => { codexSteps[1]!.classList.replace('live', 'done'); codexSteps[2]!.classList.add('live'); }],
    [6300, () => { codexSteps[2]!.classList.replace('live', 'done'); rows[3]!.classList.remove('live'); rows[4]!.classList.add('on'); }],
    [7400, () => rows[5]!.classList.add('on')],
  ];
  const run = () => { for (const [at, fn] of timeline) window.setTimeout(fn, at); };
  run(); window.setInterval(run, 11000);
}

/* ---------- Gate spec, straight from the policy the server enforces ---------- */
const spec: [string, string][] = [
  ['Seeded bot runs', String(GATE_POLICY.seeds.length)],
  ['Bot must win (beatable)', `≥ ${GATE_POLICY.minWins} / ${GATE_POLICY.seeds.length}`],
  ['Bot must lose (a challenge)', `≥ ${GATE_POLICY.seeds.length - GATE_POLICY.maxWins} / ${GATE_POLICY.seeds.length}`],
  ['Safe space, every half second', `≥ ${Math.round(GATE_POLICY.minSafeFraction * 100)}%`],
  ['Laser warning', `≥ ${GATE_POLICY.minTelegraphMs} ms`],
  ['Live bullets', `≤ ${GATE_POLICY.maxBullets}`],
  ['Time to kill', `${GATE_POLICY.minTtkSeconds} – ${GATE_POLICY.maxTtkSeconds} s`],
  ['p99 tick at 60 Hz', `≤ ${GATE_POLICY.tickBudgetMs.toFixed(1)} ms`],
];
$('spec-table').append(...spec.map(([term, value]) => {
  const row = document.createElement('div'); row.dataset.row = '';
  const dt = document.createElement('dt'), dd = document.createElement('dd');
  dt.textContent = term; dd.textContent = value; row.append(dt, dd); return row;
}));

/* ---------- Built-in bosses, from the checked-in specs ---------- */
const cards = $('boss-cards');
houseBosses.forEach((boss, i) => {
  const main = boss.look.palette[0] ?? '#cbf579';
  const el = document.createElement('article'); el.className = 'boss-card'; el.dataset.row = '';
  el.innerHTML = `<p class="fig"><span>0${i + 1}</span><span></span></p><div class="art">${specimenSvg(boss.look.shape, main, 110)}</div><h3></h3><blockquote></blockquote><p class="meta"><span><i class="swatch"></i></span><span></span><span></span></p>`;
  el.querySelector('.fig span:last-child')!.textContent = boss.look.shape.toUpperCase();
  el.querySelector('h3')!.textContent = boss.meta.name;
  el.querySelector('blockquote')!.textContent = `“${boss.meta.sourceQuote}”`;
  const [aura, hp, phases] = el.querySelectorAll<HTMLElement>('.meta span');
  (el.querySelector('.swatch') as HTMLElement).style.background = main;
  aura!.append(boss.look.aura);
  hp!.textContent = `${boss.hp.toLocaleString('en-US')} HP`;
  phases!.textContent = `${boss.phases.length} phases`;
  cards.append(el);
});

/* ---------- Masthead ---------- */
const mast = document.querySelector('.mast')!;
const mobileBar = document.querySelector('.mobile-bar')!, heroCta = document.querySelector('.hero .cta')!;
addEventListener('scroll', () => {
  mast.classList.toggle('is-stuck', scrollY > 8);
  // On phones the sticky "Enter the arena" bar appears once the hero button has scrolled away.
  mobileBar.classList.toggle('show', heroCta.getBoundingClientRect().bottom < 0);
}, { passive: true });

/* ---------- Motion ---------- */
if (!reduceMotion) {
  const row = document.querySelector<HTMLElement>('.ticker-row')!;
  row.innerHTML += row.innerHTML;
  gsap.fromTo(row, { xPercent: 0 }, { xPercent: -50, duration: 60, ease: 'none', repeat: -1 });

  document.fonts.ready.then(() => {
    const lines = SplitText.create('.hero-title .line', { type: 'words', mask: 'words' });
    root.classList.add('motion-ready');
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from(lines.words, { yPercent: 110, duration: 1.1, stagger: 0.045 }, 0.05)
      .from('.arena-fig', { y: 30, autoAlpha: 0, duration: 1.3 }, 0.15)
      .from('.hero .reveal', { y: 18, autoAlpha: 0, duration: 1, stagger: 0.1 }, 0.5);

    for (const heading of document.querySelectorAll('.sec-title, .finale-title')) {
      const split = SplitText.create(heading, { type: 'lines', mask: 'lines' });
      gsap.from(split.lines, { yPercent: 105, duration: 1.1, ease: 'power4.out', stagger: 0.08, scrollTrigger: { trigger: heading, start: 'top 85%' } });
    }
    for (const el of document.querySelectorAll('.beat')) {
      gsap.from(el.querySelectorAll('.beat-copy > *, .shot'), { y: 28, autoAlpha: 0, duration: 1, ease: 'power3.out', stagger: 0.08, scrollTrigger: { trigger: el, start: 'top 80%' } });
    }
    for (const group of document.querySelectorAll('.spec-table, .specimens, .cmd-list, .layers, .terminal')) {
      gsap.from(group.querySelectorAll('[data-row]'), { y: 24, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, scrollTrigger: { trigger: group, start: 'top 85%' } });
    }
    for (const el of document.querySelectorAll('.sec .reveal, .show-grid .shot')) {
      gsap.from(el, { y: 18, autoAlpha: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
    }
    ScrollTrigger.refresh();
  });
}
