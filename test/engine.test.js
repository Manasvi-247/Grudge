import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newPet, applyEvent, tick, mood, HOUR, DAY, SPECIES_KEYS } from '../src/engine.js';

const T0 = 1_000_000_000_000;

test('egg hatches on first push and gets fed', () => {
  const pet = newPet(T0);
  assert.equal(pet.stage, 'egg');
  const effects = applyEvent(pet, { type: 'push', commits: 2 }, T0 + HOUR);
  assert.equal(pet.stage, 'alive');
  assert.ok(effects.some((e) => e.type === 'hatched'));
  assert.ok(effects.some((e) => e.type === 'fed'));
  assert.equal(pet.totalCommits, 2);
});

test('eggs do not starve or escalate', () => {
  const pet = newPet(T0);
  const effects = tick(pet, T0 + 10 * DAY);
  assert.equal(effects.length, 0);
  assert.equal(pet.stage, 'egg');
  assert.equal(pet.fullness, 80);
});

test('feeding caps fullness at 100', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 50 }, T0);
  assert.equal(pet.fullness, 100);
});

test('fullness decays over time and starvation drains health', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 3 }, T0); // hatch, fullness 100
  tick(pet, T0 + 50 * HOUR); // 100 / 2 per hour → empty at exactly 50h
  assert.equal(pet.fullness, 0);
  const healthAtEmpty = pet.health;
  tick(pet, T0 + 60 * HOUR); // 10 starving hours
  assert.ok(pet.health < healthAtEmpty, 'starvation should drain health');
});

test('failed builds poison, enough of them kill', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 3 }, T0);
  applyEvent(pet, { type: 'build', ok: false }, T0 + 1);
  assert.equal(pet.health, 85);
  assert.equal(mood(pet, T0 + 2), 'sick'); // poisoned status
  let effects = [];
  for (let i = 0; i < 6; i++) effects = applyEvent(pet, { type: 'build', ok: false }, T0 + 2 + i);
  assert.equal(pet.stage, 'dead');
  assert.equal(pet.cause, 'build_failures');
  assert.ok(effects.some((e) => e.type === 'died'));
});

test('72h of neglect opens an issue, exactly once', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 5 }, T0);
  const effects = tick(pet, T0 + 73 * HOUR);
  const issues = effects.filter((e) => e.type === 'open_issue');
  assert.equal(issues.length, 1);
  // ticking again must not re-fire the same stage
  const again = tick(pet, T0 + 74 * HOUR);
  assert.equal(again.filter((e) => e.type === 'open_issue').length, 0);
});

test('pushing resets the escalation ladder', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 5 }, T0);
  tick(pet, T0 + 50 * HOUR);
  assert.ok(pet.escalation > 0);
  applyEvent(pet, { type: 'push', commits: 1 }, T0 + 51 * HOUR);
  assert.equal(pet.escalation, 0);
});

test('total neglect eventually kills, with an epitaph', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 5 }, T0);
  const effects = tick(pet, T0 + 200 * HOUR);
  assert.equal(pet.stage, 'dead');
  assert.ok(effects.some((e) => e.type === 'died'));
  assert.ok(pet.epitaph.length > 0);
});

test('hatching after death spawns the next generation with a graveyard', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 5 }, T0);
  tick(pet, T0 + 200 * HOUR); // dies
  const effects = applyEvent(pet, { type: 'hatch' }, T0 + 201 * HOUR);
  assert.equal(pet.stage, 'egg');
  assert.equal(pet.generation, 2);
  assert.equal(pet.graveyard.length, 1);
  assert.equal(pet.graveyard[0].generation, 1);
  assert.ok(effects.some((e) => e.type === 'hatched_new'));
});

test('every pet hatches with a species from the roster, deterministically', () => {
  const pet = newPet(T0);
  assert.ok(SPECIES_KEYS.includes(pet.species));
  assert.equal(newPet(T0).species, pet.species); // same birth moment → same roll
  const rolled = new Set([0, 1, 2, 3].map((i) => newPet(T0 + i).species));
  assert.ok(rolled.size > 1, 'different birth moments should roll different species');
});

test('graveyard records the species of the deceased', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 5 }, T0);
  const species = pet.species;
  tick(pet, T0 + 200 * HOUR); // dies
  applyEvent(pet, { type: 'hatch' }, T0 + 201 * HOUR);
  assert.equal(pet.graveyard[0].species, species);
  assert.ok(SPECIES_KEYS.includes(pet.species)); // heir rolled its own
});

test('new pets only hatch from unlocked species', () => {
  const pet = newPet(T0);
  assert.ok(pet.career.unlocked.includes(pet.species));
  assert.ok(!pet.career.unlocked.includes('unicorn')); // locked at birth
});

test('10 commits in a single day unlocks the unicorn', () => {
  const pet = newPet(T0);
  const effects = applyEvent(pet, { type: 'push', commits: 10 }, T0 + HOUR);
  assert.ok(effects.some((e) => e.type === 'unlock' && e.species === 'unicorn'));
  assert.ok(pet.career.unlocked.includes('unicorn'));
});

test('commits spread across days do NOT unlock the unicorn', () => {
  const pet = newPet(T0);
  for (let d = 0; d < 5; d++) applyEvent(pet, { type: 'push', commits: 6 }, T0 + d * DAY);
  assert.ok(!pet.career.unlocked.includes('unicorn'));
});

test('a 3-day commit streak unlocks the fork bunny', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 6 }, T0);
  applyEvent(pet, { type: 'push', commits: 6 }, T0 + DAY);
  assert.ok(!pet.career.unlocked.includes('bunny'));
  const effects = applyEvent(pet, { type: 'push', commits: 6 }, T0 + 2 * DAY);
  assert.ok(effects.some((e) => e.type === 'unlock' && e.species === 'bunny'));
});

test('a gap resets the streak', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 6 }, T0);
  applyEvent(pet, { type: 'push', commits: 6 }, T0 + DAY);
  applyEvent(pet, { type: 'push', commits: 6 }, T0 + 3 * DAY); // skipped a day
  assert.equal(pet.career.streak, 1);
});

test('10 passing builds unlock the build bot', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 1 }, T0);
  let effects = [];
  for (let i = 0; i < 10; i++) effects = applyEvent(pet, { type: 'build', ok: true }, T0 + i + 1);
  assert.ok(effects.some((e) => e.type === 'unlock' && e.species === 'robot'));
});

test('surviving 7 days unlocks the zen capybara', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 6 }, T0);
  for (let d = 1; d <= 8; d++) applyEvent(pet, { type: 'push', commits: 6 }, T0 + d * DAY);
  assert.equal(pet.stage, 'alive');
  assert.ok(pet.career.unlocked.includes('capybara'));
});

test('unlocks survive death and expand the hatch pool', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 10 }, T0); // unicorn unlocked
  tick(pet, T0 + 300 * HOUR); // dies of neglect
  applyEvent(pet, { type: 'hatch' }, T0 + 301 * HOUR);
  assert.ok(pet.career.unlocked.includes('unicorn'));
  assert.ok(pet.career.unlocked.includes(pet.species)); // heir rolled from unlocks
});

test('renaming works while alive, and trims/caps the name', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 1 }, T0);
  const effects = applyEvent(pet, { type: 'rename', name: '  Sir   Segfault the Unmergeable  ' }, T0 + 1);
  assert.ok(effects.some((e) => e.type === 'renamed'));
  assert.equal(pet.name, 'Sir Segfault the'); // collapsed whitespace, 16-char cap
});

test('the dead keep their names', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 1 }, T0);
  tick(pet, T0 + 300 * HOUR); // dies
  const nameAtDeath = pet.name;
  applyEvent(pet, { type: 'rename', name: 'Lazarus' }, T0 + 301 * HOUR);
  assert.equal(pet.name, nameAtDeath);
});

test('corpses ignore food (no zombie feeding)', () => {
  const pet = newPet(T0);
  applyEvent(pet, { type: 'push', commits: 5 }, T0);
  tick(pet, T0 + 200 * HOUR);
  applyEvent(pet, { type: 'push', commits: 10 }, T0 + 201 * HOUR);
  assert.equal(pet.stage, 'dead');
});
