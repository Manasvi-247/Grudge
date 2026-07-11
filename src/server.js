// Grudge server. Zero dependencies: node:http all the way down.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newPet, applyEvent, tick, mood, ageDays, escalationLabel, STAGES, HOUR, UNLOCKS, newCareer, checkUnlocks } from './engine.js';
import { statusLine, reaction, issueFor } from './snark.js';
import { createStore } from './store.js';
import { verifySignature, parseWebhook, openIssue, pollUserEvents } from './github.js';
import { renderCard, renderScreen, SPECIES } from './svg.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---- config (.env is optional, real values only needed for real mode) ----
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const PORT = Number(process.env.PORT || 4321);
const { WEBHOOK_SECRET, GITHUB_TOKEN, GITHUB_USERNAME, GITHUB_ISSUE_REPO } = process.env;
const realIssues = Boolean(GITHUB_TOKEN && GITHUB_ISSUE_REPO);

// ---- state ----
// The store picks its backend at boot: KV if configured (serverless), disk if
// writable, in-memory as the loud last resort (read-only fs, e.g. Vercel
// without KV). Lazy decay means a stateless pet still behaves correctly
// within one process lifetime — it just forgets you on restart.
const store = await createStore(path.join(ROOT, 'data'));
let loadedData = { state: null, log: null };
try {
  loadedData = await store.load();
} catch (err) {
  console.error('state load failed, starting fresh:', err.message);
}
const state = loadedData.state ?? newPet(Date.now());
const logEntries = loadedData.log ?? [];
const persist = () => store.save(state, logEntries);
if (!state.species) state.species = 'gremlin'; // pets born before the species update
if (!state.career) {
  // pets born before the unlock update: grandfather in earned progress
  state.career = newCareer();
  state.career.buildsPassed = state.buildsPassed || 0;
  state.career.bestDays = Math.max(
    0,
    ...(state.graveyard ?? []).map((g) => g.days || 0),
    state.stage === 'alive' ? ageDays(state, Date.now() + (state.clockOffset || 0)) : 0
  );
  checkUnlocks(state); // boot-time unlocks are logged silently; UI reflects them
}
const now = () => Date.now() + (state.clockOffset || 0);

function pushLog(msg, kind = 'info') {
  logEntries.push({ ts: now(), msg, kind });
  if (logEntries.length > 300) logEntries.splice(0, logEntries.length - 300);
}
if (store.mode === 'memory') {
  pushLog('running STATELESS: read-only filesystem and no KV configured. state resets on restart — add a disk volume or set KV_REST_API_URL/KV_REST_API_TOKEN.', 'bad');
}

// ---- SSE ----
const clients = new Set();
function summary(reactionLine = null) {
  const t = now();
  return {
    name: state.name,
    species: state.species,
    speciesName: state.stage === 'egg' ? '??? (unhatched)' : (SPECIES[state.species]?.name ?? 'commit gremlin'),
    generation: state.generation,
    stage: state.stage,
    mood: mood(state, t),
    fullness: Math.round(state.fullness),
    health: Math.round(state.health),
    morale: Math.round(state.morale),
    ageDays: ageDays(state, t),
    totalCommits: state.totalCommits,
    buildsPassed: state.buildsPassed,
    buildsFailed: state.buildsFailed,
    roster: Object.entries(SPECIES).map(([key, { name }]) => ({
      key,
      name,
      unlocked: state.career.unlocked.includes(key),
      condition: UNLOCKS[key]?.label ?? null,
    })),
    career: {
      commitsToday: state.career.commitsToday,
      streak: state.career.streak,
      buildsPassed: state.career.buildsPassed,
      bestDays: state.career.bestDays,
    },
    escalation: state.escalation,
    escalationLabel: escalationLabel(state),
    stages: STAGES.map((s) => ({ at: s.at, label: s.label })),
    statusLine: statusLine(mood(state, t), state, t),
    epitaph: state.epitaph,
    cause: state.cause,
    graveyard: state.graveyard.map((g) => ({ ...g, speciesName: SPECIES[g.species]?.name ?? 'commit gremlin' })),
    warpedHours: Math.round((state.clockOffset || 0) / HOUR),
    reaction: reactionLine,
    log: logEntries.slice(-60).reverse(),
  };
}
function broadcast(reactionLine = null) {
  const data = `data: ${JSON.stringify(summary(reactionLine))}\n\n`;
  for (const res of clients) res.write(data);
}

// ---- effect processing: the engine decides, the server acts ----
async function handleEffects(effects) {
  let reactionLine = null;
  for (const effect of effects) {
    const line = reaction(effect, state);
    if (line) reactionLine = line;
    switch (effect.type) {
      case 'fed':
        pushLog(`fed: ${effect.commits} commit${effect.commits > 1 ? 's' : ''} from ${effect.repo ?? 'the simulator'} (+${effect.commits * 8} fullness)`, 'good');
        break;
      case 'build_ok':
        pushLog(`build passed on ${effect.repo ?? 'the simulator'} (+5 health)`, 'good');
        break;
      case 'build_fail':
        pushLog(`BUILD FAILED on ${effect.repo ?? 'the simulator'} (−15 health, poisoned 6h)`, 'bad');
        break;
      case 'hatched':
        pushLog(`${state.name} hatched. it is watching you now.`, 'issue');
        break;
      case 'hatched_new':
        pushLog(`gen ${state.generation} egg spawned. it inherited the graveyard. and the grudges.`, 'issue');
        break;
      case 'open_issue': {
        state._ageDays = ageDays(state, now());
        const issue = issueFor(effect.stage, state);
        if (realIssues) {
          try {
            const url = await openIssue({ token: GITHUB_TOKEN, repo: GITHUB_ISSUE_REPO, ...issue });
            pushLog(`ISSUE OPENED on ${GITHUB_ISSUE_REPO}: "${issue.title}" → ${url}`, 'issue');
          } catch (err) {
            pushLog(`tried to open an issue but GitHub refused: ${err.message}`, 'bad');
          }
        } else {
          pushLog(`[demo] ISSUE OPENED: "${issue.title}"`, 'issue');
        }
        break;
      }
      case 'died':
        pushLog(`☠ ${state.name} died (${effect.cause}). ${state.epitaph}`, 'death');
        break;
      case 'unlock':
        pushLog(`🔓 SPECIES UNLOCKED: ${SPECIES[effect.species]?.name ?? effect.species} — the gene pool expands`, 'issue');
        break;
      case 'renamed':
        pushLog(`📛 ${effect.from} is now ${effect.to} (it has opinions about this)`, 'info');
        break;
    }
  }
  return reactionLine;
}

async function handleEvent(event) {
  const effects = applyEvent(state, event, now());
  const reactionLine = await handleEffects(effects);
  persist();
  broadcast(reactionLine);
  return reactionLine;
}

// GitHub polling (real mode). The cursor is persisted in the pet state, so a
// restart doesn't skip events that happened while the server was down. Runs
// on an interval on long-lived hosts; on serverless, point a cron at
// GET /api/poll instead. Repeated identical failures are logged once.
let lastPollError = null;
async function pollGitHub() {
  if (!GITHUB_USERNAME) return 0;
  try {
    const { pushes, newest } = await pollUserEvents({ token: GITHUB_TOKEN, username: GITHUB_USERNAME, sinceId: state.lastEventId ?? null });
    if (newest && newest !== state.lastEventId) {
      state.lastEventId = newest;
      persist();
    }
    for (const push of pushes) await handleEvent(push);
    lastPollError = null;
    return pushes.length;
  } catch (err) {
    if (err.message !== lastPollError) {
      pushLog(`github poll failed: ${err.message}`, 'bad');
      lastPollError = err.message;
    }
    return 0;
  }
}

// ---- http plumbing ----
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) reject(new Error('body too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    // the product: the README embed. Every card view advances the clock and
    // fires due escalations — on serverless this IS the heartbeat.
    if (req.method === 'GET' && url.pathname === '/pet.svg') {
      const effects = tick(state, now());
      if (effects.length) {
        await handleEffects(effects);
        persist();
        broadcast();
      }
      // ?species=cat previews another sprite without touching the real pet
      const sp = url.searchParams.get('species');
      const view = sp && SPECIES[sp] ? { ...state, species: sp } : state;
      const svg = url.searchParams.get('mode') === 'screen' ? renderScreen(view, now()) : renderCard(view, now());
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache, max-age=0' });
      return res.end(svg);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const effects = tick(state, now());
      if (effects.length) {
        await handleEffects(effects);
        persist();
      }
      return json(res, 200, summary());
    }

    // for serverless crons: one poll + one tick per hit
    if (req.method === 'GET' && url.pathname === '/api/poll') {
      if (!GITHUB_USERNAME) return json(res, 400, { error: 'set GITHUB_USERNAME to enable polling' });
      const fed = await pollGitHub();
      const effects = tick(state, now());
      if (effects.length) await handleEffects(effects);
      persist();
      broadcast();
      return json(res, 200, { ok: true, fed, mood: mood(state, now()) });
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(summary())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // real webhooks from GitHub (push, workflow_run)
    if (req.method === 'POST' && url.pathname === '/webhook') {
      const raw = await readBody(req);
      if (!verifySignature(WEBHOOK_SECRET, raw, req.headers['x-hub-signature-256'])) {
        return json(res, 401, { error: 'bad signature. nice try.' });
      }
      const eventName = req.headers['x-github-event'];
      if (eventName === 'ping') return json(res, 200, { pong: 'the pet heard you' });
      const event = parseWebhook(eventName, JSON.parse(raw.toString('utf8') || '{}'));
      if (!event) return json(res, 202, { ignored: eventName });
      const r = await handleEvent(event);
      return json(res, 202, { ok: true, reaction: r });
    }

    // simulator endpoints — same code path as real webhooks
    if (req.method === 'POST' && url.pathname.startsWith('/api/dev/')) {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const action = url.pathname.slice('/api/dev/'.length);
      let r = null;
      if (action === 'feed') r = await handleEvent({ type: 'push', commits: body.commits || 1 });
      else if (action === 'rename') {
        if (state.stage === 'dead') return json(res, 400, { error: 'the dead keep their names.' });
        if (!String(body.name ?? '').trim()) return json(res, 400, { error: 'a pet with no name is just a process' });
        r = await handleEvent({ type: 'rename', name: body.name });
      }
      else if (action === 'build') r = await handleEvent({ type: 'build', ok: Boolean(body.ok) });
      else if (action === 'hatch') r = await handleEvent({ type: 'hatch' });
      else if (action === 'species') {
        // gene splicer: demo-only species swap; real eggs stay a dice roll
        if (!SPECIES[body.species]) return json(res, 404, { error: 'unknown species' });
        if (state.stage === 'dead') return json(res, 400, { error: 'necromancy is a different feature' });
        if (!state.career.unlocked.includes(body.species)) {
          return json(res, 403, { error: `locked. earn it: ${UNLOCKS[body.species]?.label}` });
        }
        tick(state, now());
        state.species = body.species;
        pushLog(`🧬 gene-spliced into a ${SPECIES[body.species].name} (demo)`, 'info');
        r = state.stage === 'egg' ? 'prenatal gene editing. bold. unethical. approved.' : 'new body. same grudges.';
        persist();
        broadcast(r);
        return json(res, 200, { ok: true, ...summary(r) });
      }
      else if (action === 'warp') {
        const hours = Math.max(1, Math.min(24 * 14, body.hours || 12));
        state.clockOffset = (state.clockOffset || 0) + hours * HOUR;
        pushLog(`⏩ time warped +${hours}h (demo)`, 'info');
        const effects = tick(state, now());
        r = await handleEffects(effects);
        persist();
        broadcast(r);
      } else return json(res, 404, { error: 'unknown lever' });
      return json(res, 200, { ok: true, ...summary(r) });
    }

    // static dashboard
    if (req.method === 'GET') {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const full = path.join(PUBLIC_DIR, path.normalize(file));
      if (full.startsWith(PUBLIC_DIR) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(full)] ?? 'text/plain' });
        return res.end(fs.readFileSync(full));
      }
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404. the pet ate this page.');
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

// background heartbeat: decay + escalations fire even when nobody's watching.
// (On serverless these intervals only run while an instance is warm — there,
// card views and the /api/poll cron carry the clock instead.)
setInterval(async () => {
  const effects = tick(state, now());
  if (effects.length) await handleEffects(effects);
  persist();
  broadcast();
}, 60_000);
// keep SSE connections alive through proxies
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25_000);

// optional real mode without a tunnel: poll your GitHub activity for pushes
if (GITHUB_USERNAME) {
  setInterval(pollGitHub, 90_000);
  pollGitHub();
  console.log(`polling GitHub activity for @${GITHUB_USERNAME} every 90s`);
}

server.listen(PORT, () => {
  console.log(`GRUDGE™ alive on http://localhost:${PORT}`);
  console.log(`  dashboard  http://localhost:${PORT}/`);
  console.log(`  README card http://localhost:${PORT}/pet.svg`);
  console.log(`  mode: ${realIssues ? `REAL (issues → ${GITHUB_ISSUE_REPO})` : 'demo (issues are logged, not posted)'}`);
});
