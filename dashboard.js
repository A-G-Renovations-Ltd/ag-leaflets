import { AREAS } from './routes.js';
import {
  isConfigured, auth, db,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  collection, doc, onSnapshot, setDoc, serverTimestamp,
} from './firebase-setup.js';

const root = document.getElementById('dash');
const COLOURS = { E17: '#C8102E', SW15: '#1D5FB4', NW10: '#1C7442' };
const colourFor = (id) => COLOURS[id] || '#4E5761';

let events = [];
let locs = new Map();
let unsubs = [];
let updatedAt = null;
let day = 'all';
let map = null;
let layer = null;
let fitted = false;
let markerSig = '';
let team = [];
let teamLoaded = false;

// ---------- Helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const fmt = (n) => Number(n || 0).toLocaleString('en-GB');
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d) => (d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
const hms = (d) => (d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
const dayLabel = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const minutes = (ms) => Math.round(ms / 60000);
const duration = (ms) => {
  const m = Math.max(0, minutes(ms));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
};
const sum = (list) => list.reduce((s, e) => s + (e.leaflets || 0), 0);

// ---------- Sign in ----------
function stopListening() {
  unsubs.forEach((u) => u());
  unsubs = [];
  if (map) { map.remove(); map = null; layer = null; }
  events = [];
  locs = new Map();
  team = [];
  teamLoaded = false;
  fitted = false;
  markerSig = '';
}

function renderLogin() {
  root.className = '';
  root.innerHTML = `<main class="login">
    <div class="plate login-plate">
      <h1 class="plate-name">Leaflet rounds<span class="plate-pc">A&amp;G</span></h1>
      <form id="login-form" novalidate>
        <label>Email<input type="email" name="email" autocomplete="username" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="form-error" id="login-error" role="alert"></p>
        <button class="btn" type="submit">Sign in</button>
      </form>
    </div>
  </main>`;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('login-error');
    const btn = form.querySelector('button');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
    } catch (ex) {
      const code = ex && ex.code ? ex.code : '';
      err.textContent = code.includes('network')
        ? 'No connection. Check your internet and try again.'
        : 'Wrong email or password.';
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

// ---------- Dashboard ----------
function renderShell(user) {
  root.className = 'dash';
  root.innerHTML = `
    <header class="dash-top">
      <div>
        <h1 class="dash-title">Leaflet rounds</h1>
        <p class="live" id="live">Connecting…</p>
      </div>
      <p class="dash-user">${esc(user.email)} <button class="link" id="signout">Sign out</button></p>
    </header>
    <p class="banner" id="dash-error" role="alert" hidden></p>
    <p class="banner" id="no-workers" hidden>No workers yet. <a href="#workers">Add their names</a> so they can pick themselves on their page.</p>
    <section id="summary" class="summary" aria-label="Campaign totals"></section>
    <section id="areas" class="areas" aria-label="Areas"></section>
    <section class="panel">
      <div class="panel-head">
        <h2>Rounds and activity</h2>
        <div class="tools">
          <label class="field-inline">Show <select id="day"><option value="all">All days</option></select></label>
          <button class="btn btn-small" id="csv-activity">Download activity (CSV)</button>
          <button class="btn btn-small btn-quiet" id="csv-rounds">Download rounds (CSV)</button>
        </div>
      </div>
      <div id="map" class="map" role="region" aria-label="Map of where streets were finished"></div>
      <p class="map-key">
        ${AREAS.map((a) => `<span><span class="key-dot" style="background:${colourFor(a.id)}"></span>${esc(a.id)} street finished</span>`).join('')}
        <span><span class="key-dot" style="background:#fff"></span>Round started or finished</span>
      </p>
      <h3>Rounds</h3>
      <div id="rounds" class="table-wrap"></div>
      <h3>Activity</h3>
      <div id="activity" class="table-wrap"></div>
    </section>
    <section class="panel" id="workers" aria-labelledby="workers-h">
      <h2 id="workers-h">Workers</h2>
      <p class="area-figs">The names they pick from on their page. Removing a name keeps their past rounds.</p>
      <ul id="worker-list" class="worker-list"></ul>
      <form id="add-worker" class="add-worker" novalidate>
        <label for="new-worker">First name</label>
        <input id="new-worker" maxlength="40" autocomplete="off">
        <button class="btn btn-small" type="submit">Add worker</button>
      </form>
      <p class="form-error" id="worker-error" role="alert"></p>
    </section>`;

  document.getElementById('signout').addEventListener('click', () => signOut(auth));
  document.getElementById('day').addEventListener('change', (e) => {
    day = e.target.value;
    fitted = false;
    markerSig = '';
    renderData();
  });
  document.getElementById('csv-activity').addEventListener('click', downloadActivity);
  document.getElementById('csv-rounds').addEventListener('click', downloadRounds);
  document.getElementById('add-worker').addEventListener('submit', addWorker);
  document.getElementById('worker-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (b) removeWorker(b.dataset.remove);
  });

  if (window.L) {
    map = L.map('map', { scrollWheelZoom: false }).setView([51.53, -0.12], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  } else {
    document.getElementById('map').innerHTML = '<p class="empty" style="padding:16px">The map didn\'t load. Reload the page to try again.</p>';
  }
}

function showError(text) {
  const el = document.getElementById('dash-error');
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
}

function listen() {
  const onErr = (err) => {
    if (err && err.code === 'permission-denied') {
      showError("This account can't see the data yet. Add its email to the staff list in firestore.rules (setup guide step 4), then reload.");
    } else {
      showError('Lost connection to the database. It will catch up when the connection is back.');
    }
  };
  unsubs.push(onSnapshot(collection(db, 'events'), (snap) => {
    events = snap.docs.map((d) => {
      const x = d.data({ serverTimestamps: 'estimate' });
      return { id: d.id, ...x, at: x.at && x.at.toDate ? x.at.toDate() : new Date(x.deviceAt) };
    });
    updatedAt = new Date();
    showError('');
    renderData();
  }, onErr));
  unsubs.push(onSnapshot(doc(db, 'settings', 'team'), (snap) => {
    const data = snap.exists() ? snap.data() : {};
    team = Array.isArray(data.workers) ? data.workers : [];
    teamLoaded = true;
    renderTeam();
  }, onErr));
  unsubs.push(onSnapshot(collection(db, 'locations'), (snap) => {
    locs = new Map(snap.docs.map((d) => [d.id, d.data()]));
    renderData();
  }, onErr));
}

// Groups events into rounds and works out time between taps.
function buildModel() {
  const all = events.slice().sort((a, b) => a.at - b.at);
  const rounds = new Map();
  for (const e of all) {
    if (!rounds.has(e.roundId)) {
      rounds.set(e.roundId, { id: e.roundId, worker: e.worker, area: e.area, start: null, finish: null, streets: [], items: [] });
    }
    const r = rounds.get(e.roundId);
    r.items.push(e);
    if (e.type === 'start') r.start = e;
    else if (e.type === 'finish') r.finish = e;
    else r.streets.push(e);
  }
  for (const r of rounds.values()) {
    let prev = null;
    for (const e of r.items) {
      e.sincePrev = prev ? e.at - prev.at : null;
      prev = e;
    }
    r.first = r.start ? r.start.at : r.items[0].at;
  }
  return { all, rounds: [...rounds.values()].sort((a, b) => a.first - b.first) };
}

const inDay = (d) => day === 'all' || dayKey(d) === day;

function renderData() {
  if (!document.getElementById('summary')) return;
  const { all, rounds } = buildModel();
  const streetEvents = all.filter((e) => e.type === 'street');

  // Live line
  document.getElementById('live').innerHTML = updatedAt
    ? `<span class="dot" aria-hidden="true"></span>Live. Last change ${hm(updatedAt)}.`
    : 'Connecting…';

  // Day picker
  const daySel = document.getElementById('day');
  const days = [...new Set(all.map((e) => dayKey(e.at)))].sort().reverse();
  if (day !== 'all' && !days.includes(day)) day = 'all';
  daySel.innerHTML = `<option value="all">All days</option>${days.map((k) => `<option value="${k}">${esc(dayLabel(k))}</option>`).join('')}`;
  daySel.value = day;

  // Totals (whole campaign)
  const target = AREAS.reduce((s, a) => s + a.target, 0);
  const planned = AREAS.flatMap((a) => [...a.streets, ...a.extra].map((s) => `${a.id}|${s}`));
  const doneSet = new Set(streetEvents.map((e) => `${e.area}|${e.street}`));
  const streetsDone = planned.filter((k) => doneSet.has(k)).length;
  const now = Date.now();
  const active = rounds.filter((r) => r.start && !r.finish && now - r.start.at < 14 * 3600000);
  document.getElementById('summary').innerHTML = `
    <div class="stat"><p class="stat-num">${fmt(sum(streetEvents))}</p><p class="stat-label">leaflets delivered of ${fmt(target)}</p></div>
    <div class="stat"><p class="stat-num">${streetsDone}</p><p class="stat-label">of ${planned.length} planned streets done</p></div>
    <div class="stat stat-wide"><p class="stat-label">On a round now</p>
      ${active.length
        ? `<ul class="on-round">${active.map((r) => `<li>${esc(r.worker)} in ${esc(r.area)} since ${hm(r.start.at)}, ${r.streets.length} ${r.streets.length === 1 ? 'street' : 'streets'} so far</li>`).join('')}</ul>`
        : '<p>Nobody right now.</p>'}
    </div>`;

  // Area cards
  document.getElementById('areas').innerHTML = AREAS.map((a) => {
    const evs = streetEvents.filter((e) => e.area === a.id);
    const delivered = sum(evs);
    const pct = a.target ? Math.min(100, Math.round((delivered / a.target) * 100)) : 0;
    const listed = [...a.streets, ...a.extra];
    const other = [...new Set(evs.map((e) => e.street))].filter((s) => !listed.includes(s));
    const row = (s, cls) => {
      const se = evs.filter((e) => e.street === s);
      if (!se.length) return `<li class="${cls}"><span>${esc(s)}</span><span>Not yet</span></li>`;
      const who = [...new Set(se.map((e) => e.worker))].join(' and ');
      const last = se.reduce((m, e) => (e.at > m ? e.at : m), se[0].at);
      return `<li class="is-done ${cls}"><span>${esc(s)}</span><span>${fmt(sum(se))} by ${esc(who)}, ${esc(dayLabel(dayKey(last)).replace(/ \d{4}$/, ''))} ${hm(last)}</span></li>`;
    };
    const doneCount = listed.filter((s) => evs.some((e) => e.street === s)).length;
    return `<article class="plate area-card">
      <h2 class="plate-name">${esc(a.name)}<span class="plate-pc">${esc(a.id)}</span></h2>
      <div class="bar" role="img" aria-label="${pct}% of leaflets delivered"><span style="width:${pct}%;background:${colourFor(a.id)}"></span></div>
      <p class="area-figs">${fmt(delivered)} of ${fmt(a.target)} leaflets. ${listed.length ? `${doneCount} of ${listed.length} streets.` : 'Route not planned yet.'}</p>
      ${listed.length || other.length ? `<ol class="mini-streets">
        ${a.streets.map((s) => row(s, '')).join('')}
        ${a.extra.map((s) => row(s, 'is-extra')).join('')}
        ${other.map((s) => row(s, '')).join('')}
      </ol>` : ''}
    </article>`;
  }).join('');

  // Filtered views
  const shown = all.filter((e) => inDay(e.at));
  const shownRounds = rounds.filter((r) => inDay(r.first));
  drawMap(shown);
  renderRounds(shownRounds);
  renderActivity(shown);
}

function eventLabel(e) {
  if (e.type === 'start') return `Started round, took ${fmt(e.leaflets)}`;
  if (e.type === 'finish') return `Finished round, ${fmt(e.leaflets)} left`;
  return e.street;
}

function drawMap(list) {
  if (!map) return;
  const pts = list.filter((e) => locs.has(e.id));
  const sig = `${day}#${pts.map((e) => e.id).join('|')}`;
  if (sig === markerSig) return;
  markerSig = sig;
  layer.clearLayers();
  const bounds = [];
  for (const e of pts) {
    const l = locs.get(e.id);
    const isStreet = e.type === 'street';
    L.circleMarker([l.lat, l.lng], {
      radius: isStreet ? 9 : 6,
      color: '#000',
      weight: 2,
      fillColor: isStreet ? colourFor(e.area) : '#FFFFFF',
      fillOpacity: 1,
    })
      .bindPopup(`<strong>${esc(eventLabel(e))}</strong><br>${esc(e.worker)}, ${esc(dayLabel(dayKey(e.at)))} ${hm(e.at)}${isStreet ? `<br>${fmt(e.leaflets)} leaflets` : ''}<br>GPS within ${fmt(l.accuracy)} m`)
      .addTo(layer);
    bounds.push([l.lat, l.lng]);
  }
  if (bounds.length && !fitted) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
    fitted = true;
  }
}

function roundStatus(r) {
  if (r.finish) return hm(r.finish.at);
  if (r.start && Date.now() - r.start.at < 14 * 3600000) return 'On round';
  return 'Not finished';
}

function renderRounds(list) {
  const el = document.getElementById('rounds');
  if (!list.length) { el.innerHTML = '<p class="empty">No rounds yet.</p>'; return; }
  el.innerHTML = `<table>
    <thead><tr>
      <th>Date</th><th>Worker</th><th>Area</th><th>Started</th><th>Finished</th><th>Time taken</th>
      <th class="num">Took</th><th class="num">Left</th><th class="num">Delivered (bag count)</th>
      <th class="num">Logged on streets</th><th class="num">Streets</th>
    </tr></thead>
    <tbody>${list.slice().reverse().map((r) => {
      const taken = r.start ? r.start.leaflets : null;
      const left = r.finish ? r.finish.leaflets : null;
      const bag = taken !== null && left !== null ? taken - left : null;
      const logged = sum(r.streets);
      const mismatch = bag !== null && bag !== logged;
      return `<tr>
        <td>${esc(dayLabel(dayKey(r.first)))}</td>
        <td>${esc(r.worker)}</td>
        <td>${esc(r.area)}</td>
        <td>${r.start ? hm(r.start.at) : ''}</td>
        <td>${esc(roundStatus(r))}</td>
        <td>${r.start && r.finish ? duration(r.finish.at - r.start.at) : ''}</td>
        <td class="num">${taken !== null ? fmt(taken) : ''}</td>
        <td class="num">${left !== null ? fmt(left) : ''}</td>
        <td class="num${mismatch ? ' flag' : ''}"${mismatch ? ' title="Does not match the street counts"' : ''}>${bag !== null ? fmt(bag) : ''}</td>
        <td class="num">${fmt(logged)}</td>
        <td class="num">${r.streets.length}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function renderActivity(list) {
  const el = document.getElementById('activity');
  if (!list.length) { el.innerHTML = '<p class="empty">Nothing logged yet.</p>'; return; }
  const rows = list.slice().reverse().slice(0, 400);
  el.innerHTML = `<table>
    <thead><tr>
      <th>When</th><th>Worker</th><th>Area</th><th>What</th><th class="num">Leaflets</th>
      <th class="num">Since previous</th><th>Location</th>
    </tr></thead>
    <tbody>${rows.map((e) => {
      const l = locs.get(e.id);
      const where = l ? `Within ${fmt(l.accuracy)} m` : (e.hasLocation ? 'Sending' : 'No location');
      return `<tr>
        <td>${esc(dayLabel(dayKey(e.at)).replace(/ \d{4}$/, ''))} ${hm(e.at)}</td>
        <td>${esc(e.worker)}</td>
        <td>${esc(e.area)}</td>
        <td>${esc(eventLabel(e))}</td>
        <td class="num">${e.type === 'street' ? fmt(e.leaflets) : ''}</td>
        <td class="num">${e.sincePrev !== null && e.type !== 'start' ? `${minutes(e.sincePrev)} min` : ''}</td>
        <td${l ? '' : ' class="flag"'}>${where}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ---------- Workers ----------
function renderTeam() {
  const list = document.getElementById('worker-list');
  if (!list) return;
  document.getElementById('no-workers').hidden = !teamLoaded || team.length > 0;
  list.innerHTML = team.length
    ? team.map((w) => `<li><span>${esc(w)}</span><button class="link" data-remove="${esc(w)}">Remove</button></li>`).join('')
    : '<li class="empty">No workers yet.</li>';
}

async function saveTeam(next) {
  const err = document.getElementById('worker-error');
  err.textContent = '';
  try {
    await setDoc(doc(db, 'settings', 'team'), { workers: next, updatedAt: serverTimestamp() });
    return true;
  } catch (ex) {
    err.textContent = ex && ex.code === 'permission-denied'
      ? "This account can't change workers. Check its email is in firestore.rules."
      : "Couldn't save. Check your connection and try again.";
    return false;
  }
}

async function addWorker(e) {
  e.preventDefault();
  const input = document.getElementById('new-worker');
  const err = document.getElementById('worker-error');
  const name = input.value.trim().replace(/\s+/g, ' ');
  if (!name) { err.textContent = 'Type a name first.'; return; }
  if (team.some((w) => w.toLowerCase() === name.toLowerCase())) { err.textContent = `${name} is already on the list.`; return; }
  if (await saveTeam([...team, name])) input.value = '';
}

async function removeWorker(name) {
  if (!window.confirm(`Remove ${name}? Their past rounds stay on the dashboard.`)) return;
  await saveTeam(team.filter((w) => w !== name));
}

// ---------- CSV downloads ----------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, rows) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const fileDay = () => (day === 'all' ? 'all-days' : day);

function downloadActivity() {
  const { all } = buildModel();
  const rows = [[
    'record_id', 'round_id', 'date', 'time', 'timestamp_utc', 'worker', 'area', 'event', 'street',
    'leaflets_delivered', 'leaflets_taken', 'leaflets_left', 'minutes_since_previous',
    'latitude', 'longitude', 'gps_accuracy_m',
  ]];
  for (const e of all.filter((x) => inDay(x.at))) {
    const l = locs.get(e.id);
    rows.push([
      e.id, e.roundId, dayKey(e.at), hms(e.at), e.at.toISOString(), e.worker, e.area, e.type, e.street || '',
      e.type === 'street' ? e.leaflets : '',
      e.type === 'start' ? e.leaflets : '',
      e.type === 'finish' ? e.leaflets : '',
      e.sincePrev !== null && e.type !== 'start' ? minutes(e.sincePrev) : '',
      l ? l.lat.toFixed(6) : '', l ? l.lng.toFixed(6) : '', l ? l.accuracy : '',
    ]);
  }
  download(`ag-leaflets-activity-${fileDay()}.csv`, rows);
}

function downloadRounds() {
  const { rounds } = buildModel();
  const rows = [[
    'round_id', 'date', 'worker', 'area', 'started', 'finished', 'duration_minutes',
    'leaflets_taken', 'leaflets_left', 'delivered_bag_count', 'delivered_logged_on_streets', 'streets_done',
  ]];
  for (const r of rounds.filter((x) => inDay(x.first))) {
    const taken = r.start ? r.start.leaflets : '';
    const left = r.finish ? r.finish.leaflets : '';
    rows.push([
      r.id, dayKey(r.first), r.worker, r.area,
      r.start ? hms(r.start.at) : '', r.finish ? hms(r.finish.at) : '',
      r.start && r.finish ? minutes(r.finish.at - r.start.at) : '',
      taken, left, taken !== '' && left !== '' ? taken - left : '',
      sum(r.streets), r.streets.length,
    ]);
  }
  download(`ag-leaflets-rounds-${fileDay()}.csv`, rows);
}

// ---------- Start ----------
if (!isConfigured) {
  root.innerHTML = '<div class="message"><h1 class="title">Not connected yet</h1><p class="lead">This page needs its database. Follow step 2 in the setup guide (README), then reload.</p></div>';
} else {
  onAuthStateChanged(auth, (user) => {
    stopListening();
    if (user && !user.isAnonymous) {
      renderShell(user);
      listen();
    } else {
      renderLogin();
    }
  });
}
