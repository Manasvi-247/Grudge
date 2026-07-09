// Grudge state machine.
// Pure functions only: no I/O, no Date.now() — callers always pass `now`.
// Decay is lazy: elapsed time is applied whenever the state is touched,
// so the pet starves correctly even if the server was asleep.

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const TUNING = {
  fullnessDecayPerHour: 2, // full -> empty in ~2 days
  starvingDamagePerHour: 1, // once empty, ~4 more days to death
  moraleDecayPerHour: 1,
  regenPerHour: 1, // health regen while well fed
  feedPerCommit: 8,
  buildPassHeal: 5,
  buildFailDamage: 15,
  poisonHours: 6,
};

// Abandonment escalation, in hours since the last commit.
export const STAGES = [
  { at: 24, key: 'grumble', label: 'sighing loudly' },
  { at: 48, key: 'drafting', label: 'drafting an issue…' },
  { at: 72, key: 'issue', label: 'ISSUE OPENED', effect: 'open_issue' },
  { at: 120, key: 'lastWords', label: 'writing your eulogy', effect: 'open_issue' },
  { at: 168, key: 'abandoned', label: 'gone', effect: 'die' },
];

const NAMES = ['Pip', 'Bit', 'Nib', 'Zed', 'Blob', 'Moss', 'Pyx', 'Grub'];

// Sprite/personality keys — grids live in svg.js, flavor lines in snark.js.
// Which species hatches is a dice roll you can't control: deterministic in
// (bornAt, generation) so it stays pure, but bornAt is a timestamp, so from
// the owner's perspective it's random. You get what you get.
export const SPECIES_KEYS = ['gremlin', 'cat', 'octo', 'robot', 'capybara', 'unicorn', 'bunny'];

const STARTERS = ['gremlin', 'cat', 'octo'];

// Achievements that expand the gene pool. Career stats survive death —
// your pets are mortal, your unlocks are not. Tune thresholds to taste.
export const UNLOCKS = {
  robot: { label: 'pass 10 builds', check: (c) => c.buildsPassed >= 10 },
  bunny: { label: 'commit 3 days in a row', check: (c) => c.streak >= 3 },
  capybara: { label: 'keep a pet alive for 7 days', check: (c) => c.bestDays >= 7 },
  unicorn: { label: '10 commits in a single day', check: (c) => c.commitsToday >= 10 },
};

export function newCareer() {
  return {
    day: 0, // day index commitsToday belongs to
    commitsToday: 0,
    streak: 0, // consecutive days with at least one commit
    lastCommitDay: 0,
    buildsPassed: 0, // lifetime, across generations
    bestDays: 0, // longest any pet has survived
    unlocked: [...STARTERS],
  };
}

export function checkUnlocks(state) {
  const effects = [];
  for (const [key, u] of Object.entries(UNLOCKS)) {
    if (!state.career.unlocked.includes(key) && u.check(state.career)) {
      state.career.unlocked.push(key);
      effects.push({ type: 'unlock', species: key });
    }
  }
  return effects;
}

const EPITAPHS = {
  starvation: (d) => `Starved on day ${d}. The commits were "coming tomorrow."`,
  build_failures: () => 'Poisoned by a broken build. The tests were red. So were my eyes.',
  abandonment: (d) => `Waited ${d} days by the webhook. You never pushed.`,
};

const clamp = (v) => Math.max(0, Math.min(100, v));

export function newPet(now, generation = 1, graveyard = [], career = newCareer()) {
  return {
    name: NAMES[(generation - 1) % NAMES.length],
    // the dice roll only covers what you've earned
    species: career.unlocked[Math.abs(now + generation * 7) % career.unlocked.length],
    career,
    generation,
    stage: 'egg', // egg | alive | dead
    bornAt: now,
    hatchedAt: null,
    lastTick: now,
    lastFedAt: now,
    fullness: 80,
    health: 100,
    morale: 70,
    escalation: 0, // how many STAGES have fired since last feed
    poisonedUntil: 0,
    totalCommits: 0,
    buildsPassed: 0,
    buildsFailed: 0,
    diedAt: null,
    cause: null,
    epitaph: null,
    clockOffset: 0, // demo time-warp, persisted so warps survive restarts
    graveyard,
  };
}

export function ageDays(state, now) {
  const born = state.hatchedAt ?? state.bornAt;
  const end = state.diedAt ?? now;
  return Math.max(1, Math.floor((end - born) / DAY) + 1);
}

function die(state, now, cause) {
  state.stage = 'dead';
  state.diedAt = now;
  state.cause = cause;
  state.health = 0;
  state.epitaph = EPITAPHS[cause](ageDays(state, now));
}

// Advance the clock. Returns an array of side-effects the caller must handle
// (e.g. {type:'open_issue'}) — the engine itself never talks to the network.
export function tick(state, now) {
  const effects = [];
  if (state.stage !== 'alive') {
    state.lastTick = now;
    return effects;
  }
  const h = Math.max(0, (now - state.lastTick) / HOUR);
  if (h > 0) {
    const hoursUntilEmpty = state.fullness / TUNING.fullnessDecayPerHour;
    const starveHours = Math.max(0, h - hoursUntilEmpty);
    state.fullness = clamp(state.fullness - h * TUNING.fullnessDecayPerHour);
    state.health = clamp(state.health - starveHours * TUNING.starvingDamagePerHour);
    state.morale = clamp(state.morale - h * TUNING.moraleDecayPerHour);
    if (starveHours === 0 && state.fullness > 50) {
      state.health = clamp(state.health + h * TUNING.regenPerHour);
    }
  }
  state.lastTick = now;
  state.career.bestDays = Math.max(state.career.bestDays, ageDays(state, now));
  effects.push(...checkUnlocks(state));

  const hoursSinceFed = (now - state.lastFedAt) / HOUR;
  while (state.escalation < STAGES.length && hoursSinceFed >= STAGES[state.escalation].at) {
    const stage = STAGES[state.escalation];
    state.escalation++;
    if (stage.effect === 'open_issue') effects.push({ type: 'open_issue', stage: stage.key });
    if (stage.effect === 'die') {
      die(state, now, 'abandonment');
      effects.push({ type: 'died', cause: 'abandonment' });
      return effects;
    }
  }

  if (state.health <= 0) {
    const cause = state.fullness <= 0 ? 'starvation' : 'build_failures';
    die(state, now, cause);
    effects.push({ type: 'died', cause });
  }
  return effects;
}

export function applyEvent(state, event, now) {
  const effects = tick(state, now);
  if (state.stage === 'dead' && event.type !== 'hatch') return effects; // corpses ignore input

  switch (event.type) {
    case 'push': {
      const commits = Math.max(1, event.commits | 0);
      if (state.stage === 'egg') {
        state.stage = 'alive';
        state.hatchedAt = now;
        state.lastTick = now;
        state.morale = 90;
        effects.push({ type: 'hatched' });
      }
      state.fullness = clamp(state.fullness + commits * TUNING.feedPerCommit);
      state.morale = clamp(state.morale + Math.min(25, 5 + commits * 4));
      state.lastFedAt = now;
      state.escalation = 0;
      state.totalCommits += commits;
      // career bookkeeping: daily count + streak
      const day = Math.floor(now / DAY);
      const c = state.career;
      if (c.day !== day) {
        c.day = day;
        c.commitsToday = 0;
      }
      c.commitsToday += commits;
      if (c.lastCommitDay === day - 1) c.streak += 1;
      else if (c.lastCommitDay !== day) c.streak = 1;
      c.lastCommitDay = day;
      effects.push({ type: 'fed', commits, repo: event.repo });
      effects.push(...checkUnlocks(state));
      break;
    }
    case 'build': {
      if (state.stage !== 'alive') break; // eggs are immune to CI
      if (event.ok) {
        state.health = clamp(state.health + TUNING.buildPassHeal);
        state.morale = clamp(state.morale + 6);
        state.buildsPassed++;
        state.career.buildsPassed++;
        effects.push({ type: 'build_ok', repo: event.repo });
        effects.push(...checkUnlocks(state));
      } else {
        state.health = clamp(state.health - TUNING.buildFailDamage);
        state.morale = clamp(state.morale - 12);
        state.poisonedUntil = now + TUNING.poisonHours * HOUR;
        state.buildsFailed++;
        effects.push({ type: 'build_fail', repo: event.repo });
        if (state.health <= 0) {
          die(state, now, 'build_failures');
          effects.push({ type: 'died', cause: 'build_failures' });
        }
      }
      break;
    }
    case 'rename': {
      // cosmetic, but it goes through the engine so corpses refuse it
      // (the dead keep their names — the graveyard is not up for revision)
      const name = String(event.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
      if (!name || name === state.name) break;
      effects.push({ type: 'renamed', from: state.name, to: name });
      state.name = name;
      break;
    }
    case 'hatch': {
      if (state.stage !== 'dead') break;
      state.graveyard.push({
        name: state.name,
        species: state.species,
        generation: state.generation,
        days: ageDays(state, state.diedAt),
        cause: state.cause,
        epitaph: state.epitaph,
        diedAt: state.diedAt,
      });
      const heir = newPet(now, state.generation + 1, state.graveyard, state.career);
      heir.clockOffset = state.clockOffset;
      Object.assign(state, heir); // mutate in place so callers keep their reference
      effects.push({ type: 'hatched_new', generation: state.generation });
      break;
    }
  }
  return effects;
}

// Display mood, in priority order.
export function mood(state, now) {
  if (state.stage === 'egg') return 'egg';
  if (state.stage === 'dead') return 'dead';
  if (state.health < 15) return 'dying';
  if (now < state.poisonedUntil || state.health < 40) return 'sick';
  if (state.escalation >= 2) return 'furious';
  if (state.fullness < 35) return 'hungry';
  if (state.morale > 75) return 'ecstatic';
  return 'content';
}

export function escalationLabel(state) {
  if (state.stage !== 'alive' || state.escalation === 0) return null;
  return STAGES[state.escalation - 1].label;
}
