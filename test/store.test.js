import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStore } from '../src/store.js';

const waitFor = async (fn, tries = 50) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
};

test('disk store: save/load roundtrip with atomic writes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grudge-store-'));
  const store = await createStore(dir);
  assert.equal(store.mode, 'disk');
  store.save({ name: 'Pip', fullness: 42 }, [{ msg: 'hello' }]);
  const { state, log } = await store.load();
  assert.equal(state.name, 'Pip');
  assert.equal(log[0].msg, 'hello');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unwritable filesystem falls back to memory mode', async () => {
  // /dev/null is a file, so mkdir beneath it must fail on any unix
  const store = await createStore('/dev/null/grudge-data');
  assert.equal(store.mode, 'memory');
  store.save({ name: 'Ghost' }, []); // must not throw
  const { state } = await store.load();
  assert.equal(state, null); // memory mode never resurrects anything
});

test('KV env vars select the kv store and roundtrip through REST', async () => {
  // a fake Upstash: POST / with ["SET"|"GET", key, value?] against a Map
  const db = new Map();
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-token') {
        res.writeHead(401);
        return res.end('{"error":"unauthorized"}');
      }
      const [op, key, value] = JSON.parse(body);
      let result = null;
      if (op === 'SET') {
        db.set(key, value);
        result = 'OK';
      } else if (op === 'GET') {
        result = db.get(key) ?? null;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.KV_REST_API_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.KV_REST_API_TOKEN = 'test-token';
  try {
    const store = await createStore('/irrelevant');
    assert.equal(store.mode, 'kv');
    store.save({ name: 'Cloud Pip', generation: 3 }, [{ msg: 'kv works' }]);
    assert.ok(await waitFor(() => db.has('grudge:state') && db.has('grudge:log')), 'save should reach the fake KV');
    const { state, log } = await store.load();
    assert.equal(state.name, 'Cloud Pip');
    assert.equal(log[0].msg, 'kv works');
  } finally {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    fake.close();
  }
});

test('KV saves coalesce bursts: last write wins', async () => {
  const writes = [];
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const [op, key, value] = JSON.parse(body);
      if (op === 'SET' && key === 'grudge:state') writes.push(JSON.parse(value).fullness);
      await new Promise((r) => setTimeout(r, 20)); // slow store forces coalescing
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"result":"OK"}');
    });
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.KV_REST_API_URL = `http://127.0.0.1:${fake.address().port}`;
  process.env.KV_REST_API_TOKEN = 'x';
  try {
    const store = await createStore('/irrelevant');
    for (let i = 1; i <= 10; i++) store.save({ fullness: i }, []);
    await waitFor(() => writes.length > 0 && writes[writes.length - 1] === 10);
    assert.equal(writes[writes.length - 1], 10, 'final snapshot must be the latest');
    assert.ok(writes.length < 10, `bursts should coalesce (got ${writes.length} writes for 10 saves)`);
  } finally {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    fake.close();
  }
});
