import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import ember from '../../bosses/house/ember-anvil.json';
import neon from '../../bosses/house/neon-brood.json';
import prism from '../../bosses/house/prism-warden.json';
import serpent from '../../bosses/house/brass-serpent.json';
import { codexSvg, twitchSvg } from '../shared/brand-marks';
import { forgeMarkSvg, specimenSvg } from '../shared/iso';

gsap.registerPlugin(ScrollTrigger, SplitText);

const root = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Brand marks
for (const el of document.querySelectorAll<HTMLElement>('[data-mark]')) {
  el.innerHTML = el.dataset.mark === 'twitch' ? twitchSvg() : codexSvg();
}
for (const el of document.querySelectorAll<HTMLElement>('[data-forge-mark]')) el.innerHTML = forgeMarkSvg();

// House specimens, straight from the checked-in specs.
const cards = document.getElementById('boss-cards')!;
[ember, neon, prism, serpent].forEach((boss, index) => {
  const [main] = boss.look.palette;
  const card = document.createElement('article');
  card.className = 'boss-card';
  card.dataset.row = '';
  card.innerHTML = `<p class="fig"><span>FIG. 0${index + 2}</span><span></span></p>
    <div class="art">${specimenSvg(boss.look.shape, main ?? '#cbf579', 120)}</div>
    <h3></h3><blockquote></blockquote>
    <p class="meta"><span><i class="swatch"></i></span><span></span><span></span></p>`;
  card.querySelector('.fig span:last-child')!.textContent = boss.look.shape.toUpperCase();
  card.querySelector('h3')!.textContent = boss.meta.name;
  card.querySelector('blockquote')!.textContent = `“${boss.meta.sourceQuote}”`;
  const [aura, hp, phases] = card.querySelectorAll<HTMLElement>('.meta span');
  (card.querySelector('.swatch') as HTMLElement).style.background = main ?? '#cbf579';
  aura!.append(boss.look.aura);
  hp!.textContent = `${boss.hp.toLocaleString('en-US')} HP`;
  phases!.textContent = `${boss.phases.length} phases`;
  cards.append(card);
});

/* ---------- Isometric anvil drawing (hidden lines dashed) ---------- */
type V3 = [number, number, number];
const COS = Math.cos(Math.PI / 6), SIN = Math.sin(Math.PI / 6);
const project = ([x, y, z]: V3) => `${((x - y) * COS).toFixed(2)} ${((x + y) * SIN - z).toFixed(2)}`;

/** A convex prism from a footprint (x, y) at height z0..z1, rotated by theta. */
function solid(foot: [number, number][], z0: number, z1: number, theta: number) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const ring = foot.map(([x, y]) => [x * c - y * s, x * s + y * c] as [number, number]);
  const solidLines: string[] = [], hiddenLines: string[] = [];
  const seg = (a: V3, b: V3, visible: boolean) => (visible ? solidLines : hiddenLines).push(`M${project(a)}L${project(b)}`);
  const n = ring.length;
  // A side face is visible when its outward normal faces the viewer (+x +y in this projection).
  const faceVisible = ring.map((p, i) => {
    const q = ring[(i + 1) % n]!; const nx = q[1] - p[1], ny = -(q[0] - p[0]);
    return nx + ny > 0;
  });
  for (let i = 0; i < n; i++) {
    const p = ring[i]!, q = ring[(i + 1) % n]!, prev = faceVisible[(i - 1 + n) % n]!, cur = faceVisible[i]!;
    seg([p[0], p[1], z1], [q[0], q[1], z1], true);              // top face: always seen from above
    seg([p[0], p[1], z0], [q[0], q[1], z0], cur);               // bottom edge
    seg([p[0], p[1], z0], [p[0], p[1], z1], cur || prev);       // vertical edge
  }
  const faces = ring.map((p, i) => {
    if (!faceVisible[i]) return '';
    const q = ring[(i + 1) % n]!;
    return `M${project([p[0], p[1], z0])}L${project([q[0], q[1], z0])}L${project([q[0], q[1], z1])}L${project([p[0], p[1], z1])}Z`;
  }).join('');
  const top = `M${ring.map(([x, y]) => project([x, y, z1])).join('L')}Z`;
  return { solid: solidLines.join(''), hidden: hiddenLines.join(''), top, faces };
}
const rect = (w: number, d: number): [number, number][] => [[-w, -d], [w, -d], [w, d], [-w, d]];
const octagon = (r: number): [number, number][] => Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4 + Math.PI / 8) * r, Math.sin(i * Math.PI / 4 + Math.PI / 8) * r]);

const anvil = document.getElementById('anvil') as unknown as SVGSVGElement;
function drawAnvil(theta: number) {
  const parts = [
    solid(octagon(64), 0, 14, theta),          // plinth
    solid(rect(26, 20), 14, 52, theta),         // waist
    solid(rect(58, 26), 52, 76, theta),         // face
    solid(rect(14, 14), 76, 96, theta + Math.PI / 4), // the forged block on top
  ];
  const ground = Array.from({ length: 49 }, (_, i) => { const a = i / 48 * Math.PI * 2; return project([Math.cos(a) * 92, Math.sin(a) * 92, 0]); });
  anvil.innerHTML = `
    <path d="M${ground.join('L')}" stroke="var(--rule-strong)" stroke-dasharray="1 4"/>
    <path class="dim-line" d="M-104 0V-96M-108 0H-100M-108 -96H-100" />
    <text class="dim-text" x="-112" y="-46" transform="rotate(-90 -112 -46)" text-anchor="middle">H 96</text>
    ${parts.map((p) => `<path d="${p.hidden}" stroke="var(--text-3)" stroke-dasharray="2 3" stroke-width=".7"/>`).join('')}
    ${parts.map((p, i) => `<path d="${p.faces}" fill="var(--ink)" fill-opacity=".94"/><path d="${p.top}" fill="${i === 3 ? 'var(--accent)' : 'var(--sheet-2)'}" fill-opacity="${i === 3 ? '.9' : '1'}"/><path d="${p.solid}" stroke="${i === 3 ? 'var(--accent)' : 'var(--text)'}" stroke-width="1" stroke-linejoin="round"/>`).join('')}
    <circle cx="0" cy="0" r="2" fill="var(--accent)"/>
    <text class="dim-text" x="60" y="104">Ø 184 · PLINTH</text>`;
}
let theta = 0.35;
drawAnvil(theta);
if (!reduceMotion) {
  let last = performance.now(), visible = true;
  new IntersectionObserver(([entry]) => { visible = !!entry?.isIntersecting; }).observe(anvil);
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (visible && !document.hidden) { theta += dt * 0.22; drawAnvil(theta); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- Index: highlight the section in view ---------- */
const links = new Map([...document.querySelectorAll<HTMLAnchorElement>('.rail-index a')].map((a) => [a.hash.slice(1), a]));
const sectionObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    links.forEach((a, id) => a.classList.toggle('is-active', id === entry.target.id));
  }
}, { rootMargin: '-45% 0px -50% 0px' });
links.forEach((_, id) => { const el = document.getElementById(id); if (el) sectionObserver.observe(el); });

const topbar = document.querySelector('.topbar')!;
addEventListener('scroll', () => topbar.classList.toggle('is-stuck', scrollY > 8), { passive: true });

/* ---------- Motion ---------- */
if (!reduceMotion) {
  const row = document.querySelector<HTMLElement>('.ticker-row')!;
  row.innerHTML += row.innerHTML;
  gsap.fromTo(row, { xPercent: 0 }, { xPercent: -50, duration: 60, ease: 'none', repeat: -1 });

  document.fonts.ready.then(() => {
    const lines = SplitText.create('.hero-title .line', { type: 'words', mask: 'words' });
    root.classList.add('motion-ready');
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from('.rail-index li', { x: -16, autoAlpha: 0, stagger: 0.06, duration: 0.9 }, 0)
      .from('#anvil', { scale: 0.86, autoAlpha: 0, duration: 1.6 }, 0)
      .from(lines.words, { yPercent: 110, duration: 1.2, stagger: 0.05 }, 0.1)
      .from('.hero .reveal', { y: 18, autoAlpha: 0, duration: 1, stagger: 0.1 }, 0.7)
      .from('.cta', { y: 40, autoAlpha: 0, duration: 1 }, 0.9);

    for (const heading of document.querySelectorAll('.sec-title, .finale-title')) {
      const split = SplitText.create(heading, { type: 'lines', mask: 'lines' });
      gsap.from(split.lines, { yPercent: 105, duration: 1.1, ease: 'power4.out', stagger: 0.08, scrollTrigger: { trigger: heading, start: 'top 85%' } });
    }
    for (const group of document.querySelectorAll('.flow, .spec-table, .specimens, .cmd-list, .layers, .terminal')) {
      gsap.from(group.querySelectorAll('[data-row]'), { y: 24, autoAlpha: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07, scrollTrigger: { trigger: group, start: 'top 85%' } });
    }
    for (const el of document.querySelectorAll('.sec .reveal')) {
      gsap.from(el, { y: 18, autoAlpha: 0, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } });
    }
    ScrollTrigger.refresh();
  });
}
