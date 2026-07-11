const $ = (s) => document.querySelector(s);
const petImg = $('#pet');
const cardImg = $('#card');

let bubbleTimer = null;
let lastStatus = '…';

function setBubble(text, sticky = false) {
  $('#bubble').textContent = text;
  if (sticky) {
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => { $('#bubble').textContent = lastStatus; }, 6000);
  }
}

function vitalColor(v) {
  return v > 50 ? '#39d353' : v > 20 ? '#e3b341' : '#f85149';
}

function render(s) {
  // screens
  const bust = Date.now();
  petImg.src = `/pet.svg?mode=screen&t=${bust}`;
  cardImg.src = `/pet.svg?t=${bust}`;
  $('#gen').textContent = `${s.name} · ${s.speciesName} · gen ${s.generation}`;

  // name tag — don't clobber the field mid-typing
  const nameInput = $('#name-input');
  if (document.activeElement !== nameInput) nameInput.value = s.name;
  nameInput.disabled = $('#name-save').disabled = s.stage === 'dead';

  // speech bubble: reactions win, status line otherwise
  lastStatus = s.stage === 'dead' ? (s.epitaph ?? '[flatline]') : s.statusLine;
  if (s.reaction) setBubble(s.reaction, true);
  else if (!bubbleTimer || $('#bubble').textContent === '…') setBubble(lastStatus);

  // emotional damage meter
  $('#meter').innerHTML = s.stages
    .map((st, i) => {
      const lit = s.escalation > i && s.stage === 'alive';
      return `<li class="${lit ? 'lit' : ''} ${lit && i >= 2 ? 'hot' : ''}">${st.at}h<br>${st.label}</li>`;
    })
    .join('');

  // vitals
  const rows = [
    ['FULLNESS', s.fullness, vitalColor(s.fullness)],
    ['HEALTH', s.health, vitalColor(s.health)],
    ['MORALE', s.morale, '#a371f7'],
  ];
  $('#vitals').innerHTML =
    rows
      .map(
        ([label, v, c]) =>
          `<div class="vrow"><span>${label}</span><div class="vbar"><i style="width:${v}%;background:${c}"></i></div><span>${v}</span></div>`
      )
      .join('') +
    `<div class="vrow"><span>SCOREBOARD</span><span style="grid-column:2/4;color:#8b949e">day ${s.ageDays} · ${s.totalCommits} commits eaten · ${s.buildsPassed}✓ ${s.buildsFailed}✗ builds${s.warpedHours ? ` · ⏩${s.warpedHours}h warped` : ''}</span></div>` +
    `<div class="vrow"><span>CAREER</span><span style="grid-column:2/4;color:#8b949e">today ${s.career.commitsToday} commits · streak ${s.career.streak}d · ${s.career.buildsPassed} builds shipped · best run ${s.career.bestDays}d</span></div>`;

  // gene splicer
  $('#species').innerHTML = s.roster
    .map((r) => {
      if (!r.unlocked) {
        return `<button class="locked" disabled title="locked">🔒 ${r.name}<span>${r.condition}</span></button>`;
      }
      return `<button data-key="${r.key}" class="${r.key === s.species ? 'active' : ''}" ${s.stage === 'dead' ? 'disabled' : ''}>${r.name}</button>`;
    })
    .join('');
  document.querySelectorAll('#species button[data-key]').forEach((b) => {
    b.onclick = () => post('/api/dev/species', { species: b.dataset.key });
  });

  // log
  $('#log').innerHTML = s.log
    .map((e) => `<p><span class="t">${new Date(e.ts).toLocaleTimeString()}</span><span class="${e.kind}">${e.msg}</span></p>`)
    .join('');

  // graveyard + hatch button
  $('#btn-hatch').classList.toggle('hidden', s.stage !== 'dead');
  if (s.graveyard.length) {
    $('#graveyard').innerHTML = s.graveyard
      .map((g) => `<li>⚰ <b>${g.name}</b> the ${g.speciesName} · gen ${g.generation} · ${g.days} day${g.days > 1 ? 's' : ''} — ${g.epitaph}</li>`)
      .join('');
  }
}

async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

$('#btn-feed').onclick = () => post('/api/dev/feed', { commits: 1 });
$('#btn-ship').onclick = () => post('/api/dev/build', { ok: true });
$('#btn-break').onclick = () => post('/api/dev/build', { ok: false });
$('#btn-warp').onclick = () => post('/api/dev/warp', { hours: 12 });
$('#btn-hatch').onclick = () => post('/api/dev/hatch');

const submitName = () => {
  const name = $('#name-input').value.trim();
  if (name) post('/api/dev/rename', { name });
  $('#name-input').blur();
};
$('#name-save').onclick = submitName;
$('#name-input').onkeydown = (e) => { if (e.key === 'Enter') submitName(); };

$('#copy').onclick = async () => {
  await navigator.clipboard.writeText($('#embed-code').textContent);
  $('#copy').textContent = 'copied!';
  setTimeout(() => ($('#copy').textContent = 'copy'), 1200);
};

$('#embed-code').textContent = `![grudge](${location.origin}/pet.svg)`;

// live updates: server broadcasts on every event and every minute tick.
// serverless hosts kill long-lived streams — after repeated SSE failures,
// fall back to polling the state endpoint.
let sseErrors = 0;
let pollTimer = null;
const es = new EventSource('/api/stream');
es.onmessage = (e) => {
  sseErrors = 0;
  render(JSON.parse(e.data));
};
es.onerror = () => {
  if (++sseErrors >= 3 && !pollTimer) {
    es.close();
    const poll = async () => render(await fetch('/api/state').then((r) => r.json()));
    pollTimer = setInterval(poll, 5000);
    poll();
  }
};
