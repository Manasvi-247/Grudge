# GRUDGE™

**A Tamagotchi that lives in your GitHub profile README.** Your commits are its food. Your CI is its immune system. Your neglect is its villain origin story.

- `git push` → it eats. It forgives you.
- Build fails → it gets **poisoned** and lets everyone know.
- 3 days without a commit → it **opens a passive-aggressive issue on your repo**
  (*"Are you okay? Asking for me, not for you."*)
- Day 5 → final issue: *"Estate planning (URGENT)"*
- Day ~7 → it dies. Publicly. Your README becomes its tombstone, epitaph included.

Death is permanent per generation. Hatch a new egg and it *remembers what you did to its predecessor*. The graveyard is displayed forever.

## Species & unlocks

Every egg is a dice roll — but only across species you've **earned**. Career progress (streaks, builds, survival records) persists across generations: your pets are mortal, your unlocks are not.

| Species | Signature color | How to get it | Vibe |
|---|---|---|---|
| commit gremlin | green | starter | born from a merge conflict, raised by spite |
| byte cat | orange | starter | knocks your uncommitted changes off the table |
| merge octopus | teal | starter | eight arms, still not allowed near prod |
| build bot | steel | pass 10 builds | speaks binary when hungry |
| fork bunny | white | commit 3 days in a row | multiplies your branches, you're welcome |
| zen capybara | brown | keep a pet alive for 7 days | unbothered, moisturized, ignoring your CI |
| startup unicorn | pink + gold horn | 10 commits in a single day | mythical, like your test coverage |

Thresholds live in `UNLOCKS` in [src/engine.js](src/engine.js) — one line each to tune. Each species has its own pixel sprite and personality lines; moods (hungry, sick, furious, dying) recolor any species. The graveyard records what each casualty was. Preview any sprite without touching your real pet: `/pet.svg?species=cat`.

## Quickstart

```bash
node src/server.js
# → dashboard:   http://localhost:4321
# → README card: http://localhost:4321/pet.svg
```

Zero dependencies. No install step. Node 18+.

Out of the box it runs in **demo mode**: the dashboard is a Tamagotchi device with simulator buttons (FEED / SHIP / BREAK / ⏩+12h time-warp) that fire the exact same internal events as real GitHub webhooks. Warp time forward and watch it spiral.

Pets hatch with a name from the pool (Pip, Bit, Nib…) — rename yours anytime via the NAME TAG box in the dashboard (16 chars). One rule: the dead keep their names. The graveyard is not up for revision.

## The mechanics

| Event | Effect |
|---|---|
| push (per commit) | +8 fullness, morale up, escalation resets |
| build passes | +5 health |
| build fails | −15 health, poisoned for 6h |
| time passing | −2 fullness/h; at 0 fullness, health drains |
| well fed (>50) | +1 health/h regen |

Abandonment ladder (hours since last commit): **24h** sighing loudly → **48h** drafting an issue… → **72h** issue #1 opened → **120h** final issue → **168h** gone.

Causes of death: starvation, build failures, abandonment. Each gets its own epitaph.

## Real mode

Copy `.env.example` → `.env`. Two ways in, use either or both:

1. **Polling (no deploy needed):** set `GITHUB_USERNAME` (+ optionally `GITHUB_TOKEN`). The server polls your GitHub activity every 90s; your real pushes feed the pet.
2. **Webhooks:** deploy anywhere (Fly, Railway, a $5 VPS) or tunnel (`cloudflared`, `smee.io`), point a repo/org webhook at `POST /webhook` with events `push` + `workflow_run`, set `WEBHOOK_SECRET` on both ends. Signatures are verified (HMAC SHA-256).

To let it **actually open issues**, set `GITHUB_TOKEN` (PAT with issues:write) and `GITHUB_ISSUE_REPO=you/some-repo`. Without those, issues are logged, not posted.

Embed in your profile README once deployed:

```md
![grudge](https://your-deployment.example.com/pet.svg)
```

## Architecture

```
GitHub (webhooks / polled events)          simulator buttons
              └──────────────┬──────────────────┘
                             ▼
                   engine.js  — pure state machine, lazy time decay,
                                escalation ladder, returns side-effects
                             ▼
                   server.js  — node:http, SSE live updates, effect
                                handler (logs issues in demo, posts in real)
                     ▼                    ▼
              pet.svg (dynamic       dashboard (Tamagotchi
              README card, CSS-      device, LCD screen,
              animated pixel art)    event log, graveyard)
```

Design choices worth stealing:

- **Zero runtime dependencies.** `node:http`, `node:crypto`, `node:fs`. Nothing to install, nothing to audit.
- **Lazy decay.** No cron: elapsed time is applied whenever state is touched, so the pet starves correctly even if the server was down for a day. A 60s heartbeat exists only so escalations fire while nobody's watching.
- **Engine purity.** `engine.js` does no I/O and never calls `Date.now()` — callers pass `now`. That's what makes the time-warp button and the whole test suite trivial.
- **One code path.** Simulator buttons, webhooks, and polling all produce the same internal events.

## Tests

```bash
npm test
```

Covers hatching, feeding caps, starvation math, build poisoning, the exactly-once issue escalation, death by all three causes, and generational inheritance.

## Roadmap

- [ ] Proper GitHub App (per-user installs, no PAT)
- [ ] Deploy + hosted multi-tenant mode (every dev gets a pet)
- [ ] Pet skins / species unlocked by streaks
- [ ] `workflow_run` details: flaky tests give it anxiety
