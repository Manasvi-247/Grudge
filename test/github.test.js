import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { translateUserEvent, verifySignature } from '../src/github.js';

test('PushEvent feeds with its commit count', () => {
  const ev = { type: 'PushEvent', payload: { size: 3 }, repo: { name: 'Manasvi-247/Grudge' } };
  assert.deepEqual(translateUserEvent(ev), { type: 'push', commits: 3, repo: 'Manasvi-247/Grudge' });
});

test('initial push to a new repo (default-branch CreateEvent) counts as one commit', () => {
  const ev = {
    type: 'CreateEvent',
    payload: { ref: 'main', ref_type: 'branch', master_branch: 'main' },
    repo: { name: 'Manasvi-247/Grudge' },
  };
  assert.deepEqual(translateUserEvent(ev), { type: 'push', commits: 1, repo: 'Manasvi-247/Grudge' });
});

test('feature-branch CreateEvent is ignored (its commits arrive as a PushEvent)', () => {
  const ev = {
    type: 'CreateEvent',
    payload: { ref: 'feature/snacks', ref_type: 'branch', master_branch: 'main' },
    repo: { name: 'Manasvi-247/Grudge' },
  };
  assert.equal(translateUserEvent(ev), null);
});

test('tags, repo creations, and stars do not feed the pet', () => {
  assert.equal(translateUserEvent({ type: 'CreateEvent', payload: { ref: 'v1.0', ref_type: 'tag', master_branch: 'main' } }), null);
  assert.equal(translateUserEvent({ type: 'CreateEvent', payload: { ref: null, ref_type: 'repository', master_branch: 'main' } }), null);
  assert.equal(translateUserEvent({ type: 'WatchEvent', payload: {} }), null);
});

test('webhook signatures verify and reject (HMAC SHA-256)', () => {
  const secret = 's3cret';
  const body = Buffer.from('{"zen":"capybara"}');
  const good = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.ok(verifySignature(secret, body, good));
  assert.ok(!verifySignature(secret, body, 'sha256=' + '0'.repeat(64)));
  assert.ok(!verifySignature(secret, body, undefined));
  assert.ok(verifySignature(undefined, body, undefined)); // no secret configured → local dev
});
