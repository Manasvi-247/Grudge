// JSON-file persistence with atomic writes. The whole database is one pet.

import fs from 'node:fs';
import path from 'node:path';

export function loadState(file, fallbackFactory) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallbackFactory();
  }
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}
