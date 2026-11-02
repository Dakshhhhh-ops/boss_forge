# Judge arena and stream activity

Public arena: https://ayushagarwalhere.github.io/boss_forge/

Pick Ember Anvil, Neon Brood, Prism Warden or Brass Serpent, then click **Enter arena**. Move with WASD/arrows, hold Shift for slow focus, P/Escape to pause and R to reset. Autofire is on. The sound toggle enables original synthesized cues. Difficulty and seed controls work without a server. Keyboard or gamepad is required.

The public build is the shared deterministic arena with a standalone presentation. It does not connect to Twitch, call an API, generate bosses or open a WebSocket. House bosses stay labeled. The source link explains how to run the full live forge locally.

## Build and publish

1. Run `npm ci`, `npm run check`, `npm run build` and `npm run build:pages`.
2. Run `npm run preview:pages`, then open http://127.0.0.1:4173/boss_forge/. Check each boss, enter a fight, pause, reset and change difficulty. Confirm that no API/WebSocket requests occur.
3. Set repository **Settings → Pages → Source** to **GitHub Actions**. Push to `main` or `codex/m0-setup`, or run **Publish judge arena** manually. Only `dist/pages` is uploaded; the integrated server build remains separate in `dist/web`.
4. Wait for the deploy job to succeed, then open the public URL and test a fight. The Vite base is `/boss_forge/`; update it if deploying under a different repository name.

## Visible Codex work

Run the integrated server/demo and open `/overlay/` as a transparent 1920×1080 OBS browser source. The activity panel displays the current attempt out of three, reported artifact edits and named server gate checks. SDK file events only expose completed changes to `boss.json`, `boss.ts` and `gate-report.json` inside the job workspace. Failed/deleted changes never become successful edit claims. Shell commands and stdout are not published; shell-written files without an SDK edit event are not claimed as reported edits.

Gate badges come from the independent server report, after it revalidates the actual boss. An agent's local gate command does not produce a server pass badge. During revision, the previous report stays labeled with its attempt number. Replay edits say **CACHED REPLAY · NO LIVE CODEX**; the server still runs a fresh gate on that replay. No additional model calls are needed for activity display.
