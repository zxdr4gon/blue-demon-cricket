/* =========================================================
   BLUE DEMON CRICKET — 2026–27
   Change only SHEET_CONFIG when you add another season.
   ========================================================= */
const SHEET_CONFIG = {
  "2026-27": {
    batting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=960895682&single=true&output=csv",
    bowling: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1022493287&single=true&output=csv",
    matches: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1521760675&single=true&output=csv"
  }
};

const APP = {
  season: "2026-27",
  data: { batting: [], bowling: [], matches: [] },
  charts: {},
  tableState: {},
  playerIndex: new Map(),
  initialized: false
};

const BATTING_COLUMNS = ["Player", "Matches", "Innings", "Runs", "Balls", "S/R", "Ave", "NO", "4s", "6s", "10s", "HS", "Catches", "Photo"];
const BOWLING_COLUMNS = ["Player", "Matches", "Innings", "Wickets", "Balls", "Overs", "Runs", "Economy", "Ave", "S/R"];
const MATCH_COLUMNS = ["Date", "Opponent", "Result", "Score", "Overs", "Opp. Score", "Overs", "Notes"];

const el = (id) => document.getElementById(id);

function cleanKey(key) {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function displayNum(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function rawValue(row, wanted) {
  const target = cleanKey(wanted);
  const keys = Object.keys(row);
  const key = keys.find(k => cleanKey(k) === target);
  return key ? row[key] : "";
}

function initials(name) {
  const parts = String(name || "Player").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "P";
  return parts.slice(0, 2).map(p => p[0]).join("").toUpperCase();
}

function normalizeRows(rows, columns) {
  return rows
    .filter(row => row.some(cell => String(cell ?? "").trim() !== ""))
    .map(row => {
      const out = {};
      columns.forEach((column, index) => { out[column] = String(row[index] ?? "").trim(); });
      return out;
    })
    .filter(row => String(row[columns[0]] || "").trim() !== "");
}

async function fetchCsv(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`CSV request failed (${response.status})`);
  const text = await response.text();
  const parsed = Papa.parse(text, {
    skipEmptyLines: "greedy",
    dynamicTyping: false
  });
  if (parsed.errors?.length) {
    console.warn("PapaParse warnings:", parsed.errors);
  }
  return parsed.data;
}

async function loadSeason(season = APP.season) {
  const cfg = SHEET_CONFIG[season];
  if (!cfg) throw new Error(`No sheet configuration found for ${season}.`);

  setSyncStatus("Syncing live sheets…", false);
  const [battingRaw, bowlingRaw, matchesRaw] = await Promise.all([
    fetchCsv(cfg.batting),
    fetchCsv(cfg.bowling),
    fetchCsv(cfg.matches)
  ]);

  APP.data.batting = normalizeRows(battingRaw, BATTING_COLUMNS);
  APP.data.bowling = normalizeRows(bowlingRaw, BOWLING_COLUMNS);
  APP.data.matches = normalizeRows(matchesRaw, MATCH_COLUMNS);
  buildPlayerIndex();
  renderAll();
  setSyncStatus(`Live data synced · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`, true);
}

function setSyncStatus(message, ok = true) {
  el("syncStatus").textContent = message;
  el("syncDot").classList.toggle("error", !ok);
}

function buildPlayerIndex() {
  APP.playerIndex = new Map();
  const names = new Set([
    ...APP.data.batting.map(r => r.Player).filter(Boolean),
    ...APP.data.bowling.map(r => r.Player).filter(Boolean)
  ]);

  names.forEach(name => {
    const batting = APP.data.batting.find(r => r.Player === name) || {};
    const bowling = APP.data.bowling.find(r => r.Player === name) || {};
    APP.playerIndex.set(name, { name, batting, bowling });
  });
}

function playerAvatar(name, photo, className = "player-avatar") {
  const wrap = document.createElement("div");
  wrap.className = className;
  wrap.textContent = initials(name);
  if (photo) {
    const img = document.createElement("img");
    img.alt = `${name} headshot`;
    img.loading = "lazy";
    img.src = photo;
    img.addEventListener("error", () => img.remove(), { once: true });
    wrap.appendChild(img);
  }
  return wrap;
}

function eliteBadges(record, type) {
  const badges = [];
  if (type === "batting") {
    if (num(record.HS) >= 50) badges.push("🔥 HS 50+");
    if (num(record["S/R"]) >= 140) badges.push("🔥 S/R 140+");
  }
  if (type === "bowling") {
    if (num(record.Wickets) >= 3) badges.push("🔥 3+ Wkts");
  }
  return badges;
}

function renderTable(tableId, rows, columns, options = {}) {
  const table = el(tableId);
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");
  const empty = el(options.emptyId);
  const searchInput = el(options.searchId);
  const stateKey = tableId;

  if (!APP.tableState[stateKey]) {
    APP.tableState[stateKey] = { query: "", sortKey: options.defaultSort || columns[0], direction: "desc" };
  }

  const state = APP.tableState[stateKey];
  const query = (state.query || "").toLowerCase().trim();
  let filtered = rows.filter(row => {
    if (!query) return true;
    return columns.some(column => String(row[column] ?? "").toLowerCase().includes(query));
  });

  filtered.sort((a, b) => compareValues(a[state.sortKey], b[state.sortKey], state.direction));

  thead.innerHTML = "";
  const headRow = document.createElement("tr");
  columns.forEach((column, index) => {
    const th = document.createElement("th");
    th.textContent = column;
    th.dataset.sortable = "true";
    if (state.sortKey === column) th.classList.add(state.direction === "asc" ? "sort-asc" : "sort-desc");
    th.addEventListener("click", () => {
      if (state.sortKey === column) state.direction = state.direction === "asc" ? "desc" : "asc";
      else { state.sortKey = column; state.direction = "desc"; }
      renderTable(tableId, rows, columns, options);
    });
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);

  tbody.innerHTML = "";
  filtered.forEach(row => {
    const tr = document.createElement("tr");
    if (options.rowClick) tr.addEventListener("click", () => options.rowClick(row));
    columns.forEach(column => {
      const td = document.createElement("td");
      const value = row[column] ?? "";

      if (column === "Player") {
        td.appendChild(playerCell(row));
      } else {
        td.textContent = value === "" ? "—" : value;
        if (options.highlight === "green" && column === "Runs") td.classList.add("stat-highlight-green");
        if (options.highlight === "red" && column === "Wickets") td.classList.add("stat-highlight-red");
        if (column === "Result") addResultClass(td, value);
        if ((options.badgeType === "batting" || options.badgeType === "bowling") && column === (options.badgeType === "batting" ? "HS" : "Wickets")) {
          const badges = eliteBadges(row, options.badgeType);
          if (badges.length) td.insertAdjacentHTML("beforeend", ` <span class="elite-badge" title="Elite stat">🔥</span>`);
        }
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  empty?.classList.toggle("is-hidden", filtered.length > 0);
  searchInput?.addEventListener("input", () => {
    state.query = searchInput.value;
    renderTable(tableId, rows, columns, options);
  }, { once: true });
  if (searchInput && searchInput.value !== state.query) searchInput.value = state.query;
}

function compareValues(a, b, direction) {
  const aNum = num(a), bNum = num(b);
  const bothNumeric = String(a ?? "").trim() !== "" && String(b ?? "").trim() !== "" && (Number.isFinite(parseFloat(String(a).replace(/,/g, ""))) && Number.isFinite(parseFloat(String(b).replace(/,/g, ""))));
  let result;
  if (bothNumeric) result = aNum - bNum;
  else result = String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? result : -result;
}

function playerCell(row) {
  const cell = document.createElement("div");
  cell.className = "player-cell";
  cell.appendChild(playerAvatar(row.Player, row.Photo));
  const name = document.createElement("span");
  name.className = "player-name";
  name.textContent = row.Player;
  cell.appendChild(name);
  const badges = eliteBadges(row, APP.tableState.__typeForCurrentTable || "");
  if (badges.length) {
    const badge = document.createElement("span");
    badge.className = "elite-badge";
    badge.textContent = "🔥";
    badge.title = badges.join(" · ");
    cell.appendChild(badge);
  }
  return cell;
}

function addResultClass(td, value) {
  const v = String(value || "").toLowerCase();
  if (/win|won|victory/.test(v)) td.classList.add("result-win");
  else if (/loss|lost|defeat/.test(v)) td.classList.add("result-loss");
  else if (/draw|tie/.test(v)) td.classList.add("result-draw");
}

function renderAll() {
  renderSummaryCards();
  renderCharts();

  APP.tableState.__typeForCurrentTable = "batting";
  renderTable("battingTable", APP.data.batting, BATTING_COLUMNS, {
    searchId: "battingSearch",
    emptyId: "battingEmpty",
    defaultSort: "Runs",
    highlight: "green",
    badgeType: "batting",
    rowClick: row => openPlayerModal(row.Player)
  });

  APP.tableState.__typeForCurrentTable = "bowling";
  renderTable("bowlingTable", APP.data.bowling, BOWLING_COLUMNS, {
    searchId: "bowlingSearch",
    emptyId: "bowlingEmpty",
    defaultSort: "Wickets",
    highlight: "red",
    badgeType: "bowling",
    rowClick: row => openPlayerModal(row.Player)
  });

  renderTable("matchesTable", APP.data.matches, MATCH_COLUMNS, {
    searchId: "matchesSearch",
    emptyId: "matchesEmpty",
    defaultSort: "Date",
    rowClick: null
  });

  populateVsSelectors();
  renderVsComparison();
}

function renderSummaryCards() {
  const matches = APP.data.matches;
  const wins = matches.filter(m => /win|won|victory/i.test(m.Result)).length;
  const losses = matches.filter(m => /loss|lost|defeat/i.test(m.Result)).length;
  const runs = Math.max(0, ...APP.data.batting.map(r => num(r.Runs)));
  const wickets = Math.max(0, ...APP.data.bowling.map(r => num(r.Wickets)));
  const cards = [
    ["Matches", matches.length, `${wins} wins · ${losses} losses`, "🏏"],
    ["Top Runs", displayNum(runs), topPlayer(APP.data.batting, "Runs"), "🔥"],
    ["Top Wickets", displayNum(wickets), topPlayer(APP.data.bowling, "Wickets"), "⚡"],
    ["Players", APP.playerIndex.size, "Across batting + bowling", "👥"]
  ];
  el("summaryCards").innerHTML = cards.map(([label, value, note, icon]) => `
    <div class="column is-6-tablet is-3-desktop">
      <div class="card app-card summary-card">
        <div class="card-content">
          <div class="is-flex is-justify-content-space-between is-align-items-start">
            <div>
              <div class="summary-label">${escapeHtml(label)}</div>
              <div class="summary-value">${escapeHtml(String(value))}</div>
              <div class="summary-note">${escapeHtml(note)}</div>
            </div>
            <div class="summary-icon">${icon}</div>
          </div>
        </div>
      </div>
    </div>`).join("");
}

function topPlayer(rows, key) {
  const top = [...rows].sort((a, b) => num(b[key]) - num(a[key]))[0];
  return top ? top.Player : "No data yet";
}

function getChartTextColor() {
  return getComputedStyle(document.body).getPropertyValue("--muted").trim() || "#67748d";
}

function getChartGridColor() {
  return getComputedStyle(document.body).getPropertyValue("--border").trim() || "#dce5f0";
}

function destroyChart(key) {
  if (APP.charts[key]) {
    APP.charts[key].destroy();
    APP.charts[key] = null;
  }
}

function renderCharts() {
  if (typeof Chart === "undefined") return;
  const text = getChartTextColor();
  const grid = getChartGridColor();
  Chart.defaults.color = text;
  Chart.defaults.font.family = "Inter, ui-sans-serif, system-ui, sans-serif";

  const topRuns = [...APP.data.batting].sort((a,b) => num(b.Runs)-num(a.Runs)).slice(0,5);
  destroyChart("runs");
  APP.charts.runs = new Chart(el("runsChart"), {
    type: "bar",
    data: { labels: topRuns.map(r => r.Player), datasets: [{ label: "Runs", data: topRuns.map(r => num(r.Runs)), borderRadius: 8, backgroundColor: "#2e69cf" }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, grid:{ color:grid } }, x:{ grid:{ display:false } } } }
  });

  const topWickets = [...APP.data.bowling].sort((a,b) => num(b.Wickets)-num(a.Wickets)).slice(0,5);
  destroyChart("wickets");
  APP.charts.wickets = new Chart(el("wicketsChart"), {
    type: "bar",
    data: { labels: topWickets.map(r => r.Player), datasets: [{ label: "Wickets", data: topWickets.map(r => num(r.Wickets)), borderRadius: 8, backgroundColor: "#db4a5a" }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ beginAtZero:true, grid:{ color:grid }, ticks:{ precision:0 } }, x:{ grid:{ display:false } } } }
  });

  const resultCounts = { Wins:0, Losses:0, Draws:0, Other:0 };
  APP.data.matches.forEach(m => {
    const result = String(m.Result || "").toLowerCase();
    if (/win|won|victory/.test(result)) resultCounts.Wins++;
    else if (/loss|lost|defeat/.test(result)) resultCounts.Losses++;
    else if (/draw|tie/.test(result)) resultCounts.Draws++;
    else resultCounts.Other++;
  });
  destroyChart("performance");
  APP.charts.performance = new Chart(el("performanceChart"), {
    type: "doughnut",
    data: { labels: Object.keys(resultCounts), datasets:[{ data:Object.values(resultCounts), backgroundColor:["#20a56a","#db4a5a","#bc8a1e","#6d7f9a"], borderWidth:0 }] },
    options:{ responsive:true, maintainAspectRatio:false, cutout:"66%", plugins:{ legend:{ position:"bottom" } } }
  });
}

function populateVsSelectors() {
  const names = [...APP.playerIndex.keys()].sort((a,b) => a.localeCompare(b));
  [el("vsPlayerA"), el("vsPlayerB")].forEach(select => {
    const current = select.value;
    select.innerHTML = names.map(name => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
    if (names.includes(current)) select.value = current;
  });
  if (names.length > 1) {
    if (!el("vsPlayerA").value) el("vsPlayerA").value = names[0];
    if (!el("vsPlayerB").value || el("vsPlayerB").value === el("vsPlayerA").value) el("vsPlayerB").value = names[1];
  }
}

function renderVsComparison() {
  const aName = el("vsPlayerA").value;
  const bName = el("vsPlayerB").value;
  const a = APP.playerIndex.get(aName);
  const b = APP.playerIndex.get(bName);
  const box = el("vsComparison");
  if (!a || !b) { box.innerHTML = ""; return; }

  const metrics = [
    ["Runs", num(a.batting.Runs), num(b.batting.Runs), "high"],
    ["Strike Rate", num(a.batting["S/R"]), num(b.batting["S/R"]), "high"],
    ["Average (Bat)", num(a.batting.Ave), num(b.batting.Ave), "high"],
    ["Highest Score", num(a.batting.HS), num(b.batting.HS), "high"],
    ["Wickets", num(a.bowling.Wickets), num(b.bowling.Wickets), "high"],
    ["Economy", num(a.bowling.Economy), num(b.bowling.Economy), "low"],
    ["Average (Bowl)", num(a.bowling.Ave), num(b.bowling.Ave), "low"],
    ["Bowling S/R", num(a.bowling["S/R"]), num(b.bowling["S/R"]), "low"]
  ];

  const rows = metrics.map(([label, av, bv, mode]) => {
    const aHas = String(a.batting[label] ?? a.bowling[label] ?? "").trim() !== "" || av !== 0;
    const bHas = String(b.batting[label] ?? b.bowling[label] ?? "").trim() !== "" || bv !== 0;
    const aWin = aHas && bHas && av !== bv && (mode === "high" ? av > bv : av < bv);
    const bWin = aHas && bHas && av !== bv && (mode === "high" ? bv > av : bv < av);
    return `
      <div class="compare-row">
        <div class="compare-cell compare-value ${aWin ? "winner" : ""} ${!aHas ? "na" : ""}">${aHas ? displayNum(av) : "—"}</div>
        <div class="compare-cell compare-stat">${escapeHtml(label)}</div>
        <div class="compare-cell compare-value ${bWin ? "winner" : ""} ${!bHas ? "na" : ""}">${bHas ? displayNum(bv) : "—"}</div>
      </div>`;
  }).join("");

  box.innerHTML = `
    <div class="compare-cell compare-grid-head compare-value">${escapeHtml(aName)}</div>
    <div class="compare-cell compare-grid-head compare-stat">STAT</div>
    <div class="compare-cell compare-grid-head compare-value">${escapeHtml(bName)}</div>
    ${rows}`;
}

function openPlayerModal(name) {
  const player = APP.playerIndex.get(name);
  if (!player) return;
  const batting = player.batting;
  const bowling = player.bowling;
  const photo = batting.Photo || "";
  const badges = [...eliteBadges(batting, "batting"), ...eliteBadges(bowling, "bowling")];

  const avatar = playerAvatar(name, photo, "player-hero-avatar");
  const body = el("playerModalBody");
  body.innerHTML = "";
  const hero = document.createElement("div");
  hero.className = "player-hero";
  hero.appendChild(avatar);
  hero.insertAdjacentHTML("beforeend", `
    <div>
      <p class="eyebrow">2026–27 PLAYER PROFILE</p>
      <h2 class="title is-3 mb-2">${escapeHtml(name)}</h2>
      <p class="has-text-grey">${badges.length ? badges.map(escapeHtml).join(" · ") : "Season stats"}</p>
    </div>`);
  body.appendChild(hero);

  const stats = [
    ["Runs", batting.Runs],
    ["Wickets", bowling.Wickets],
    ["Average", batting.Ave || bowling.Ave],
    ["S/R", batting["S/R"] || bowling["S/R"]],
    ["HS", batting.HS]
  ];
  const grid = document.createElement("div");
  grid.className = "profile-stats";
  stats.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "profile-stat";
    card.innerHTML = `<span class="profile-stat-label">${escapeHtml(label)}</span><span class="profile-stat-value">${escapeHtml(displayNum(value))}</span>`;
    grid.appendChild(card);
  });
  body.appendChild(grid);

  const modal = el("playerModal");
  modal.classList.add("is-active");
  document.documentElement.classList.add("is-clipped");
}

function closeModal() {
  el("playerModal").classList.remove("is-active");
  document.documentElement.classList.remove("is-clipped");
}

function setupTheme() {
  const saved = localStorage.getItem("blueDemonTheme");
  const dark = saved === "dark";
  document.body.classList.toggle("theme-dark", dark);
  updateThemeButton();
}

function updateThemeButton() {
  const dark = document.body.classList.contains("theme-dark");
  el("themeToggle").querySelector(".theme-icon").textContent = dark ? "☀" : "☾";
  el("themeToggle").querySelector(".theme-label").textContent = dark ? "Light" : "Dark";
}

function toggleTheme() {
  const dark = !document.body.classList.contains("theme-dark");
  document.body.classList.toggle("theme-dark", dark);
  localStorage.setItem("blueDemonTheme", dark ? "dark" : "light");
  updateThemeButton();
  renderCharts();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

function escapeAttr(value) { return escapeHtml(value); }

function setupEvents() {
  el("themeToggle").addEventListener("click", toggleTheme);
  el("refreshDataBtn").addEventListener("click", () => loadSeason(APP.season).catch(handleLoadError));
  el("seasonSelect").addEventListener("change", async (event) => {
    APP.season = event.target.value;
    await loadSeason(APP.season).catch(handleLoadError);
  });
  ["vsPlayerA", "vsPlayerB"].forEach(id => el(id).addEventListener("change", renderVsComparison));
  document.querySelectorAll("[data-close-modal]").forEach(node => node.addEventListener("click", closeModal));
  el("playerModal").querySelector(".modal-background").addEventListener("click", closeModal);
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });

  const burger = document.querySelector(".navbar-burger");
  burger.addEventListener("click", () => {
    const target = el(burger.dataset.target);
    burger.classList.toggle("is-active");
    target.classList.toggle("is-active");
    burger.setAttribute("aria-expanded", burger.classList.contains("is-active") ? "true" : "false");
  });
  document.querySelectorAll(".nav-link").forEach(link => link.addEventListener("click", () => {
    burger.classList.remove("is-active");
    el("mainNav").classList.remove("is-active");
    burger.setAttribute("aria-expanded", "false");
  }));
}

function handleLoadError(error) {
  console.error(error);
  setSyncStatus(`Sync error · ${error.message || "Could not load live sheets"}`, false);
}

async function init() {
  setupTheme();
  setupEvents();
  // Render shell first; live values replace these once Sheets return data.
  renderAll();
  await loadSeason(APP.season).catch(handleLoadError);
  APP.initialized = true;
}

document.addEventListener("DOMContentLoaded", init);
