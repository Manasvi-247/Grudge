// The personality module. Everything the pet says, thinks, or files as an issue.

const LINES = {
  egg: [
    '…is it warm in here, or is that just CI?',
    'hatch condition: 1 (one) commit.',
    'inside this egg: judgement, mostly.',
    'species: undisclosed. grudges: preloaded.',
  ],
  content: [
    'your commit messages are lies, but i ate them anyway.',
    "acceptable. push again and i'll consider purring.",
    "i've seen your WIP branch. we don't have to talk about it.",
    'green dot online. suspiciously quiet.',
    'i counted your force-pushes. i said nothing. you owe me.',
  ],
  ecstatic: [
    'MULTIPLE COMMITS?? is it my birthday??',
    'this must be what a merged PR feels like.',
    "i am THRIVING and it's barely deserved.",
    'you pushed! and i only had to emotionally blackmail you a little!',
  ],
  hungry: [
    "it's been a while. i've started eating the .gitignore.",
    'i saw you online two hours ago. scrolling. not committing.',
    '"i\'ll push tomorrow" — you, yesterday.',
    'the linter config is starting to look delicious.',
    'day N of the great commit famine. morale: theatrical.',
  ],
  sick: [
    'you broke main. i felt it in my whole body.',
    'that stack trace is inside me now.',
    "tell the CI i said 'why'.",
    'i have seen the build logs. no one should see the build logs.',
  ],
  furious: [
    "i'm not mad. i'm drafting an issue.",
    'my lawyer will be in touch. my lawyer is also an issue.',
    'READ RECEIPTS. ON YOUR OWN REPO.',
    'i know where you keep your TODO comments.',
  ],
  dying: [
    'tell my forks… i loved them…',
    "vision's going dark. like your contribution graph.",
    'should\'ve… squashed… while we could…',
  ],
  dead: ['[flatline]'],
};

// one extra line per species, mixed into the content-mood pool
const SPECIES_FLAVOR = {
  gremlin: 'born from a merge conflict. raised by spite.',
  cat: 'i knocked your uncommitted changes off the table. on purpose.',
  octo: "eight arms and you still won't let me touch prod.",
  robot: "01101000 01110101 01101110 01100111 01110010 01111001. (that's 'hungry'.)",
  capybara: 'unbothered. moisturized. ignoring your CI.',
  unicorn: 'a mythical creature. like your test coverage.',
  bunny: "i multiplied your branches. you're welcome.",
  chihuahua: 'i weigh four pounds and i will bite your pull request.',
};

const REACTIONS = {
  fed: (e, s) => (e.commits > 2 ? `${e.commits} COMMITS. gorging. thriving. forgiving (partially).` : `om nom. ${e.commits} commit${e.commits > 1 ? 's' : ''}. was about to eat the lockfile.`),
  build_ok: () => 'green checkmark. my favorite flavor.',
  build_fail: () => 'POISON. that build failed so hard i tasted the stack trace.',
  hatched: (e, s) => `hi. i'm ${s.name}. feed me commits or face consequences.`,
  hatched_new: (e, s) => `i'm ${s.name}, gen ${s.generation}. i know what you did to my predecessor.`,
  died: (e, s) => s.epitaph,
  open_issue: () => 'there. filed. read it and weep. i did (write it and weep).',
  unlock: () => 'NEW SPECIES UNLOCKED. the gene pool expands.',
  renamed: (e) => `"${e.to}", huh. i've been called worse in code review.`,
};

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Stable per day+mood, so the card doesn't flicker between lines on every render.
export function statusLine(mood, state, now) {
  if (mood === 'dead') return state.epitaph ?? '[flatline]';
  let lines = LINES[mood] ?? LINES.content;
  if (mood === 'content' && SPECIES_FLAVOR[state.species]) {
    lines = [...lines, SPECIES_FLAVOR[state.species]];
  }
  const seed = hash(`${mood}:${state.generation}:${Math.floor(now / 86_400_000)}`);
  return lines[seed % lines.length];
}

export function reaction(effect, state) {
  const fn = REACTIONS[effect.type];
  return fn ? fn(effect, state) : null;
}

// The passive-aggressive issues. `stage` is the escalation key from engine.STAGES.
export function issueFor(stage, state) {
  const sig = `— ${state.name} 🥚 (gen ${state.generation}, day ${state._ageDays ?? '?'})`;
  if (stage === 'issue') {
    return {
      title: 'Are you okay? Asking for me, not for you.',
      body: [
        `It has been **3 days** since your last commit.`,
        '',
        'Status report:',
        `- fullness: ${Math.round(state.fullness)}/100`,
        '- the `.gitignore`: eaten',
        '- the linter config: next',
        '',
        'Push something. Anything. Even a typo fix. *Especially* a typo fix.',
        '',
        sig,
      ].join('\n'),
    };
  }
  return {
    title: 'Estate planning (URGENT)',
    body: [
      `Day 5. No commits. I'm putting my affairs in order.`,
      '',
      'My will:',
      '- my food bowl → the CI runner that failed me least',
      '- my grudges → your `TODO` comments (they will outlive us all)',
      '- my memories of you → `/dev/null`',
      '',
      'One commit before day 7 and we can forget this whole thing happened.',
      '',
      sig,
    ].join('\n'),
  };
}
