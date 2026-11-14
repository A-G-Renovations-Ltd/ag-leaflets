import { AREAS } from './routes.js';
import {
  isConfigured, auth, db,
  signInAnonymously, onAuthStateChanged,
  collection, doc, writeBatch, serverTimestamp, onSnapshot, query, where,
} from './firebase-setup.js';

const appEl = document.getElementById('app');
const sheetEl = document.getElementById('sheet');
const panelEl = sheetEl.querySelector('.sheet-panel');
const toastEl = document.getElementById('toast');

// ---------- Small helpers ----------
const saved = {
  get(k) { try { return JSON.parse(localStorage.getItem('ag.' + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('ag.' + k, JSON.stringify(v)); } catch { /* storage off */ } },
  del(k) { try { localStorage.removeItem('ag.' + k); } catch { /* storage off */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmt = (n) => Number(n || 0).toLocaleString('en-GB');
const timeOf = (d) => (d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const duration = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
};
const TICK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------- State ----------
const storedRound = saved.get('round');
const state = {
  uid: null,
  connecting: true,
  worker: typeof saved.get('worker') === 'string' ? saved.get('worker') : null,
  workers: [],          // names set on the dashboard
  teamLoaded: false,
  areaId: null,
  round: null,          // { id, areaId, startedAt, taken }
  events: [],           // everything logged in the current area
  loaded: false,
  fix: null,            // latest phone location
  gps: 'off',           // off | on | denied | searching
  error: '',
  summary: null,
  online: navigator.onLine,
};
if (storedRound && AREAS.some((a) => a.id === storedRound.areaId)) {
  state.round = storedRound;
  state.areaId = storedRound.areaId;
} else {
  const a = saved.get('area');
  state.areaId = AREAS.some((x) => x.id === a && x.streets.length) ? a : null;
}

let unsubscribe = null;
let unsubscribeTeam = null;
let watchId = null;
let sheet = null;       // { kind, data, busy }
let toastTimer = null;

const currentArea = () => AREAS.find((a) => a.id === state.areaId);
// "Yours" means this phone and this name, in case two people ever share a phone.
const isMine = (e) => e.uid === state.uid && e.worker === state.worker;

// ---------- Location ----------
function startGps() {
  if (!('geolocation' in navigator) || watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      state.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, t: Date.now() };
      if (state.gps !== 'on') { state.gps = 'on'; render(); }
    },
    (e) => {
      const next = e.code === 1 ? 'denied' : 'searching';
      if (state.gps !== next) { state.gps = next; render(); }
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
}

function stopGps() {
  if (watchId !== null && 'geolocation' in navigator) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  state.fix = null;
  state.gps = 'off';
}

function getFix() {
  if (state.fix && Date.now() - state.fix.t < 45000) return Promise.resolve(state.fix);
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        state.fix = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, t: Date.now() };
        resolve(state.fix);
      },
      (e) => { if (e.code === 1) state.gps = 'denied'; resolve(null); },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 8000 },
    );
  });
}

// ---------- Saving ----------
// Each tap saves one event. Its location goes in a separate, staff-only record with the same id.
async function saveEvent(type, { street = null, leaflets }) {
  const fix = await getFix();
  const ref = doc(collection(db, 'events'));
  const batch = writeBatch(db);
  batch.set(ref, {
    type,
    area: state.areaId,
    street,
    leaflets,
    worker: state.worker,
    uid: state.uid,
    roundId: type === 'start' ? ref.id : state.round.id,
    at: serverTimestamp(),
    deviceAt: new Date().toISOString(),
    hasLocation: !!fix,
  });
  if (fix) {
    batch.set(doc(db, 'locations', ref.id), {
      lat: fix.lat,
      lng: fix.lng,
      accuracy: Math.round(fix.accuracy),
      uid: state.uid,
      at: serverTimestamp(),
    });
  }
  // Don't wait for the server: it's saved on the phone straight away and sends when there's signal.
  batch.commit().catch(() => showToast("That didn't save. Tap it again."));
  return ref.id;
}

async function startRound(taken) {
  startGps();
  const id = await saveEvent('start', { leaflets: taken });
  state.round = { id, areaId: state.areaId, startedAt: Date.now(), taken };
  saved.set('round', state.round);
}

async function finishRound(left) {
  const r = state.round;
  const streets = state.events.filter((e) => e.roundId === r.id && e.type === 'street');
  await saveEvent('finish', { leaflets: left });
  state.summary = {
    delivered: r.taken - left,
    took: duration(Date.now() - r.startedAt),
    streets: streets.length,
  };
  state.round = null;
  saved.del('round');
  stopGps();
}

function removeEvent(id) {
  const e = state.events.find((x) => x.id === id);
  writeBatch(db).delete(doc(db, 'events', id)).commit()
    .catch(() => showToast("Couldn't remove it. Try again when you have signal."));
  if (e && e.hasLocation) {
    writeBatch(db).delete(doc(db, 'locations', id)).commit().catch(() => {});
  }
}

// ---------- Live data ----------
function listen() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  state.events = [];
  state.loaded = false;
  if (!state.uid || !currentArea()) return;
  const q = query(collection(db, 'events'), where('area', '==', state.areaId));
  unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    state.events = snap.docs.map((d) => {
      const x = d.data({ serverTimestamps: 'estimate' });
      return {
        id: d.id,
        ...x,
        at: x.at && x.at.toDate ? x.at.toDate() : new Date(x.deviceAt),
        pending: d.metadata.hasPendingWrites,
      };
    });
    state.loaded = true;
    state.error = '';
    render();
  }, () => {
    state.error = "Can't load the round right now. Check your signal, then reload the page.";
    render();
  });
}

function listenTeam() {
  if (unsubscribeTeam) unsubscribeTeam();
  unsubscribeTeam = onSnapshot(doc(db, 'settings', 'team'), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    state.workers = Array.isArray(data.workers) ? data.workers : [];
    state.teamLoaded = true;
    // A name that has been removed on the dashboard can't be used for a new round.
    if (state.worker && !state.round && !state.workers.includes(state.worker)) {
      state.worker = null;
      saved.del('worker');
    }
    render();
  }, () => {
    state.teamLoaded = true;
    render();
  });
}

// ---------- Screens ----------
function topBar() {
  return `<header class="top">
    <p class="brand">A&amp;G leaflet round</p>
    ${state.worker ? `<button class="chip" data-action="change-worker" aria-label="Change name, currently ${esc(state.worker)}">${esc(state.worker)}</button>` : ''}
  </header>`;
}

function message(title, text, withReload = false) {
  appEl.innerHTML = `<div class="message">
    <h1 class="title">${esc(title)}</h1>
    ${text ? `<p class="lead">${esc(text)}</p>` : ''}
    ${withReload ? '<button class="btn" data-action="reload">Reload</button>' : ''}
  </div>`;
}

function renderPickWorker() {
  if (!state.teamLoaded) { message('Getting ready…', ''); return; }
  if (!state.workers.length) {
    message('No names yet', "Your name needs adding on the dashboard first. This page updates by itself once it's added.");
    return;
  }
  appEl.innerHTML = `${topBar()}
    <h1 class="title">Who are you?</h1>
    <div class="choices">
      ${state.workers.map((w) => `<button class="btn btn-quiet" data-action="pick-worker" data-value="${esc(w)}">${esc(w)}</button>`).join('')}
    </div>`;
}

function renderPickArea() {
  appEl.innerHTML = `${topBar()}
    <h1 class="title">Where are you today?</h1>
    <ul class="area-list">
      ${AREAS.map((a) => {
        const ready = a.streets.length > 0;
        return `<li><button class="plate plate-btn" data-action="pick-area" data-value="${esc(a.id)}" ${ready ? '' : 'disabled'}>
          <span class="plate-name">${esc(a.name)}<span class="plate-pc">${esc(a.id)}</span></span>
          <span class="plate-note">${ready ? `${fmt(a.target)} leaflets` : 'Route not ready yet'}</span>
        </button></li>`;
      }).join('')}
    </ul>`;
}

function stopItem(a, street, n, evs) {
  const mine = evs.filter(isMine);
  const others = evs.filter((e) => !isMine(e));
  const done = mine.length > 0;
  const mineHtml = mine.map((e) => {
    const canUndo = state.round && e.roundId === state.round.id;
    return `<p class="stop-mine">You: ${fmt(e.leaflets)} leaflets at ${timeOf(e.at)}${e.pending ? ' (sending)' : ''}
      ${canUndo ? `<button class="link" data-action="undo" data-id="${esc(e.id)}">Undo</button>` : ''}</p>`;
  }).join('');
  const teamHtml = others.length
    ? `<p class="stop-team">Also done by ${others.map((e) => `${esc(e.worker)} (${fmt(e.leaflets)})`).join(', ')}</p>`
    : '';
  const button = !done && state.round
    ? `<button class="btn" data-action="street" data-street="${esc(street)}">Finished this street</button>`
    : '';
  return `<li class="stop${done ? ' is-done' : ''}">
    <span class="stop-no" aria-hidden="true">${done ? TICK : n}</span>
    <div class="plate">
      <p class="plate-name">${esc(street)}<span class="plate-pc">${esc(a.id)}</span></p>
      ${mineHtml}${teamHtml}${button}
    </div>
  </li>`;
}

function renderRound() {
  const a = currentArea();
  const r = state.round;
  const byStreet = new Map();
  for (const e of state.events) {
    if (e.type !== 'street') continue;
    if (!byStreet.has(e.street)) byStreet.set(e.street, []);
    byStreet.get(e.street).push(e);
  }
  const teamTotal = state.events.filter((e) => e.type === 'street').reduce((s, e) => s + e.leaflets, 0);
  const roundStreets = r ? state.events.filter((e) => e.roundId === r.id && e.type === 'street') : [];
  const roundTotal = roundStreets.reduce((s, e) => s + e.leaflets, 0);
  const pending = state.events.filter((e) => e.pending && isMine(e)).length;

  let html = topBar();
  html += `<section class="area-head">
    <h1 class="title">${esc(a.name)} <span class="pc">${esc(a.id)}</span></h1>
    ${r ? '' : '<button class="link" data-action="change-area">Change area</button>'}
  </section>`;

  if (state.error) html += `<p class="banner" role="alert">${esc(state.error)}</p>`;
  if (r && state.gps === 'denied') {
    html += '<p class="banner" role="alert">Location is off for this page. Turn it on in your phone settings so your streets show on the map. You can keep going.</p>';
  }

  if (r) {
    html += `<section class="round-panel is-on">
      <p class="lead"><strong>On your round since ${timeOf(new Date(r.startedAt))}.</strong>
      You took ${fmt(r.taken)} leaflets and you've done ${roundStreets.length} ${roundStreets.length === 1 ? 'street' : 'streets'} (${fmt(roundTotal)} leaflets).</p>
    </section>`;
  } else {
    html += `<section class="round-panel">
      <p class="lead">${a.startPoint ? `Start at <strong>${esc(a.startPoint)}</strong>. ` : ''}Count the leaflets in your bag, then start your round.</p>
      <button class="btn btn-go" data-action="start">Start round</button>
    </section>`;
  }

  if (!state.online) {
    html += '<p class="sync is-waiting">No signal right now. Keep going, everything saves on your phone.</p>';
  } else if (pending) {
    html += `<p class="sync is-waiting">${pending} saved on this phone, sending now.</p>`;
  } else if (state.loaded) {
    html += `<p class="sync">Everything's sent. Team total in ${esc(a.id)}: ${fmt(teamTotal)} of ${fmt(a.target)} leaflets.</p>`;
  }

  html += `<h2 class="list-head">Streets in order</h2>
    <ol class="stops">${a.streets.map((s, i) => stopItem(a, s, i + 1, byStreet.get(s) || [])).join('')}</ol>`;
  if (a.extra.length) {
    html += `<h2 class="list-head">Only if you still have leaflets left</h2>
      <ol class="stops">${a.extra.map((s, i) => stopItem(a, s, a.streets.length + i + 1, byStreet.get(s) || [])).join('')}</ol>`;
  }

  if (r) html += '<button class="btn btn-quiet" data-action="finish">Finish round</button>';
  appEl.innerHTML = html;
}

function renderSummary() {
  const s = state.summary;
  appEl.innerHTML = `${topBar()}
    <h1 class="title">Round finished</h1>
    <div class="plate summary-plate">
      <p class="big">You delivered <strong>${fmt(s.delivered)}</strong> leaflets in ${esc(s.took)}.</p>
      <p>${s.streets} ${s.streets === 1 ? 'street' : 'streets'} done. Nice work.</p>
    </div>
    <button class="btn" data-action="summary-done">Done</button>`;
}

function render() {
  if (!isConfigured) {
    message('Not connected yet', 'This page needs its database. Follow step 2 in the setup guide (README), then reload.');
    return;
  }
  if (state.connecting) {
    if (state.error) message("Can't connect", state.error, true);
    else message('Getting ready…', '');
    return;
  }
  if (state.summary) return renderSummary();
  if (!state.worker) return renderPickWorker();
  if (!state.areaId) return renderPickArea();
  return renderRound();
}

// ---------- Bottom sheet ----------
function sheetConfig(kind, data) {
  if (kind === 'start') {
    return { title: 'How many leaflets are you taking?', help: "Count what's in your bag.", min: 1, max: 5000, confirm: 'Start round' };
  }
  if (kind === 'street') {
    return { title: data.street, help: 'How many leaflets did you put through doors on this street?', min: 0, max: 5000, confirm: 'Save street' };
  }
  if (kind === 'finish') {
    const r = state.round;
    const taken = r ? r.taken : 0;
    const logged = r
      ? state.events.filter((e) => e.roundId === r.id && e.type === 'street').reduce((s, e) => s + e.leaflets, 0)
      : 0;
    const expected = Math.max(0, taken - logged);
    return {
      title: 'How many leaflets are LEFT in your bag?',
      help: `Not how many you delivered. You took ${fmt(taken)} and logged ${fmt(logged)} on streets, so you should have about ${fmt(expected)} left. Count your bag and change the number if it's different. Empty bag = 0.`,
      min: 0,
      max: r ? r.taken : 5000,
      value: r ? Math.min(expected, r.taken) : undefined,
      taken: r ? r.taken : null,
      confirm: 'Finish round',
    };
  }
  const e = state.events.find((x) => x.id === data.id);
  return { title: `Remove ${e ? e.street : 'this street'}?`, help: 'Only do this if you tapped the wrong street.', confirm: 'Remove it', danger: true };
}

function openSheet(kind, data = {}) {
  const cfg = sheetConfig(kind, data);
  const hasNumber = typeof cfg.min === 'number';
  sheet = { kind, data, cfg, busy: false };
  panelEl.innerHTML = `
    <h2 id="sheet-title" class="sheet-title">${esc(cfg.title)}</h2>
    <p class="sheet-help">${esc(cfg.help)}</p>
    ${hasNumber ? `
      <input id="num" class="num-input" type="number" inputmode="numeric" pattern="[0-9]*" min="${cfg.min}" max="${cfg.max}" step="1" aria-label="Number of leaflets"${typeof cfg.value === 'number' ? ` value="${cfg.value}"` : ''}>
      ${typeof cfg.taken === 'number' ? '<p class="sheet-help" id="delivered-note"></p>' : ''}
      <div class="steppers">
        <button type="button" data-step="-10">−10</button>
        <button type="button" data-step="-1">−1</button>
        <button type="button" data-step="1">+1</button>
        <button type="button" data-step="10">+10</button>
      </div>` : ''}
    <p class="sheet-error" role="alert"></p>
    <div class="sheet-actions">
      <button class="btn${cfg.danger ? ' btn-danger' : ''}" data-sheet="confirm" ${hasNumber ? 'disabled' : ''}>${esc(cfg.confirm)}</button>
      <button class="btn btn-quiet" data-sheet="close">Cancel</button>
    </div>`;
  sheetEl.hidden = false;
  document.body.classList.add('sheet-open');
  const first = panelEl.querySelector('#num') || panelEl.querySelector('[data-sheet="confirm"]');
  if (first) first.focus();
  if (hasNumber) updateConfirm();
}

function closeSheet() {
  sheet = null;
  sheetEl.hidden = true;
  panelEl.innerHTML = '';
  document.body.classList.remove('sheet-open');
}

function readNumber() {
  const input = panelEl.querySelector('#num');
  if (!input) return null;
  const raw = input.value.trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  return n >= sheet.cfg.min && n <= sheet.cfg.max ? n : null;
}

function updateConfirm() {
  const btn = panelEl.querySelector('[data-sheet="confirm"]');
  const err = panelEl.querySelector('.sheet-error');
  const input = panelEl.querySelector('#num');
  if (!btn || !input) return;
  const n = readNumber();
  btn.disabled = n === null || sheet.busy;
  err.textContent = input.value.trim() !== '' && n === null
    ? `Enter a number from ${fmt(sheet.cfg.min)} to ${fmt(sheet.cfg.max)}.`
    : '';
  const note = panelEl.querySelector('#delivered-note');
  if (note) {
    note.innerHTML = n === null
      ? ''
      : `That means you delivered <strong>${fmt(sheet.cfg.taken - n)}</strong> leaflets.`;
  }
}

async function confirmSheet() {
  if (!sheet || sheet.busy) return;
  const { kind, data } = sheet;
  const n = readNumber();
  if (kind !== 'undo' && n === null) return;
  sheet.busy = true;
  const btn = panelEl.querySelector('[data-sheet="confirm"]');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    if (kind === 'start') { await startRound(n); showToast('Round started'); }
    if (kind === 'street') { await saveEvent('street', { street: data.street, leaflets: n }); showToast(`${data.street} saved`); }
    if (kind === 'finish') { await finishRound(n); }
    if (kind === 'undo') { removeEvent(data.id); showToast('Removed'); }
    closeSheet();
    render();
  } catch (err) {
    sheet.busy = false;
    btn.textContent = sheet.cfg.confirm;
    btn.disabled = false;
    panelEl.querySelector('.sheet-error').textContent = 'Something went wrong. Try again.';
  }
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

// ---------- Events ----------
appEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const act = b.dataset.action;
  if (act === 'reload') location.reload();
  if (act === 'pick-worker') { state.worker = b.dataset.value; saved.set('worker', state.worker); render(); }
  if (act === 'change-worker') {
    if (state.round) { showToast('Finish your round first'); return; }
    state.worker = null; saved.del('worker'); render();
  }
  if (act === 'pick-area') { state.areaId = b.dataset.value; saved.set('area', state.areaId); listen(); render(); }
  if (act === 'change-area') { state.areaId = null; saved.del('area'); listen(); render(); }
  if (act === 'start') openSheet('start');
  if (act === 'street') openSheet('street', { street: b.dataset.street });
  if (act === 'finish') openSheet('finish');
  if (act === 'undo') openSheet('undo', { id: b.dataset.id });
  if (act === 'summary-done') { state.summary = null; render(); }
});

sheetEl.addEventListener('click', (e) => {
  const step = e.target.closest('[data-step]');
  if (step && sheet) {
    const input = panelEl.querySelector('#num');
    const cur = parseInt(input.value, 10) || 0;
    const next = Math.min(sheet.cfg.max, Math.max(sheet.cfg.min, cur + parseInt(step.dataset.step, 10)));
    input.value = String(next);
    updateConfirm();
    return;
  }
  const s = e.target.closest('[data-sheet]');
  if (!s) return;
  if (s.dataset.sheet === 'close' && !(sheet && sheet.busy)) closeSheet();
  if (s.dataset.sheet === 'confirm') confirmSheet();
});

sheetEl.addEventListener('input', (e) => { if (e.target.id === 'num') updateConfirm(); });
sheetEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheet && !sheet.busy) closeSheet();
  if (e.key === 'Enter' && e.target.id === 'num') { e.preventDefault(); confirmSheet(); }
});

window.addEventListener('online', () => { state.online = true; render(); });
window.addEventListener('offline', () => { state.online = false; render(); });

// ---------- Start ----------
render();
if (isConfigured) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      state.uid = user.uid;
      state.connecting = false;
      state.error = '';
      listenTeam();
      listen();
      if (state.round) startGps();
      render();
    } else {
      signInAnonymously(auth).catch(() => {
        state.error = 'Check you have signal, then reload the page.';
        render();
      });
    }
  });
}
