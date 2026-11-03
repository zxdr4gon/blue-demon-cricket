/* =========================================================
   BLUE DEMON CRICKET
   Change only SHEET_CONFIG when you add another season.
   The first season listed is the default.
   ========================================================= */
const SHEET_CONFIG = {
  "2026-27": {
    batting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=960895682&single=true&output=csv",
    bowling: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1022493287&single=true&output=csv",
    matches: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1521760675&single=true&output=csv"
  },
  "2025-26": {
    batting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1041989768&single=true&output=csv",
    bowling: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1051296080&single=true&output=csv",
    matches: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=226347194&single=true&output=csv"
  }
};

const BATTING_COLUMNS = ["Player", "Matches", "Innings", "Runs", "Balls", "S/R", "Ave", "NO", "4s", "6s", "10s", "HS", "Catches"];
const BOWLING_COLUMNS = ["Player", "Matches", "Innings", "Wickets", "Balls", "Overs", "Runs", "Economy", "Ave", "S/R"];
const MATCH_COLUMNS = ["Date", "Opponent", "Result", "Score", "Overs", "Opp. Score", "Opp. Overs", "Notes"];
const CACHE_PREFIX = "blueDemonData:";

const APP = {
  season: Object.keys(SHEET_CONFIG)[0],
  data: { batting: [], bowling: [], matches: [] },
  players: new Map(),
  tables: {},
  matchFilter: "all",
  loading: null
};

const el = (id) => document.getElementById(id);

/* ---------- Small helpers ---------- */

function isBlank(value) {
  const v = String(value ?? "").trim();
  return v === "" || v === "-" || v === "—";
}

function num(value) {
  const n = parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function show(value) {
  return isBlank(value) ? "—" : String(value).trim();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

function seasonLabel(season) {
  return season.replace("-", "–");
}

function initials(name) {
  const parts = String(name || "P").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0]).join("").toUpperCase() || "P";
}

function resultType(result) {
  const v = String(result || "").toLowerCase();
  if (/win|won|victory/.test(v)) return "win";
  if (/loss|lost|defeat/.test(v)) return "loss";
  if (/draw|tie|no result|abandon/.test(v)) return "draw";
  return "other";
}

function timeAgo(ts) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDate(value) {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { day: show(value), month: "" };
  return { day: d.getDate(), month: d.toLocaleDateString([], { month: "short" }), full: d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }) };
}

function dateValue(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? 0 : t;
}

/* ---------- CSV loading ---------- */

// Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The published sheets have blank rows/columns around the table,
// so find the header row by its first column name and read from there.
function tableFromCsv(text, columns) {
  const rows = parseCsv(text);
  const key = s => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const firstKey = key(columns[0]);
  let headerIndex = -1, offset = 0;
  for (let r = 0; r < rows.length && headerIndex < 0; r++) {
    const c = rows[r].findIndex(cell => key(cell) === firstKey);
    if (c >= 0) { headerIndex = r; offset = c; }
  }
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map(key);
  const indexOf = name => headers.indexOf(key(name));
  const photoIndex = indexOf("photo");

  return rows.slice(headerIndex + 1)
    .filter(row => String(row[offset] ?? "").trim() !== "")
    .map(row => {
      const out = {};
      columns.forEach(column => {
        const i = indexOf(column);
        out[column] = i >= 0 ? String(row[i] ?? "").trim() : "";
      });
      if (photoIndex >= 0) out.Photo = String(row[photoIndex] ?? "").trim();
      return out;
    });
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Sheet request failed (${response.status})`);
  return response.text();
}

function readCache(season) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + season)); } catch { return null; }
}

function writeCache(season, data) {
  try { localStorage.setItem(CACHE_PREFIX + season, JSON.stringify({ ...data, savedAt: Date.now() })); } catch { /* storage full or blocked */ }
}

async function fetchSeason(season) {
  const cfg = SHEET_CONFIG[season];
  const [batting, bowling, matches] = await Promise.all([cfg.batting, cfg.bowling, cfg.matches].map(fetchText));
  return {
    batting: tableFromCsv(batting, BATTING_COLUMNS),
    bowling: tableFromCsv(bowling, BOWLING_COLUMNS),
    matches: tableFromCsv(matches, MATCH_COLUMNS)
  };
}

// Show cached stats instantly, then refresh from Google Sheets.
async function loadSeason(season, { force = false } = {}) {
  const cached = readCache(season);
  if (cached && !force) {
    applyData(cached);
    setSync(`Updated ${timeAgo(cached.savedAt)}`, "ok");
  } else if (!cached) {
    applyData(null);
  }

  const token = Symbol(season);
  APP.loading = token;
  setSync(cached ? `Updated ${timeAgo(cached.savedAt)} · syncing…` : "Syncing live sheets…", "busy");

  try {
    const fresh = await fetchSeason(season);
    if (APP.loading !== token) return;
    writeCache(season, fresh);
    applyData(fresh);
    setSync("Live · just synced", "ok");
    if (force) toast("Stats refreshed");
  } catch (error) {
    if (APP.loading !== token) return;
    console.error(error);
    setSync(cached ? `Offline · showing data from ${timeAgo(cached.savedAt)}` : "Couldn't reach the sheets — check your connection", "error");
  } finally {
    if (APP.loading === token) APP.loading = null;
  }
}

function setSync(message, state) {
  el("syncStatus").textContent = message;
  el("syncDot").dataset.state = state;
  el("refreshBtn").classList.toggle("is-spinning", state === "busy");
}

/* ---------- Data model ---------- */

function applyData(data) {
  APP.data = data ? { batting: data.batting, bowling: data.bowling, matches: data.matches } : { batting: [], bowling: [], matches: [] };
  APP.players = new Map();
  const add = (row, type) => {
    const name = row.Player.trim();
    if (!APP.players.has(name)) APP.players.set(name, { name, batting: null, bowling: null, photo: "" });
    const p = APP.players.get(name);
    p[type] = row;
    if (row.Photo && !p.photo) p.photo = row.Photo;
  };
  APP.data.batting.forEach(r => add(r, "batting"));
  APP.data.bowling.forEach(r => add(r, "bowling"));
  renderAll(!data);
}

function renderAll(skeleton = false) {
  el("heroSeason").textContent = `${seasonLabel(APP.season)} season`;
  if (skeleton) {
    el("heroRecord").innerHTML = "";
    el("summaryCards").innerHTML = '<div class="stat skeleton"></div>'.repeat(4);
    ["runsLeaders", "wicketsLeaders"].forEach(id => el(id).innerHTML = '<li class="skeleton-line"></li>'.repeat(5));
    el("recentMatches").innerHTML = '<div class="match skeleton"></div>'.repeat(2);
    return;
  }
  renderHome();
  renderTable("batting");
  renderTable("bowling");
  renderMatches();
  populateVsSelectors();
  renderVs();
}

/* ---------- Home ---------- */

function renderHome() {
  const { batting, bowling, matches } = APP.data;
  const counts = { win: 0, loss: 0, draw: 0, other: 0 };
  matches.forEach(m => counts[resultType(m.Result)]++);

  const sortedMatches = [...matches].sort((a, b) => dateValue(b.Date) - dateValue(a.Date));
  const form = sortedMatches.slice(0, 5).reverse().map(m => {
    const t = resultType(m.Result);
    return `<span class="form-pip is-${t}" title="${escapeHtml(m.Opponent)}">${t === "win" ? "W" : t === "loss" ? "L" : "–"}</span>`;
  }).join("");
  el("heroRecord").innerHTML = matches.length
    ? `<span class="record-num">${counts.win}<small>W</small></span><span class="record-num">${counts.loss}<small>L</small></span>${counts.draw ? `<span class="record-num">${counts.draw}<small>T/D</small></span>` : ""}<span class="form">${form}</span>`
    : `<span class="record-empty">No matches played yet</span>`;

  const topBat = [...batting].sort((a, b) => num(b.Runs) - num(a.Runs))[0];
  const topBowl = [...bowling].sort((a, b) => num(b.Wickets) - num(a.Wickets) || num(a.Economy) - num(b.Economy))[0];
  const teamRuns = batting.reduce((s, r) => s + num(r.Runs), 0);
  const winPct = matches.length ? Math.round((counts.win / matches.length) * 100) : 0;
  const cards = [
    ["Matches", matches.length, matches.length ? `${winPct}% win rate` : "Season starting soon"],
    ["Top runs", topBat ? num(topBat.Runs) : "—", topBat ? topBat.Player : "No data yet", topBat?.Player],
    ["Top wickets", topBowl ? num(topBowl.Wickets) : "—", topBowl ? topBowl.Player : "No data yet", topBowl?.Player],
    ["Team runs", teamRuns.toLocaleString(), `${APP.players.size} players used`]
  ];
  el("summaryCards").innerHTML = cards.map(([label, value, note, player]) => `
    <${player ? `button type="button" data-player="${escapeHtml(player)}"` : "div"} class="stat">
      <span class="stat-label">${escapeHtml(label)}</span>
      <span class="stat-value">${escapeHtml(String(value))}</span>
      <span class="stat-note">${escapeHtml(note)}</span>
    </${player ? "button" : "div"}>`).join("");

  renderLeaders("runsLeaders", batting, "Runs", r => `${show(r.Balls)} balls · S/R ${show(r["S/R"])}`);
  renderLeaders("wicketsLeaders", bowling, "Wickets", r => `${show(r.Overs)} ov · Econ ${show(r.Economy)}`);

  el("recentMatches").innerHTML = sortedMatches.length
    ? sortedMatches.slice(0, 3).map(matchCard).join("")
    : `<p class="empty">No matches yet this season.</p>`;
}

function renderLeaders(id, rows, key, sub) {
  const top = rows.filter(r => num(r[key]) > 0).sort((a, b) => num(b[key]) - num(a[key])).slice(0, 5);
  const max = Math.max(1, ...top.map(r => num(r[key])));
  el(id).innerHTML = top.length ? top.map((r, i) => `
    <li>
      <button type="button" class="leader" data-player="${escapeHtml(r.Player.trim())}">
        <span class="leader-rank">${i + 1}</span>
        ${avatarHtml(r.Player, APP.players.get(r.Player.trim())?.photo)}
        <span class="leader-body">
          <span class="leader-name">${escapeHtml(r.Player)}</span>
          <span class="leader-bar"><span style="--w:${(num(r[key]) / max) * 100}%"></span></span>
          <span class="leader-sub">${escapeHtml(sub(r))}</span>
        </span>
        <span class="leader-value">${num(r[key])}</span>
      </button>
    </li>`).join("") : `<li class="empty">No data yet.</li>`;
}

function avatarHtml(name, photo, cls = "avatar") {
  const fallback = `<span>${escapeHtml(initials(name))}</span>`;
  if (!photo) return `<span class="${cls}">${fallback}</span>`;
  return `<span class="${cls}">${fallback}<img src="${escapeHtml(photo)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;
}

/* ---------- Tables ---------- */

// Display order puts the headline stats next to the name so they're visible on phones.
const TABLES = {
  batting: { columns: ["Player", "Runs", "Balls", "S/R", "Ave", "HS", "Innings", "Matches", "NO", "4s", "6s", "10s", "Catches"], sortKey: "Runs", highlight: "Runs", search: "battingSearch", empty: "battingEmpty" },
  bowling: { columns: ["Player", "Wickets", "Overs", "Runs", "Economy", "Ave", "S/R", "Innings", "Matches", "Balls"], sortKey: "Wickets", highlight: "Wickets", search: "bowlingSearch", empty: "bowlingEmpty" }
};
const LOWER_IS_BETTER = new Set(["Economy"]);

function compareValues(a, b) {
  const aBlank = isBlank(a), bBlank = isBlank(b);
  if (aBlank || bBlank) return aBlank === bBlank ? 0 : aBlank ? 1 : -1; // blanks always last
  const an = parseFloat(String(a).replace(/,/g, "")), bn = parseFloat(String(b).replace(/,/g, ""));
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function renderTable(type) {
  const cfg = TABLES[type];
  const state = APP.tables[type] ||= { query: "", sortKey: cfg.sortKey, dir: -1 };
  const table = el(`${type}Table`);
  const rows = APP.data[type];
  const q = state.query.toLowerCase().trim();

  const filtered = rows.filter(r => !q || r.Player.toLowerCase().includes(q));
  filtered.sort((a, b) => {
    const blankA = isBlank(a[state.sortKey]), blankB = isBlank(b[state.sortKey]);
    if (blankA || blankB) return compareValues(a[state.sortKey], b[state.sortKey]);
    return compareValues(a[state.sortKey], b[state.sortKey]) * state.dir || a.Player.localeCompare(b.Player);
  });

  table.tHead.innerHTML = `<tr>${cfg.columns.map(c => {
    const active = c === state.sortKey;
    return `<th scope="col" class="${c === cfg.highlight ? "is-key " : ""}${active ? "is-sorted" : ""}" aria-sort="${active ? (state.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${escapeHtml(c)}">${escapeHtml(c)}<i aria-hidden="true">${active ? (state.dir > 0 ? "▲" : "▼") : ""}</i></button></th>`;
  }).join("")}</tr>`;

  table.tBodies[0].innerHTML = filtered.map(r => `
    <tr data-player="${escapeHtml(r.Player.trim())}" tabindex="0">
      ${cfg.columns.map(c => c === "Player"
        ? `<th scope="row"><span class="player-cell">${avatarHtml(r.Player, APP.players.get(r.Player.trim())?.photo)}<span>${escapeHtml(r.Player)}</span>${badges(type, r).length ? `<span class="hot" title="${escapeHtml(badges(type, r).join(" · "))}">🔥</span>` : ""}</span></th>`
        : `<td class="${c === cfg.highlight ? "is-key" : ""}${c === state.sortKey ? " is-sorted" : ""}">${escapeHtml(show(r[c]))}</td>`).join("")}
    </tr>`).join("");

  el(cfg.empty).hidden = filtered.length > 0 || rows.length === 0;
}

function badges(type, r) {
  if (!r) return [];
  const out = [];
  if (type === "batting") {
    if (num(r.HS) >= 50) out.push("HS 50+");
    if (num(r["S/R"]) >= 140 && num(r.Balls) >= 20) out.push("S/R 140+");
  } else if (num(r.Wickets) >= 8 || (num(r.Economy) > 0 && num(r.Economy) <= 4 && num(r.Balls) >= 30)) {
    out.push(num(r.Wickets) >= 8 ? "8+ wickets" : "Economy ≤ 4");
  }
  return out;
}

function onSortClick(event) {
  const btn = event.target.closest("[data-sort]");
  if (!btn) return;
  const type = btn.closest("table").id.replace("Table", "");
  const state = APP.tables[type];
  const key = btn.dataset.sort;
  if (state.sortKey === key) state.dir *= -1;
  else { state.sortKey = key; state.dir = key === "Player" || LOWER_IS_BETTER.has(key) ? 1 : -1; }
  renderTable(type);
}

/* ---------- Matches ---------- */

function matchCard(m) {
  const t = resultType(m.Result);
  const d = formatDate(m.Date);
  const notes = show(m.Notes) === "—" ? "" : m.Notes;
  return `
    <article class="match is-${t}">
      <div class="match-date" title="${escapeHtml(d.full || m.Date)}"><b>${escapeHtml(String(d.day))}</b><span>${escapeHtml(d.month)}</span></div>
      <div class="match-body">
        <div class="match-top">
          <span class="match-opp">vs ${escapeHtml(show(m.Opponent))}</span>
          <span class="result-pill is-${t}">${escapeHtml(show(m.Result))}</span>
        </div>
        <div class="match-scores">
          <span><b>${escapeHtml(show(m.Score))}</b> <small>(${escapeHtml(show(m.Overs))} ov)</small></span>
          <span class="match-dash">–</span>
          <span><b>${escapeHtml(show(m["Opp. Score"]))}</b> <small>(${escapeHtml(show(m["Opp. Overs"]))} ov)</small></span>
        </div>
        ${notes ? `<span class="match-note">${escapeHtml(notes)}</span>` : ""}
      </div>
    </article>`;
}

function renderMatches() {
  const list = [...APP.data.matches]
    .filter(m => APP.matchFilter === "all" || resultType(m.Result) === APP.matchFilter)
    .sort((a, b) => dateValue(b.Date) - dateValue(a.Date));
  el("matchesList").innerHTML = list.map(matchCard).join("");
  el("matchesEmpty").hidden = list.length > 0;
}

/* ---------- VS mode ---------- */

function populateVsSelectors() {
  const names = [...APP.players.keys()].sort((a, b) => a.localeCompare(b));
  const options = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  const a = el("vsPlayerA"), b = el("vsPlayerB");
  const prevA = a.value, prevB = b.value;
  a.innerHTML = b.innerHTML = options;
  if (names.includes(prevA)) a.value = prevA;
  else if (names.length) a.value = topName("batting", "Runs") || names[0];
  if (names.includes(prevB) && prevB !== a.value) b.value = prevB;
  else if (names.length > 1) b.value = [topName("bowling", "Wickets"), ...names].find(n => n && n !== a.value);
}

function topName(type, key) {
  return [...APP.data[type]].sort((x, y) => num(y[key]) - num(x[key]))[0]?.Player.trim();
}

function renderVs() {
  const a = APP.players.get(el("vsPlayerA").value);
  const b = APP.players.get(el("vsPlayerB").value);
  const box = el("vsComparison");
  if (!a || !b) { box.innerHTML = `<p class="empty">Need at least two players to compare.</p>`; return; }

  const metrics = [
    ["Batting"],
    ["Runs", "batting", "Runs", "high"],
    ["Strike rate", "batting", "S/R", "high"],
    ["Average", "batting", "Ave", "high"],
    ["Highest score", "batting", "HS", "high"],
    ["Boundaries (4s + 6s)", "batting", r => isBlank(r?.["4s"]) && isBlank(r?.["6s"]) ? "" : num(r["4s"]) + num(r["6s"]), "high"],
    ["Catches", "batting", "Catches", "high"],
    ["Bowling"],
    ["Wickets", "bowling", "Wickets", "high"],
    ["Economy", "bowling", "Economy", "low"],
    ["Average", "bowling", "Ave", "low"],
    ["Strike rate", "bowling", "S/R", "low"]
  ];

  const pick = (p, type, key) => {
    const rec = p[type];
    const v = typeof key === "function" ? key(rec) : rec?.[key];
    return isBlank(v) ? null : num(v);
  };

  box.innerHTML = `
    <div class="vs-head">
      <button type="button" data-player="${escapeHtml(a.name)}">${avatarHtml(a.name, a.photo, "avatar is-lg")}<b>${escapeHtml(a.name)}</b></button>
      <button type="button" data-player="${escapeHtml(b.name)}">${avatarHtml(b.name, b.photo, "avatar is-lg")}<b>${escapeHtml(b.name)}</b></button>
    </div>` + metrics.map(([label, type, key, mode]) => {
      if (!type) return `<p class="vs-group">${label}</p>`;
      const av = pick(a, type, key), bv = pick(b, type, key);
      const both = av !== null && bv !== null && av !== bv;
      const aWin = both && (mode === "high" ? av > bv : av < bv);
      const bWin = both && !aWin;
      const total = (av || 0) + (bv || 0);
      // For "lower is better" stats, invert so the longer bar is the better one.
      const share = v => !total ? 0 : mode === "high" ? (v || 0) / total : v === null ? 0 : 1 - v / total;
      return `
        <div class="vs-row">
          <span class="vs-val ${aWin ? "is-win" : ""}">${av === null ? "—" : +av.toFixed(2)}</span>
          <span class="vs-label">${escapeHtml(label)}</span>
          <span class="vs-val ${bWin ? "is-win" : ""}">${bv === null ? "—" : +bv.toFixed(2)}</span>
          <span class="vs-bar"><span class="${aWin ? "is-win" : ""}" style="--w:${share(av) * 100}%"></span></span>
          <span class="vs-bar is-b"><span class="${bWin ? "is-win" : ""}" style="--w:${share(bv) * 100}%"></span></span>
        </div>`;
    }).join("");
}

/* ---------- Player profile ---------- */

function openPlayer(name) {
  const p = APP.players.get(name);
  if (!p) return;
  const tags = [...badges("batting", p.batting), ...badges("bowling", p.bowling)];
  if (p.batting) p.batting.Boundaries = isBlank(p.batting["4s"]) && isBlank(p.batting["6s"]) ? "" : `${num(p.batting["4s"])} / ${num(p.batting["6s"])}`;
  const statGrid = (title, rec, keys) => rec ? `
    <h3 class="sheet-section">${title}</h3>
    <div class="profile-grid">${keys.map(([label, key]) => `<div class="profile-stat"><span>${label}</span><b>${escapeHtml(show(rec[key]))}</b></div>`).join("")}</div>` : "";

  el("playerModalBody").innerHTML = `
    <div class="profile-hero">
      ${avatarHtml(p.name, p.photo, "avatar is-xl")}
      <div>
        <p class="eyebrow">${seasonLabel(APP.season)} profile</p>
        <h2 id="playerName">${escapeHtml(p.name)}</h2>
        <div class="tags">${tags.map(t => `<span class="tag">🔥 ${escapeHtml(t)}</span>`).join("")}${[p.batting && "Batter", p.bowling && num(p.bowling.Balls) > 0 && "Bowler"].filter(Boolean).map(t => `<span class="tag is-muted">${t}</span>`).join("")}</div>
      </div>
    </div>
    ${statGrid("Batting", p.batting, [["Runs", "Runs"], ["Balls", "Balls"], ["S/R", "S/R"], ["Average", "Ave"], ["High score", "HS"], ["Innings", "Innings"], ["4s / 6s", "Boundaries"], ["Catches", "Catches"]])}
    ${statGrid("Bowling", p.bowling, [["Wickets", "Wickets"], ["Overs", "Overs"], ["Runs", "Runs"], ["Economy", "Economy"], ["Average", "Ave"], ["S/R", "S/R"]])}`;

  const dlg = el("playerModal");
  if (!dlg.open) dlg.showModal();
}

function closePlayer() {
  const dlg = el("playerModal");
  if (!dlg.open) return;
  dlg.classList.add("is-closing");
  setTimeout(() => { dlg.classList.remove("is-closing"); dlg.close(); }, 180);
}

/* ---------- Navigation ---------- */

const VIEWS = ["home", "batting", "bowling", "matches", "vs"];
const LEGACY_HASH = { dashboard: "home", "vs-mode": "vs", top: "home" };

function route() {
  let view = location.hash.slice(1) || "home";
  view = LEGACY_HASH[view] || view;
  if (!VIEWS.includes(view)) view = "home";
  closePlayer();
  document.querySelectorAll(".view").forEach(v => { v.hidden = v.dataset.view !== view; });
  document.querySelectorAll(".tab").forEach(t => t.dataset.view === view ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current"));
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ---------- Theme, install, toast ---------- */

function toggleTheme() {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try { localStorage.setItem("blueDemonTheme", dark ? "dark" : "light"); } catch { /* ignore */ }
}

let deferredInstall = null;
function setupInstall() {
  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferredInstall = e;
    el("installBtn").hidden = false;
  });
  window.addEventListener("appinstalled", () => { el("installBtn").hidden = true; toast("Installed — find Blue Demons on your home screen"); });

  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios && !standalone) el("installBtn").hidden = false;

  el("installBtn").addEventListener("click", async () => {
    if (deferredInstall) {
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      el("installBtn").hidden = true;
    } else {
      toast("Tap Share, then “Add to Home Screen”", 5000);
    }
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("Service worker failed:", err));
  }
}

let toastTimer;
function toast(message, ms = 2400) {
  const t = el("toast");
  t.textContent = message;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("is-shown"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("is-shown"); setTimeout(() => { t.hidden = true; }, 250); }, ms);
}

/* ---------- Boot ---------- */

function setupEvents() {
  el("seasonSelect").innerHTML = Object.keys(SHEET_CONFIG).map(s => `<option value="${s}">${seasonLabel(s)}</option>`).join("");
  el("seasonSelect").value = APP.season;
  el("seasonSelect").addEventListener("change", e => {
    APP.season = e.target.value;
    try { localStorage.setItem("blueDemonSeason", APP.season); } catch { /* ignore */ }
    closePlayer();
    loadSeason(APP.season);
  });

  el("themeToggle").addEventListener("click", toggleTheme);
  el("refreshBtn").addEventListener("click", () => { if (!APP.loading) loadSeason(APP.season, { force: true }); });

  Object.entries(TABLES).forEach(([type, cfg]) => {
    el(cfg.search).addEventListener("input", e => {
      (APP.tables[type] ||= { query: "", sortKey: cfg.sortKey, dir: -1 }).query = e.target.value;
      renderTable(type);
    });
    el(`${type}Table`).tHead.addEventListener("click", onSortClick);
  });

  el("matchFilter").addEventListener("click", e => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    APP.matchFilter = chip.dataset.filter;
    el("matchFilter").querySelectorAll(".chip").forEach(c => c.classList.toggle("is-active", c === chip));
    renderMatches();
  });

  ["vsPlayerA", "vsPlayerB"].forEach(id => el(id).addEventListener("change", renderVs));

  // One delegated handler opens any player profile.
  document.addEventListener("click", e => {
    const target = e.target.closest("[data-player]");
    if (target && !target.closest("dialog")) openPlayer(target.dataset.player);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("tr[data-player]")) openPlayer(e.target.dataset.player);
  });

  const dlg = el("playerModal");
  dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-close]")) closePlayer(); });
  dlg.addEventListener("cancel", e => { e.preventDefault(); closePlayer(); });

  window.addEventListener("hashchange", route);

  // Refresh when the app comes back to the foreground (e.g. reopened from home screen).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || APP.loading) return;
    const cached = readCache(APP.season);
    if (!cached || Date.now() - cached.savedAt > 2 * 60 * 1000) loadSeason(APP.season);
  });
}

function init() {
  try {
    const saved = localStorage.getItem("blueDemonSeason");
    if (saved && SHEET_CONFIG[saved]) APP.season = saved;
  } catch { /* ignore */ }
  setupEvents();
  setupInstall();
  route();
  loadSeason(APP.season);
}

init();
