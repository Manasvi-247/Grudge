// Storage: one pet, three backends, picked automatically at boot.
//   kv     — Upstash / Vercel KV over plain REST (serverless deploys; zero deps)
//   disk   — default; JSON files with atomic writes
//   memory — read-only filesystems with no KV configured; state lives and
//            dies with the process, and the server says so loudly

import fs from 'node:fs';
import path from 'node:path';

const KEY_STATE = 'grudge:state';
const KEY_LOG = 'grudge:log';

function diskStore(dir) {
  const stateFile = path.join(dir, 'pet.json');
  const logFile = path.join(dir, 'pet.json.log');
  const write = (file, data) => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  const read = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  };
  return {
    mode: 'disk',
    async load() {
      return { state: read(stateFile), log: read(logFile) };
    },
    save(state, log) {
      write(stateFile, state);
      write(logFile, log);
    },
  };
}

function memoryStore() {
  return {
    mode: 'memory',
    async load() {
      return { state: null, log: null };
    },
    save() {},
  };
}

function kvStore(url, token) {
  const cmd = async (command) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`KV said ${res.status}: ${await res.text()}`);
    return (await res.json()).result;
  };

  // Saves are fire-and-forget and coalesced: during a burst only the latest
  // snapshot goes over the wire, and never more than one request in flight.
  let pending = null;
  let inflight = false;
  const flush = async () => {
    if (inflight || !pending) return;
    inflight = true;
    const { state, log } = pending;
    pending = null;
    try {
      await cmd(['SET', KEY_STATE, JSON.stringify(state)]);
      await cmd(['SET', KEY_LOG, JSON.stringify(log)]);
    } catch (err) {
      console.error('kv save failed:', err.message);
    } finally {
      inflight = false;
      if (pending) flush();
    }
  };

  return {
    mode: 'kv',
    async load() {
      const [state, log] = await Promise.all([cmd(['GET', KEY_STATE]), cmd(['GET', KEY_LOG])]);
      return { state: state ? JSON.parse(state) : null, log: log ? JSON.parse(log) : null };
    },
    save(state, log) {
      pending = { state, log };
      flush();
    },
  };
}

export async function createStore(dir) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return kvStore(url.replace(/\/$/, ''), token);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.rw-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return diskStore(dir);
  } catch {
    return memoryStore();
  }
}
