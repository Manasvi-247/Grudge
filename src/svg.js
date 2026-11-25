// SVG renderer. Two layouts from one sprite engine:
//   mode=card   → GitHub-dark README card (the product)
//   mode=screen → monochrome LCD for the dashboard's Tamagotchi shell
// CSS animations only (no JS) so the card stays alive inside <img> tags and
// GitHub's camo proxy.

import { mood as moodOf, ageDays, escalationLabel } from './engine.js';
import { statusLine } from './snark.js';

// ---- species roster ----------------------------------------------------
// 14×12 pixel grids. '.'=transparent o=outline b=body (face pixels are
// stamped onto 'b' cells at fixed coordinates, so every body shape must be
// solid around rows 3-7 / cols 2-11).
// Grid legend after stamping: E=eye u=tired-eye(half) M=mouth A=brow C=cheek
// s=speckle r=cross x=ghost-eye g=ghost-body n=nostril h=horn(always gold)
// p=inner-ear(always pink) q=snout(always rosy brown)

export const SPECIES = {
  gremlin: {
    name: 'commit gremlin',
    color: ['#7ee787', '#2ea043'],
    grid: [
      '..oo......oo..',
      '..obo....obo..',
      '.obbboooobbbo.',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      '.obbbbbbbbbbo.',
      '..obbo..obbo..',
      '...oo....oo...',
    ],
  },
  cat: {
    name: 'byte cat',
    color: ['#ffa657', '#bc4c00'],
    grid: [
      '.o..........o.',
      '.ob........bo.',
      '.obboooooobbo.',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      '.obbbbbbbbbbo.',
      '..obbo..obbo..',
      '...oo....oo...',
    ],
  },
  octo: {
    name: 'merge octopus',
    color: ['#76e3ea', '#1b7c8a'],
    grid: [
      '....oooooo....',
      '..oobbbbbboo..',
      '.obbbbbbbbbbo.',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      '.obbbbbbbbbbo.',
      '.ob.ob..ob.ob.',
      '..o..o...o..o.',
    ],
  },
  robot: {
    name: 'build bot',
    color: ['#b1bac4', '#545d68'],
    grid: [
      '......oo......',
      '......oo......',
      '.oooooooooooo.',
      '.obbbbbbbbbbo.',
      '.obbbbbbbbbbo.',
      '.obbbbbbbbbbo.',
      '.obbbbbbbbbbo.',
      '.obbbbbbbbbbo.',
      '.oooooooooooo.',
      '..obbo..obbo..',
      '..obbo..obbo..',
      '..oooo..oooo..',
    ],
  },
  capybara: {
    name: 'zen capybara',
    color: ['#d4a373', '#8a5a2b'],
    grid: [
      '..............',
      '.oo........oo.',
      '.obboooooobbo.',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbnnbbbbbo',
      '.obbbbbbbbbbo.',
      '..obbo..obbo..',
      '...oo....oo...',
    ],
  },
  unicorn: {
    name: 'startup unicorn',
    color: ['#f2b8d8', '#b0568c'],
    grid: [
      '......hh......',
      '....oohhoo....',
      '.obbbbbbbbbbo.',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      '.obbbbbbbbbbo.',
      '..obbo..obbo..',
      '...oo....oo...',
    ],
  },
  bunny: {
    name: 'fork bunny',
    color: ['#e6edf3', '#7d8590'],
    grid: [
      '..oo......oo..',
      '..obo....obo..',
      '..obo....obo..',
      '.obbboooobbbo.',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      '.obbbbbbbbbbo.',
      '..obbo..obbo..',
      '...oo....oo...',
    ],
  },
  chihuahua: {
    // all head, all ears, all attitude. no body was budgeted.
    name: 'yappy chihuahua',
    color: ['#f6f1ea', '#a8988a'],
    grid: [
      'oo..........oo',
      'opo........opo',
      'oppooooooooppo',
      'opbbbbbbbbbbpo',
      'obbbbbbbbbbbbo',
      'obbbbbqqbbbbbo',
      'obbbbbbbbbbbbo',
      'obbbbbbbbbbbbo',
      '.obbbbbbbbbbo.',
      '..obbbbbbbbo..',
      '...obbbbbbo...',
      '....oooooo....',
    ],
  },
};

// mood → face pixels stamped at [x, y, char]. Coordinates target the shared
// face zone; a stamp is skipped when the cell isn't body, so shapes that
// carve that spot (e.g. the robot's bezel) just don't get that pixel.
const EYES = [[3, 4, 'E'], [10, 4, 'E']];
const CHEEKS = [[2, 7, 'C'], [11, 7, 'C']];
const FACES = {
  content: [...EYES, [6, 6, 'M'], [7, 6, 'M'], ...CHEEKS],
  ecstatic: [...EYES, [3, 5, 'M'], [10, 5, 'M'], [4, 6, 'M'], [5, 6, 'M'], [6, 6, 'M'], [7, 6, 'M'], [8, 6, 'M'], [9, 6, 'M'], ...CHEEKS],
  hungry: [...EYES, [5, 5, 'M'], [6, 5, 'M'], [7, 5, 'M'], [8, 5, 'M'], [4, 6, 'M'], [9, 6, 'M']],
  sick: [...EYES, [3, 6, 'M'], [5, 6, 'M'], [7, 6, 'M'], [9, 6, 'M']],
  furious: [...EYES, [2, 3, 'A'], [3, 3, 'A'], [10, 3, 'A'], [11, 3, 'A'], [5, 6, 'M'], [6, 6, 'M'], [7, 6, 'M'], [8, 6, 'M']],
  dying: [[3, 4, 'u'], [10, 4, 'u'], [7, 6, 'M']],
};

const EGG = [
  '..............',
  '....oooooo....',
  '...obbbbbbo...',
  '..obbbbbbbbo..',
  '..obbsbbbsbo..',
  '.obbbbbbbbbbo.',
  '.obbsbbbbsbbo.',
  '.obbbbbbbbbbo.',
  '..obbbbbbbbo..',
  '..obbbbbbbbo..',
  '...obbbbbbo...',
  '....oooooo....',
];

const TOMB = [
  '....oooooo....',
  '...obbbbbbo...',
  '..obbbrrbbbo..',
  '..obbrrrrbbo..',
  '..obbbrrbbbo..',
  '..obbbrrbbbo..',
  '..obbbbbbbbo..',
  '..obbbbbbbbo..',
  '..obbbbbbbbo..',
  '..obbbbbbbbo..',
  '.oooooooooooo.',
  'oooooooooooooo',
];

const GHOST = [
  '..gggg..',
  '.gggggg.',
  '.gxggxg.',
  '.gggggg.',
  '.g.gg.g.',
];

// moods that override the species' signature color
const MOOD_COLORS = {
  hungry: ['#e3b341', '#9e6a03'],
  sick: ['#b19cd9', '#6e40aa'],
  furious: ['#ff7b72', '#b62324'],
  dying: ['#8b949e', '#484f58'],
  dead: ['#8b949e', '#484f58'], // tombstone
  egg: ['#e6edf3', '#6e7681'],
};

function speciesOf(state) {
  return SPECIES[state.species] ?? SPECIES.gremlin;
}

function colorsFor(mood, species) {
  return MOOD_COLORS[mood] ?? species.color;
}

function stampFace(grid, mood) {
  const rows = grid.map((r) => [...r]);
  for (const [x, y, ch] of FACES[mood] ?? []) {
    if (rows[y]?.[x] === 'b') rows[y][x] = ch;
  }
  return rows.map((r) => r.join(''));
}

function spriteFor(mood, species) {
  if (mood === 'egg') return EGG;
  if (mood === 'dead') return TOMB;
  return stampFace(species.grid, mood);
}

function renderGrid(grid, px, { body, outline, dark = '#0d1117', lcd = null, speckle = null }) {
  // LCD mode is monochrome: body pixels are ink, face/detail pixels are "off"
  // (transparent) so features stay visible against the pale screen.
  const colors = {
    b: lcd ?? body,
    o: lcd ?? outline,
    E: lcd ? null : dark,
    M: lcd ? null : dark,
    A: lcd ? null : dark,
    u: lcd ? null : dark,
    C: lcd ? null : '#ff9bce',
    s: lcd ? null : speckle ?? '#8b949e',
    r: lcd ? null : '#30363d',
    g: lcd ?? '#c9d1d9',
    x: lcd ? null : dark,
    n: lcd ? null : outline,
    h: lcd ?? '#e3b341', // unicorn horn stays gold through every mood
    p: lcd ? null : '#f4a6a0', // chihuahua inner ears stay pink, even furious
    q: lcd ? null : '#b5655a', // chihuahua snout
  };
  let out = '';
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = colors[ch];
      if (ch === '.' || !fill) return;
      const half = ch === 'u';
      out += `<rect x="${x * px}" y="${y * px + (half ? px / 2 : 0)}" width="${px}" height="${half ? px / 2 : px}" fill="${fill}"${ch === 'E' || ch === 'x' ? ' class="eye"' : ''}/>`;
    });
  });
  return out;
}

function bar(x, y, w, value, color, label, textColor) {
  const segs = 10;
  const segW = (w - (segs - 1) * 2) / segs;
  const filled = Math.round((value / 100) * segs);
  let out = `<text x="${x}" y="${y + 8}" class="lbl" fill="${textColor}">${label}</text>`;
  for (let i = 0; i < segs; i++) {
    out += `<rect x="${x + 42 + i * (segW + 2)}" y="${y}" width="${segW}" height="9" rx="2" fill="${i < filled ? color : '#21262d'}"/>`;
  }
  return out;
}

const statColor = (v) => (v > 50 ? '#39d353' : v > 20 ? '#e3b341' : '#f85149');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ANIM = `
  .pet { animation: bounce 2.2s ease-in-out infinite; transform-origin: center; }
  .pet.fast { animation-duration: 0.9s; }
  .pet.wobble { animation: wobble 3s ease-in-out infinite; }
  .pet.still { animation: none; }
  .eye { animation: blink 4.5s infinite; }
  .ghost { animation: float 3.5s ease-in-out infinite; }
  @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  @keyframes wobble { 0%,100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
  @keyframes blink { 0%, 92%, 100% { opacity: 1; } 95% { opacity: 0; } }
  @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
`;

function petClass(mood) {
  if (mood === 'ecstatic') return 'pet fast';
  if (mood === 'sick') return 'pet wobble';
  if (mood === 'dying' || mood === 'dead' || mood === 'egg') return 'pet still';
  return 'pet';
}

export function renderCard(state, now) {
  const species = speciesOf(state);
  const m = moodOf(state, now);
  const [body, outline] = colorsFor(m, species);
  const px = 8;
  const grid = spriteFor(m, species);
  const days = ageDays(state, now);
  const status = statusLine(m, state, now);
  const warn = escalationLabel(state);
  const dead = m === 'dead';
  const egg = m === 'egg';

  const spriteX = 26;
  const spriteY = dead ? 40 : 44;
  // positioning group wraps animation group — CSS transform animations would
  // otherwise override the SVG transform attribute and yeet the sprite to 0,0
  let sprite = `<g transform="translate(${spriteX},${spriteY})">
    <ellipse cx="${(14 * px) / 2}" cy="${12 * px + 6}" rx="44" ry="6" fill="#010409" opacity="0.6"/>
    <g class="${petClass(m)}">${renderGrid(grid, px, { body, outline, speckle: egg ? species.color[0] : null })}</g>
  </g>`;
  if (dead) {
    sprite += `<g transform="translate(${spriteX + 96},${spriteY - 22})" opacity="0.75"><g class="ghost">${renderGrid(GHOST, 5, { body: '#c9d1d9', outline: '#c9d1d9' })}</g></g>`;
  }

  const meta = egg
    ? `??? · gen ${state.generation} · unhatched`
    : `${species.name} · gen ${state.generation} · day ${days}${dead ? ` · ☠ ${esc(state.cause ?? '')}` : ''}`;

  const rx = 176; // right column x
  let right = `<text x="${rx}" y="52" class="name">${esc(state.name)}</text>
    <text x="${rx}" y="70" class="meta">${esc(meta)}</text>`;

  if (dead) {
    right += `<text x="${rx}" y="104" class="rip">R.I.P.</text>
      <text x="${rx}" y="126" class="status">${esc(status)}</text>`;
  } else {
    right += bar(rx, 88, 250, state.fullness, statColor(state.fullness), 'FUL', '#8b949e');
    right += bar(rx, 104, 250, state.health, statColor(state.health), 'HP', '#8b949e');
    right += bar(rx, 120, 250, state.morale, '#a371f7', 'MOOD', '#8b949e');
    right += `<text x="${rx}" y="152" class="status">“${esc(status)}”</text>`;
  }
  if (warn && !dead) {
    right += `<text x="${rx}" y="172" class="warn">⚠ ${esc(warn)}</text>`;
  } else {
    right += `<text x="${rx}" y="172" class="meta">${state.totalCommits} commits eaten · ${state.buildsFailed} poisonings</text>`;
  }

  return `<svg width="480" height="192" viewBox="0 0 480 192" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="grudge">
  <style>
    text { font-family: 'Courier New', ui-monospace, monospace; }
    .name { fill: #e6edf3; font-size: 20px; font-weight: bold; }
    .meta { fill: #8b949e; font-size: 11px; }
    .lbl { fill: #8b949e; font-size: 10px; font-weight: bold; }
    .status { fill: #c9d1d9; font-size: 12px; font-style: italic; }
    .warn { fill: #e3b341; font-size: 12px; font-weight: bold; }
    .rip { fill: #f85149; font-size: 22px; font-weight: bold; letter-spacing: 4px; }
    .brand { fill: #30363d; font-size: 9px; letter-spacing: 2px; }
    ${ANIM}
  </style>
  <rect x="1" y="1" width="478" height="190" rx="12" fill="#0d1117" stroke="#30363d" stroke-width="2"/>
  <text x="26" y="26" class="brand">GRUDGE™</text>
  ${sprite}
  ${right}
</svg>`;
}

export function renderScreen(state, now) {
  const species = speciesOf(state);
  const m = moodOf(state, now);
  const px = 12;
  const grid = spriteFor(m, species);
  const days = ageDays(state, now);
  const INK = '#232d1b';
  const dead = m === 'dead';

  const miniBar = (x, label, value) => {
    let out = `<text x="${x}" y="216" class="lcd-lbl">${label}</text>`;
    for (let i = 0; i < 5; i++) {
      const on = i < Math.round((value / 100) * 5);
      out += `<rect x="${x + 16 + i * 9}" y="208" width="7" height="9" fill="${INK}" opacity="${on ? 1 : 0.15}"/>`;
    }
    return out;
  };

  let bottom;
  if (dead) {
    bottom = `<text x="120" y="216" text-anchor="middle" class="lcd-lbl">R.I.P. ${esc(state.name).toUpperCase()} · GEN ${state.generation}</text>`;
  } else if (m === 'egg') {
    bottom = `<text x="120" y="216" text-anchor="middle" class="lcd-lbl">AWAITING FIRST COMMIT…</text>`;
  } else {
    bottom = miniBar(14, 'F', state.fullness) + miniBar(94, 'H', state.health) + miniBar(174, 'M', state.morale);
  }

  return `<svg width="240" height="240" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
  <style>
    .lcd-lbl { font-family: 'Courier New', ui-monospace, monospace; font-size: 11px; font-weight: bold; fill: ${INK}; }
    ${ANIM}
  </style>
  <rect width="240" height="240" fill="#b9c9a1"/>
  <g opacity="0.05">${Array.from({ length: 20 }, (_, i) => `<line x1="0" y1="${i * 12}" x2="240" y2="${i * 12}" stroke="#000"/>`).join('')}</g>
  <text x="14" y="26" class="lcd-lbl">DAY ${days}</text>
  <text x="226" y="26" text-anchor="end" class="lcd-lbl">GEN ${state.generation}</text>
  <g transform="translate(36,46)"><g class="${petClass(m)}">${renderGrid(grid, px, { body: '', outline: '', lcd: INK })}</g></g>
  ${dead ? `<g transform="translate(168,52)"><g class="ghost">${renderGrid(GHOST, 6, { body: '', outline: '', lcd: INK })}</g></g>` : ''}
  ${bottom}
</svg>`;
}
