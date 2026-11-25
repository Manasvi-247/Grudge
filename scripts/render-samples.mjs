// Renders the sample cards embedded in the README to docs/.
// Deterministic: fixed timestamps, hand-posed states. Re-run after changing
// the sprite engine so the README never lies about what the product looks like.
//
//   node scripts/render-samples.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newPet, applyEvent, DAY } from '../src/engine.js';
import { renderCard } from '../src/svg.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'docs');
fs.mkdirSync(OUT, { recursive: true });

const T0 = 1_750_000_000_000; // fixed birthday so output is reproducible

function pose(species, name, fields = {}) {
  const p = newPet(T0);
  p.species = species;
  applyEvent(p, { type: 'push', commits: 3 }, T0); // hatch
  p.name = name;
  Object.assign(p, fields);
  return p;
}

const write = (file, svg) => {
  fs.writeFileSync(path.join(OUT, file), svg);
  console.log('wrote docs/' + file);
};

// Act I — thriving
write('card-hero.svg', renderCard(
  pose('gremlin', 'Pip', { fullness: 92, health: 100, morale: 88, totalCommits: 34, buildsFailed: 0 }),
  T0 + 1 * DAY
));

// Act II — hungry, escalation stage 1
write('card-hungry.svg', renderCard(
  pose('cat', 'Pip', { fullness: 22, health: 84, morale: 40, totalCommits: 34, escalation: 1 }),
  T0 + 3 * DAY
));

// Act III — furious, issue filed
write('card-furious.svg', renderCard(
  pose('octo', 'Pip', { fullness: 6, health: 51, morale: 12, totalCommits: 34, escalation: 3 }),
  T0 + 4 * DAY
));

// Act IV — the tombstone
write('card-dead.svg', renderCard(
  pose('gremlin', 'Pip', {
    stage: 'dead',
    diedAt: T0 + 8 * DAY,
    cause: 'starvation',
    epitaph: 'Starved on day 9. The commits were "coming tomorrow."',
    fullness: 0,
    health: 0,
  }),
  T0 + 9 * DAY
));

// Bonus — the mythical one, for the unlocks section
write('card-unicorn.svg', renderCard(
  pose('unicorn', 'Zed', { fullness: 100, health: 100, morale: 100, totalCommits: 128, generation: 4 }),
  T0 + 2 * DAY
));

// Bonus — four pounds of grievance
write('card-chihuahua.svg', renderCard(
  pose('chihuahua', 'Nib', { fullness: 90, health: 100, morale: 95, totalCommits: 57, generation: 2 }),
  T0 + 5 * DAY
));
