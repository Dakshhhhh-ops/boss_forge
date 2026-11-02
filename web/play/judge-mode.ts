/** Present the shared arena as a standalone public demo, without local server controls. */
export function showJudgeMode() {
  document.body.classList.add('judge-mode');
  document.title = 'Boss Forge · Play instantly';
  const home = document.querySelector<HTMLAnchorElement>('.wordmark');
  if (home) home.href = import.meta.env.BASE_URL;
  const nav = document.querySelector('nav');
  const source = document.createElement('a');
  source.href = 'https://github.com/ayushagarwalhere/boss_forge'; source.textContent = 'Source & live setup ↗';
  source.target = '_blank'; source.rel = 'noopener';
  nav?.replaceChildren(source);
  const badge = document.querySelector('.local'); if (badge) badge.textContent = 'HOUSE BOSS DEMO';
  const intro = document.getElementById('judge-intro'); if (intro) intro.hidden = false;
  const note = document.querySelector('.build-note');
  if (note) note.textContent = 'Original procedural art & synthesized sound. Built-in bosses run entirely in your browser.';
}
