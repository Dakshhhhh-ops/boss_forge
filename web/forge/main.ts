import type { ForgeEvent, ForgeJob, ForgeSnapshot } from '../../engine/forge-protocol';
import { ForgeClient } from '../shared/forge-client';
import { forgeMarkSvg, specimenSvg } from '../shared/iso';
import { animateNewChildren, mountPlatformBadge, playEntrance } from '../shared/motion';
import { ShowtimePanel } from './showtime-panel';

function el<T extends HTMLElement>(id: string): T { const element = document.getElementById(id); if (!element) throw new Error(`Missing ${id}`); return element as T; }
function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
}
function chip(id: string, label: string, tone: '' | 'is-live' | 'is-warn' | 'is-twitch') {
  const element = el(id); element.className = `chip ${tone}`.trim(); element.textContent = label;
}
/** Spec colours are schema-checked server-side; this keeps innerHTML safe even if that ever changes. */
const safeColor = (value: string | undefined) => (value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#cbf579');
function specimen(shape: string, color: string | undefined, size: number) {
  const holder = node('span', 'fc-specimen'); holder.innerHTML = specimenSvg(shape, safeColor(color), size); return holder;
}

el('forge-mark').innerHTML = forgeMarkSvg();
el('hero-mark').innerHTML = forgeMarkSvg();
const message = el('form-message');
const client = new ForgeClient(render, (online) => {
  const connection = el('connection'); connection.className = `local chip ${online ? 'is-live' : 'is-warn'}`;
  connection.replaceChildren(node('i', `dot${online ? ' pulse' : ''}`), document.createTextNode(online ? ' Local connection' : ' Reconnecting'));
});
let activeId: string | null = null;
const showtime = new ShowtimePanel(el('showtime'), (path, body) => action(path, body));
async function action(path: string, data: unknown) {
  try { await client.post(path, data); message.textContent = ''; }
  catch (error) { message.textContent = error instanceof Error ? error.message : 'Local action failed.'; }
}

const SOURCE = { codex: ['Codex', 'is-live'], replay: ['Replay', 'is-warn'], server: ['Server', ''] } as const;
const STEPS = [['reading', 'Read'], ['writing', 'Write'], ['testing', 'Test'], ['verifying', 'Verify'], ['queued', 'Queue']] as const;
const STEP_OF: Record<ForgeEvent['phase'], number> = { request: -1, review: -1, reading: 0, writing: 1, testing: 2, revising: 1, verifying: 3, queued: 4, failed: -2, fight: 4 };
const STATUS_TONE: Record<string, string> = { queued: 'is-live', building: 'is-live', verifying: 'is-live', pending: 'is-warn', waiting: '', failed: 'is-bad', rejected: 'is-bad', finished: '' };

function eventSource(event: ForgeEvent, jobs: Map<string, ForgeJob>) {
  const job = jobs.get(event.jobId);
  if (event.phase === 'request' && job?.source === 'twitch') return ['Twitch', 'is-twitch'] as const;
  return SOURCE[event.mode];
}

/** "Now forging" strip: the job being built, its attempt and where it is in the pipeline. */
function renderNow(state: ForgeSnapshot) {
  const job = state.jobs.find((entry) => entry.status === 'building' || entry.status === 'verifying');
  const live = el('ticker-live');
  if (!job) {
    live.className = 'chip'; live.replaceChildren(node('i', 'dot'), document.createTextNode(' Idle'));
    const waiting = state.jobs.filter((entry) => entry.status === 'waiting').length, pending = state.jobs.filter((entry) => entry.status === 'pending').length;
    el('now').replaceChildren(node('p', 'fc-now-idle', pending ? `${pending} request${pending === 1 ? '' : 's'} waiting for your approval below.` : waiting ? `${waiting} approved request${waiting === 1 ? '' : 's'} queued for the forge.` : 'The forge is idle. The next approved idea starts here.'));
    return;
  }
  live.className = `chip ${job.mode === 'replay' ? 'is-warn' : 'is-live'}`;
  live.replaceChildren(node('i', 'dot pulse'), document.createTextNode(job.mode === 'replay' ? ' Replaying' : ' Codex working'));
  const last = [...state.events].reverse().find((event) => event.jobId === job.id);
  const step = last ? STEP_OF[last.phase] : 0;
  const head = node('div', 'fc-now-head');
  const who = node('div', 'fc-now-who');
  who.append(node('p', 't-label', `${job.rematch ? `Rematch patch · MK ${job.rematch.generation}` : 'Now forging'} · @${job.creator}`), node('p', 'fc-now-quote', `“${job.text}”`));
  const attempt = node('div', 'fc-attempt');
  attempt.append(node('span', 't-label', 'Attempt'), node('strong', 't-num', `${Math.max(1, job.attempt)}`), node('span', 't-num', '/ 3'));
  head.append(who, attempt);
  const steps = node('ol', 'fc-steps');
  STEPS.forEach(([, label], index) => {
    const li = node('li', index < step ? 'done' : index === step ? 'current' : '');
    li.append(node('span', 't-num', String(index + 1).padStart(2, '0')), node('span', '', label));
    steps.append(li);
  });
  const mode = node('p', 'fc-now-mode t-mono', job.mode === 'replay' ? 'CACHED REPLAY · no live Codex generation · server re-verifies' : `LIVE CODEX · isolated workspace${job.threadId ? ` · thread ${job.threadId.slice(0, 13)}…` : ''}`);
  el('now').replaceChildren(head, steps, mode);
}

function render(state: ForgeSnapshot) {
  showtime.render(state);
  const jobsById = new Map(state.jobs.map((job) => [job.id, job]));

  chip('mode-chip', state.mode === 'replay' ? 'Cached replay' : 'Live Codex', state.mode === 'replay' ? 'is-warn' : 'is-live');
  el('mode-banner').textContent = state.mode === 'replay'
    ? 'No live Codex generation. Recorded house templates are replayed, then independently reverified by the server.'
    : 'The agent writes boss.json in a restricted workspace. The server independently verifies every boss before queueing.';
  chip('twitch-chip', state.twitch.status === 'demo' ? 'Simulated viewers' : `Twitch ${state.twitch.status}`, state.twitch.status === 'demo' ? 'is-warn' : state.twitch.status === 'connected' ? 'is-twitch' : '');
  el('twitch-status').textContent = `${state.twitch.channel && state.twitch.status !== 'demo' ? `@${state.twitch.channel} · ` : ''}${state.twitch.message} · ${state.twitch.reward === 'active' ? 'Channel Points enabled.' : 'Channel Points inactive.'}`;
  chip('moderation-chip', state.moderationMode === 'api' ? 'API moderation' : 'Manual review', state.moderationMode === 'api' ? 'is-live' : 'is-warn');
  el('moderation-status').textContent = state.moderationMode === 'api'
    ? 'Request text is checked before admission. Flagged or failed checks are not admitted.'
    : 'No API moderation. Viewer requests always need approval; simulated demo ideas are preapproved.';
  el('chat-source').textContent = state.demo ? 'Simulated viewers' : state.twitch.status === 'connected' ? 'Twitch + local' : 'Local requests';
  el('integration-toasts').replaceChildren(...state.toasts.slice(-3).reverse().map((toast) => {
    const row = node('p', `fc-toast ${toast.kind}`); row.append(node('span', 't-label', toast.source === 'demo' ? 'Demo' : toast.kind), document.createTextNode(toast.message)); return row;
  }));

  renderNow(state);

  el('ticker').replaceChildren(...[...state.events].reverse().slice(0, 30).map((event) => {
    const [label, tone] = eventSource(event, jobsById);
    const li = node('li', `phase-${event.phase}`);
    li.dataset.seq = String(event.seq);
    const meta = node('div', 'fc-tick-meta');
    meta.append(node('span', 't-num', String(event.seq).padStart(3, '0')), node('time', 't-num', new Date(event.at).toLocaleTimeString([], { hour12: false })));
    const body = node('div', 'fc-tick-body');
    body.append(node('span', `chip ${tone}`.trim(), label), node('span', 'fc-tick-phase', event.phase), node('span', 'fc-tick-msg', event.message));
    li.append(meta, body); return li;
  }));
  if (!state.events.length) el('ticker').replaceChildren(node('li', 'empty', 'Reading → writing → testing → independent verification → queue.'));

  el('job-count').textContent = `${state.jobs.length} request${state.jobs.length === 1 ? '' : 's'}`;
  const priority = (status: string) => ['building', 'verifying'].includes(status) ? 0 : status === 'pending' ? 1 : status === 'waiting' ? 2 : 3;
  const jobs = [...state.jobs].sort((a, b) => priority(a.status) - priority(b.status) || b.createdAt - a.createdAt).slice(0, 15).map((job, index) => {
    const article = node('article', `job status-${job.status}`);
    const main = node('div', 'job-main');
    const top = node('div', 'job-top');
    top.append(node('span', 'job-user', `@${job.creator}`), node('span', `chip job-status ${STATUS_TONE[job.status] ?? ''}`.trim(), job.status));
    main.append(top, node('blockquote', '', job.text));
    const details = node('dl', 'job-details');
    const add = (term: string, value: string) => { details.append(node('dt', '', term), node('dd', '', value)); };
    add('Mode', `${job.mode === 'replay' ? 'Cached replay' : 'Live Codex'} · ${job.source === 'demo' ? 'simulated viewer' : job.source}`);
    add('Attempt', `${job.attempt}/3`);
    add('Review', job.moderation === 'api' ? 'API moderation passed' : job.moderation === 'demo' ? 'Trusted simulated idea · no API moderation' : job.moderation === 'rematch' ? `Rematch patch · MK ${job.rematch?.generation ?? 2} of ${job.rematch?.previousName ?? 'a verified boss'}` : 'Manual review · no API moderation');
    add('Status', job.message);
    if (job.gate && job.message !== job.gate.summary) add('Gate', job.gate.summary);
    if (job.threadId) add('Thread', job.threadId);
    if (job.status === 'pending') add('Chat', `!approve ${job.id}`);
    // Full details only where the streamer may act or Codex is working; the rest stay one line.
    if (['pending', 'building', 'verifying', 'failed'].includes(job.status)) main.append(details);
    else main.append(node('p', 'job-oneline', `${job.mode === 'replay' ? 'Cached replay' : 'Live Codex'} · attempt ${job.attempt}/3 · ${job.gate && job.message !== job.gate.summary ? job.gate.summary : job.message}`));
    article.append(node('span', 'n t-num', String(index + 1).padStart(2, '0')), main);
    if (job.status === 'pending') {
      const controls = node('div', 'job-actions');
      for (const approve of [true, false]) {
        const button = node('button', approve ? 'btn btn-accent' : 'btn', approve ? 'Approve' : 'Reject');
        button.addEventListener('click', () => { void action('review', { id: job.id, approve }); }); controls.append(button);
      }
      article.append(controls);
    }
    return article;
  });
  el('jobs').replaceChildren(...(jobs.length ? jobs : [node('p', 'empty', 'Waiting for an idea. Simulated viewers arrive automatically in demo mode.')]));

  el('queue-count').textContent = `${state.queue.length} / 5`;
  el('queue').replaceChildren(...(state.queue.length ? state.queue.map((boss, index) => {
    const card = node('article', 'queue-card');
    const text = node('div', '');
    text.append(node('h3', '', boss.spec.meta.name), node('p', 'creator', `@${boss.spec.meta.creator} · ${boss.mode === 'replay' ? 'cached replay' : boss.mode === 'house' ? 'house boss' : 'live Codex'}`), node('p', 'verified t-mono', boss.gate.summary));
    card.append(node('span', 'n t-num', String(index + 1).padStart(2, '0')), specimen(boss.spec.look.shape, boss.spec.look.palette[0], 44), text);
    return card;
  }) : [node('p', 'empty', 'Verified bosses land here. House bosses fill the gaps.')]));

  el('chat').replaceChildren(...[...state.chat].reverse().slice(0, 15).map((chat) => {
    const p = node('p', ''); p.append(node('strong', '', `@${chat.creator}`), document.createTextNode(chat.text)); return p;
  }));
  if (!state.chat.length) el('chat').replaceChildren(node('p', 'empty', 'Waiting for boss requests.'));

  activeId = state.activeFight?.id ?? null;
  const fight = el('active-fight');
  if (state.activeFight) {
    const boss = state.activeFight.boss.spec; fight.className = 'fc-fight';
    const text = node('div', ''); text.append(node('h3', '', boss.meta.name), node('p', 'creator', `Forged for @${boss.meta.creator}`), node('p', 't-mono verified', `Seed ${state.activeFight.seed}`));
    fight.replaceChildren(specimen(boss.look.shape, boss.look.palette[0], 56), text);
  } else { fight.className = 'fc-fight empty'; fight.textContent = 'No fight active.'; }
  el('skip-fight').hidden = !activeId;
}
el<HTMLFormElement>('request-form').addEventListener('submit', (event) => {
  event.preventDefault(); const button = el<HTMLButtonElement>('submit-request'); button.disabled = true;
  void client.post('requests', { creator: el<HTMLInputElement>('creator').value, text: el<HTMLTextAreaElement>('description').value })
    .then(() => { message.textContent = 'Request received. Approve it below if review is required.'; el<HTMLTextAreaElement>('description').value = ''; })
    .catch((error: unknown) => { message.textContent = error instanceof Error ? error.message : 'Request failed.'; })
    .finally(() => { button.disabled = false; });
});
el('skip-fight').addEventListener('click', () => { if (activeId) void action('finish', { id: activeId, outcome: 'skipped' }); });
window.addEventListener('pagehide', () => { client.close(); showtime.close(); });

// Page motion: only rows the forge hasn't shown before animate in.
mountPlatformBadge();
playEntrance('.fc-status, .forge-panel');
const text = (e: Element): string => e.textContent ?? '';
animateNewChildren(el('ticker'), (e) => (e as HTMLElement).dataset.seq ?? text(e), { y: -14, autoAlpha: 0, duration: 0.6, ease: 'power3.out' });
animateNewChildren(el('chat'), text, { x: 16, autoAlpha: 0, duration: 0.5, ease: 'power3.out' });
animateNewChildren(el('queue'), (e) => e.querySelector('h3')?.textContent ?? text(e), { y: 18, autoAlpha: 0, duration: 0.7, ease: 'expo.out' });
animateNewChildren(el('jobs'), (e) => `${e.querySelector('.job-user')?.textContent}|${e.querySelector('blockquote')?.textContent}`, { y: 18, autoAlpha: 0, duration: 0.6, ease: 'expo.out' });
