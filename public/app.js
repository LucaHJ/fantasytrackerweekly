const path = window.location.pathname;
const API_BASE = path.startsWith("/fantasy") ? "/fantasy" : "";

// DOM references -----------------------------------------------------------

const weekSelect = document.getElementById("weekSelect");
const addWeekBtn = document.getElementById("addWeekBtn");
const editWeekBtn = document.getElementById("editWeekBtn");
const deleteWeekBtn = document.getElementById("deleteWeekBtn");
const addTeamBtn = document.getElementById("addTeamBtn");
const statsTable = document.getElementById("statsTable");
const statusEl = document.getElementById("status");
const deletedWeeksContainer = document.getElementById("deletedWeeksContainer");
const deletedTeamsContainer = document.getElementById("deletedTeamsContainer");

// Team view elements
const teamViewSelect = document.getElementById("teamViewSelect");
const teamViewTable = document.getElementById("teamViewTable");
const teamViewStatus = document.getElementById("teamViewStatus");
const teamViewRefreshBtn = document.getElementById("teamViewRefreshBtn");
const editTeamNameBtn = document.getElementById("editTeamNameBtn");
const teamChartTitleEl = document.getElementById("teamChartTitle");

// Chart elements
const teamChartCanvas = document.getElementById("teamChart");
const teamChartMetricLabel = document.getElementById("teamChartMetricLabel");
const teamChartCtx = teamChartCanvas.getContext("2d");
let teamChartMetric = "total";

// Admin mode ---------------------------------------------------------------

const adminToggleBtn = document.getElementById("adminToggleBtn");
const ADMIN_STORAGE_KEY = "fantasyAdminMode";
let isAdmin = false;

function applyAdminVisibility() {
    const adminEls = document.querySelectorAll(".admin-only");
    adminEls.forEach((el) => {
        if (isAdmin) {
            el.classList.remove("admin-only-hidden");
        } else {
            el.classList.add("admin-only-hidden");
        }
    });

    if (adminToggleBtn) {
        adminToggleBtn.textContent = isAdmin ? "Admin log out" : "Admin log in";
    }
}

function setAdminMode(enabled) {
    isAdmin = !!enabled;
    try {
        if (isAdmin) {
            localStorage.setItem(ADMIN_STORAGE_KEY, "1");
        } else {
            localStorage.removeItem(ADMIN_STORAGE_KEY);
        }
    } catch {
        // ignore storage errors
    }
    applyAdminVisibility();
}

function ensureAdmin() {
    if (!isAdmin) {
        alert(
            "Admin mode is required for this action. Use the 'Admin log in' button at the bottom."
        );
        return false;
    }
    return true;
}

// Data state ---------------------------------------------------------------

let weeks = [];
let teams = [];
let deletedWeeks = [];
let deletedTeams = [];
let currentWeekId = null;
let rowsData = [];
let rankingData = [];
let rankingOrder = [];
let teamViewData = [];

let weekSortState = { type: "total", field: null, direction: "asc" };

const statDefs = [
    { field: "fg_pct", label: "FG%", highBetter: true },
    { field: "ft_pct", label: "FT%", highBetter: true },
    { field: "three_ptm", label: "3PTM", highBetter: true },
    { field: "pts", label: "PTS", highBetter: true },
    { field: "reb", label: "REB", highBetter: true },
    { field: "ast", label: "AST", highBetter: true },
    { field: "st", label: "ST", highBetter: true },
    { field: "blk", label: "BLK", highBetter: true },
    { field: "turnovers", label: "TO", highBetter: false },
];

// Helpers ------------------------------------------------------------------

function weekLabelFromNumber(n) {
    return `Week ${n}`;
}

function setStatus(msg, type = "") {
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (type ? " " + type : "");
}

function setTeamViewStatus(msg, type = "") {
    teamViewStatus.textContent = msg || "";
    teamViewStatus.className = "status" + (type ? " " + type : "");
}

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) {
        let txt = "";
        try {
            txt = await res.text();
        } catch {
            // ignore
        }
        throw new Error(txt || res.statusText);
    }
    try {
        return await res.json();
    } catch {
        return null;
    }
}

// Loaders ------------------------------------------------------------------

async function loadWeeks() {
    weeks = await fetchJSON(`${API_BASE}/api/weeks`);
    if (weeks.length === 0) {
        const week = await fetchJSON(`${API_BASE}/api/weeks`, {
            method: "POST",
            body: JSON.stringify({ weekNumber: 1 }),
        });
        weeks.push(week);
    }
    weeks.sort((a, b) => a.week_number - b.week_number);
    renderWeekSelect();
}

async function loadTeams() {
    teams = await fetchJSON(`${API_BASE}/api/teams`);
    teams.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    renderTeamViewSelect();
    updateTeamChartTitle();
}

async function loadDeletedWeeks() {
    deletedWeeks = await fetchJSON(`${API_BASE}/api/weeks/deleted`);
    renderDeletedLists();
}

async function loadDeletedTeams() {
    deletedTeams = await fetchJSON(`${API_BASE}/api/teams/deleted`);
    renderDeletedLists();
}

// Rendering: selectors -----------------------------------------------------

function renderWeekSelect() {
    weekSelect.innerHTML = "";
    weeks.forEach((w) => {
        const opt = document.createElement("option");
        opt.value = w.id;
        opt.textContent = weekLabelFromNumber(w.week_number);
        weekSelect.appendChild(opt);
    });

    if (!currentWeekId && weeks.length > 0) {
        currentWeekId = weeks[0].id;
    }

    if (currentWeekId) {
        weekSelect.value = String(currentWeekId);
    }
}

function renderTeamViewSelect() {
    const selectedId = Number(teamViewSelect.value) || null;
    teamViewSelect.innerHTML = "";

    if (!teams.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No teams";
        teamViewSelect.appendChild(opt);
        return;
    }

    teams.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.id;
        const label = t.owner_name ? `${t.name} - ${t.owner_name}` : t.name;
        opt.textContent = label;
        teamViewSelect.appendChild(opt);
    });

    if (selectedId && teams.some((t) => t.id === selectedId)) {
        teamViewSelect.value = String(selectedId);
    } else {
        teamViewSelect.value = String(teams[0].id);
    }
    updateTeamChartTitle();
}

function updateTeamChartTitle() {
    const teamId = Number(teamViewSelect.value);
    const team = teams.find((t) => t.id === teamId);
    if (!team) {
        teamChartTitleEl.textContent = "Trend by week";
        return;
    }
    if (team.owner_name) {
        teamChartTitleEl.textContent = `Trend by week - ${team.name} (${team.owner_name})`;
    } else {
        teamChartTitleEl.textContent = `Trend by week - ${team.name}`;
    }
}

// Week CRUD ----------------------------------------------------------------

async function addWeek() {
    if (!ensureAdmin()) return;

    const input = prompt("Enter week number (positive integer):", "");
    if (input === null) return;

    const n = Number(input);
    if (!Number.isInteger(n) || n <= 0) {
        alert("Week number must be a positive integer (1, 2, 3, ...).");
        return;
    }

    const existsClient = weeks.some((w) => w.week_number === n);
    if (existsClient) {
        alert("That week number already exists.");
        return;
    }

    try {
        const week = await fetchJSON(`${API_BASE}/api/weeks`, {
            method: "POST",
            body: JSON.stringify({ weekNumber: n }),
        });
        weeks.push(week);
        weeks.sort((a, b) => a.week_number - b.week_number);
        currentWeekId = week.id;
        renderWeekSelect();
        await loadStatsForCurrentWeek();
        await loadDeletedWeeks();
        await loadTeamViewIfTeamSelected();
        setStatus("Week added", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error adding week (maybe number already exists)", "err");
    }
}

async function editCurrentWeek() {
    if (!ensureAdmin()) return;
    if (!currentWeekId) return;
    const current = weeks.find((w) => w.id === currentWeekId);
    if (!current) return;

    const input = prompt(
        "Edit week number (positive integer):",
        String(current.week_number)
    );
    if (input === null) return;

    const n = Number(input);
    if (!Number.isInteger(n) || n <= 0) {
        alert("Week number must be a positive integer (1, 2, 3, ...).");
        return;
    }

    if (weeks.some((w) => w.week_number === n && w.id !== currentWeekId)) {
        alert("That week number already exists.");
        return;
    }

    try {
        const updated = await fetchJSON(`${API_BASE}/api/weeks/${currentWeekId}`, {
            method: "PATCH",
            body: JSON.stringify({ weekNumber: n }),
        });

        const idx = weeks.findIndex((w) => w.id === currentWeekId);
        if (idx !== -1) {
            weeks[idx] = updated;
            weeks.sort((a, b) => a.week_number - b.week_number);
        }
        renderWeekSelect();
        await loadStatsForCurrentWeek();
        await loadDeletedWeeks();
        await loadTeamViewIfTeamSelected();
        setStatus("Week number updated", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error updating week number", "err");
    }
}

async function deleteWeek() {
    if (!ensureAdmin()) return;
    if (!currentWeekId) return;
    if (weeks.length <= 1) {
        alert("You must keep at least one active week.");
        return;
    }

    const currentWeek = weeks.find((w) => w.id === currentWeekId);
    const label = currentWeek
        ? weekLabelFromNumber(currentWeek.week_number)
        : `Week ${currentWeekId}`;

    if (!confirm(`Move "${label}" to trash (can be restored later)?`)) {
        return;
    }

    try {
        await fetchJSON(`${API_BASE}/api/weeks/${currentWeekId}`, {
            method: "DELETE",
        });

        weeks = weeks.filter((w) => w.id !== currentWeekId);

        if (weeks.length > 0) {
            currentWeekId = weeks[0].id;
        } else {
            currentWeekId = null;
        }

        renderWeekSelect();
        await loadStatsForCurrentWeek();
        await loadDeletedWeeks();
        await loadTeamViewIfTeamSelected();
        setStatus("Week moved to trash", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error deleting week", "err");
    }
}

async function restoreWeek(id) {
    if (!ensureAdmin()) return;
    try {
        await fetchJSON(`${API_BASE}/api/weeks/${id}/restore`, {
            method: "POST",
        });
        await loadWeeks();
        await loadDeletedWeeks();

        if (!currentWeekId && weeks.length > 0) {
            currentWeekId = weeks[0].id;
        }
        if (currentWeekId) {
            weekSelect.value = String(currentWeekId);
        }
        await loadStatsForCurrentWeek();
        await loadTeamViewIfTeamSelected();
        setStatus("Week restored", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error restoring week", "err");
    }
}

async function forceDeleteWeek(id) {
    if (!ensureAdmin()) return;
    if (!confirm("Permanently delete this week and all its stats? This cannot be undone.")) {
        return;
    }
    try {
        await fetchJSON(`${API_BASE}/api/weeks/${id}/permanent`, {
            method: "DELETE",
        });
        await loadDeletedWeeks();
        await loadTeamViewIfTeamSelected();
        setStatus("Week permanently deleted", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error permanently deleting week", "err");
    }
}

// Team CRUD ----------------------------------------------------------------

async function addTeam() {
    if (!ensureAdmin()) return;

    const input = prompt('Enter team as "Team Name, Owner Name":', "");
    if (input === null) return;

    const parts = input.split(",");
    const namePart = parts[0] ? parts[0].trim() : "";
    const ownerPart = parts.slice(1).join(",").trim();

    if (!namePart) {
        alert("Team name cannot be empty.");
        return;
    }

    try {
        const team = await fetchJSON(`${API_BASE}/api/teams`, {
            method: "POST",
            body: JSON.stringify({ name: namePart, owner: ownerPart || null }),
        });
        teams.push(team);
        teams.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        renderTeamViewSelect();
        await loadStatsForCurrentWeek();
        await loadDeletedTeams();
        await loadTeamViewIfTeamSelected();
        setStatus("Team added", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error adding team (maybe name already exists)", "err");
    }
}

async function editSelectedTeamName() {
    if (!ensureAdmin()) return;

    const teamId = Number(teamViewSelect.value);
    if (!teamId) {
        alert("Select a team first.");
        return;
    }
    const current = teams.find((t) => t.id === teamId);
    if (!current) return;

    const defaultValue = current.owner_name
        ? `${current.name}, ${current.owner_name}`
        : current.name;

    const input = prompt('Edit as "Team Name, Owner Name":', defaultValue);
    if (input === null) return;

    const parts = input.split(",");
    const namePart = parts[0] ? parts[0].trim() : "";
    const ownerPart = parts.slice(1).join(",").trim();

    if (!namePart) {
        alert("Team name cannot be empty.");
        return;
    }

    if (
        teams.some(
            (t) =>
                t.name.toLowerCase() === namePart.toLowerCase() &&
                t.id !== teamId
        )
    ) {
        alert("Another team already uses that name.");
        return;
    }

    try {
        const updated = await fetchJSON(`${API_BASE}/api/teams/${teamId}`, {
            method: "PATCH",
            body: JSON.stringify({ name: namePart, owner: ownerPart || null }),
        });

        const idx = teams.findIndex((t) => t.id === teamId);
        if (idx !== -1) {
            teams[idx] = updated;
            teams.sort((a, b) =>
                a.name.toLowerCase().localeCompare(b.name.toLowerCase())
            );
        }
        renderTeamViewSelect();
        teamViewSelect.value = String(teamId);
        updateTeamChartTitle();
        await loadStatsForCurrentWeek();
        await loadTeamViewIfTeamSelected();
        setStatus("Team updated", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error updating team", "err");
    }
}

async function deleteTeam(teamId, teamName) {
    if (!ensureAdmin()) return;
    if (!teamId) return;

    const confirmed = confirm(
        `Move "${teamName}" to trash? All stats are kept and can be restored.`
    );
    if (!confirmed) return;

    try {
        await fetchJSON(`${API_BASE}/api/teams/${teamId}`, {
            method: "DELETE",
        });

        teams = teams.filter((t) => t.id !== teamId);

        renderTeamViewSelect();
        await loadStatsForCurrentWeek();
        await loadDeletedTeams();
        await loadTeamViewIfTeamSelected();
        setStatus("Team moved to trash", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error deleting team", "err");
    }
}

async function restoreTeam(id) {
    if (!ensureAdmin()) return;

    try {
        await fetchJSON(`${API_BASE}/api/teams/${id}/restore`, {
            method: "POST",
        });
        await loadTeams();
        await loadDeletedTeams();
        await loadStatsForCurrentWeek();
        await loadTeamViewIfTeamSelected();
        setStatus("Team restored", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error restoring team", "err");
    }
}

async function forceDeleteTeam(id) {
    if (!ensureAdmin()) return;

    if (
        !confirm(
            "Permanently delete this team and all its stats from all weeks? This cannot be undone."
        )
    ) {
        return;
    }
    try {
        await fetchJSON(`${API_BASE}/api/teams/${id}/permanent`, {
            method: "DELETE",
        });
        await loadDeletedTeams();
        await loadTeamViewIfTeamSelected();
        setStatus("Team permanently deleted", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error permanently deleting team", "err");
    }
}

// Stats / ranking ----------------------------------------------------------

async function loadStatsForCurrentWeek() {
    if (!currentWeekId) {
        statsTable.innerHTML = "<tr><td>No week selected.</td></tr>";
        applyAdminVisibility();
        return;
    }
    setStatus("Loading stats...");
    try {
        rowsData = await fetchJSON(
            `${API_BASE}/api/stats?weekId=${encodeURIComponent(currentWeekId)}`
        );
        computeRanking();
        weekSortState = { type: "total", field: null, direction: "asc" };
        renderWeekTable();
        setStatus("Loaded", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error loading stats", "err");
    }
}

function formatOrdinal(n) {
    if (n == null) return "";
    const s = ["th", "st", "nd", "rd"],
        v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function getRankClass(rank, totalTeams) {
    if (!rank || !totalTeams || totalTeams < 2) return "";
    if (rank === 1) return "rank-first";
    if (rank === totalTeams) return "rank-last";
    return "";
}

function computeRanking() {
    const n = rowsData.length;
    rankingData = rowsData.map(() => ({
        perStat: {},
        totalScore: 0,
        totalRank: null,
    }));
    rankingOrder = rowsData.map((_, idx) => idx);
    if (n === 0) return;

    for (const stat of statDefs) {
        const { field, highBetter } = stat;
        const items = rowsData.map((row, index) => {
            const vRaw = row[field];
            const hasVal = vRaw !== null && vRaw !== undefined && vRaw !== "";
            let value = Number(hasVal ? vRaw : NaN);
            if (!hasVal || Number.isNaN(value)) {
                value = highBetter
                    ? Number.NEGATIVE_INFINITY
                    : Number.POSITIVE_INFINITY;
            }
            return { index, value };
        });

        items.sort((a, b) => {
            if (a.value === b.value) return 0;
            return highBetter ? b.value - a.value : a.value - b.value;
        });

        let rank = 1;
        for (let i = 0; i < items.length; i++) {
            if (i > 0 && items[i].value !== items[i - 1].value) {
                rank = i + 1;
            }
            const rowIndex = items[i].index;
            const bracket = n + 1 - rank;
            rankingData[rowIndex].perStat[field] = { rank, bracket };
            rankingData[rowIndex].totalScore += bracket;
        }
    }

    const totalItems = rankingData.map((r, index) => ({
        index,
        value: r.totalScore,
    }));
    totalItems.sort((a, b) => b.value - a.value);

    let rank = 1;
    for (let i = 0; i < totalItems.length; i++) {
        if (i > 0 && totalItems[i].value !== totalItems[i - 1].value) {
            rank = i + 1;
        }
        rankingData[totalItems[i].index].totalRank = rank;
    }

    rankingOrder.sort((a, b) => {
        const ra = rankingData[a].totalRank ?? Number.MAX_SAFE_INTEGER;
        const rb = rankingData[b].totalRank ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        const na = (rowsData[a].team_name || "").toLowerCase();
        const nb = (rowsData[b].team_name || "").toLowerCase();
        if (na < nb) return -1;
        if (na > nb) return 1;
        return 0;
    });
}

function getWeekOrder() {
    const n = rowsData.length;
    if (!n) return [];

    const indices = rowsData.map((_, i) => i);

    if (weekSortState.type === "total") {
        indices.sort((a, b) => {
            const ra = rankingData[a].totalRank ?? Number.MAX_SAFE_INTEGER;
            const rb = rankingData[b].totalRank ?? Number.MAX_SAFE_INTEGER;
            if (ra === rb) {
                const na = (rowsData[a].team_name || "").toLowerCase();
                const nb = (rowsData[b].team_name || "").toLowerCase();
                if (na < nb) return -1;
                if (na > nb) return 1;
                return 0;
            }
            return weekSortState.direction === "asc" ? ra - rb : rb - ra;
        });
        return indices;
    }

    if (weekSortState.type === "stat" && weekSortState.field) {
        const field = weekSortState.field;
        indices.sort((a, b) => {
            const va = Number(rowsData[a][field]);
            const vb = Number(rowsData[b][field]);

            const aNaN = Number.isNaN(va);
            const bNaN = Number.isNaN(vb);
            if (aNaN && bNaN) return 0;
            if (aNaN) return 1;
            if (bNaN) return -1;

            if (va === vb) {
                const na = (rowsData[a].team_name || "").toLowerCase();
                const nb = (rowsData[b].team_name || "").toLowerCase();
                if (na < nb) return -1;
                if (na > nb) return 1;
                return 0;
            }

            return weekSortState.direction === "asc" ? va - vb : vb - va;
        });
        return indices;
    }

    return rankingOrder.length ? rankingOrder.slice() : indices;
}

function renderWeekTable() {
    if (!rowsData || rowsData.length === 0) {
        statsTable.innerHTML = "<tr><td>No data yet. Add teams.</td></tr>";
        applyAdminVisibility();
        return;
    }

    const headerDefs = [
        { label: "Team", sort: null },
        { label: "FG%", sort: "fg_pct" },
        { label: "FT%", sort: "ft_pct" },
        { label: "3PTM", sort: "three_ptm" },
        { label: "PTS", sort: "pts" },
        { label: "REB", sort: "reb" },
        { label: "AST", sort: "ast" },
        { label: "ST", sort: "st" },
        { label: "BLK", sort: "blk" },
        { label: "TO", sort: "turnovers" },
        { label: "Total", sort: "total" },
        { label: "Actions", sort: null, adminOnly: true },
    ];

    let thead = "<thead><tr>";
    headerDefs.forEach((h) => {
        const adminClass = h.adminOnly ? ' class="admin-only"' : "";
        if (h.sort) {
            thead += `<th data-sort="${h.sort}"${adminClass}>${h.label}</th>`;
        } else {
            thead += `<th${adminClass}>${h.label}</th>`;
        }
    });
    thead += "</tr></thead>";

    let tbody = "<tbody>";

    const totalTeams = rowsData.length;
    const order = getWeekOrder();

    order.forEach((rowIndex) => {
        const row = rowsData[rowIndex];
        const {
            team_id,
            team_name,
            owner_name,
            fg_pct,
            ft_pct,
            three_ptm,
            pts,
            reb,
            ast,
            st,
            blk,
            turnovers,
        } = row;

        const rankInfo =
            rankingData[rowIndex] || { perStat: {}, totalScore: 0, totalRank: null };

        const fgRank = rankInfo.perStat.fg_pct || {};
        const ftRank = rankInfo.perStat.ft_pct || {};
        const threeRank = rankInfo.perStat.three_ptm || {};
        const ptsRank = rankInfo.perStat.pts || {};
        const rebRank = rankInfo.perStat.reb || {};
        const astRank = rankInfo.perStat.ast || {};
        const stRank = rankInfo.perStat.st || {};
        const blkRank = rankInfo.perStat.blk || {};
        const toRank = rankInfo.perStat.turnovers || {};

        tbody += `<tr data-row-index="${rowIndex}">
      <td>
        <div class="team-cell">
          <div class="team-name">${team_name}</div>
          <div class="team-owner">${owner_name ? owner_name : ""}</div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${fg_pct ?? ""}</div>
          <div class="stat-rank ${getRankClass(fgRank.rank, totalTeams)}">
            ${fgRank.rank
                ? `${formatOrdinal(fgRank.rank)} (${fgRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ft_pct ?? ""}</div>
          <div class="stat-rank ${getRankClass(ftRank.rank, totalTeams)}">
            ${ftRank.rank
                ? `${formatOrdinal(ftRank.rank)} (${ftRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${three_ptm ?? ""}</div>
          <div class="stat-rank ${getRankClass(threeRank.rank, totalTeams)}">
            ${threeRank.rank
                ? `${formatOrdinal(threeRank.rank)} (${threeRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${pts ?? ""}</div>
          <div class="stat-rank ${getRankClass(ptsRank.rank, totalTeams)}">
            ${ptsRank.rank
                ? `${formatOrdinal(ptsRank.rank)} (${ptsRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${reb ?? ""}</div>
          <div class="stat-rank ${getRankClass(rebRank.rank, totalTeams)}">
            ${rebRank.rank
                ? `${formatOrdinal(rebRank.rank)} (${rebRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ast ?? ""}</div>
          <div class="stat-rank ${getRankClass(astRank.rank, totalTeams)}">
            ${astRank.rank
                ? `${formatOrdinal(astRank.rank)} (${astRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${st ?? ""}</div>
          <div class="stat-rank ${getRankClass(stRank.rank, totalTeams)}">
            ${stRank.rank
                ? `${formatOrdinal(stRank.rank)} (${stRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${blk ?? ""}</div>
          <div class="stat-rank ${getRankClass(blkRank.rank, totalTeams)}">
            ${blkRank.rank
                ? `${formatOrdinal(blkRank.rank)} (${blkRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${turnovers ?? ""}</div>
          <div class="stat-rank ${getRankClass(toRank.rank, totalTeams)}">
            ${toRank.rank
                ? `${formatOrdinal(toRank.rank)} (${toRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td class="total-cell">
        <span class="${getRankClass(rankInfo.totalRank, totalTeams)}">
          ${rankInfo.totalRank
                ? `${formatOrdinal(rankInfo.totalRank)} (${rankInfo.totalScore ?? 0
                })`
                : rankInfo.totalScore ?? 0
            }
        </span>
      </td>

      <td class="admin-only">
        <button
          type="button"
          class="admin-only"
          data-action="edit-team"
          data-row-index="${rowIndex}"
        >
          Edit stats
        </button>
        <button
          type="button"
          class="secondary admin-only"
          data-action="delete-team"
          data-team-id="${team_id}"
        >
          Delete
        </button>
      </td>
    </tr>`;
    });

    tbody += "</tbody>";
    statsTable.innerHTML = thead + tbody;
    applyAdminVisibility();
}

// Team view ----------------------------------------------------------------

async function loadTeamView() {
    const teamId = Number(teamViewSelect.value);
    if (!teamId) {
        teamViewTable.innerHTML = "<tr><td>Select a team.</td></tr>";
        clearTeamChart();
        setTeamViewStatus("", "");
        return;
    }
    if (!weeks.length) {
        teamViewTable.innerHTML = "<tr><td>No weeks available.</td></tr>";
        clearTeamChart();
        setTeamViewStatus("", "");
        return;
    }

    setTeamViewStatus("Loading team view...", "");
    teamViewData = [];

    try {
        for (const w of weeks) {
            const weekRows = await fetchJSON(
                `${API_BASE}/api/stats?weekId=${encodeURIComponent(w.id)}`
            );
            if (!Array.isArray(weekRows) || weekRows.length === 0) continue;

            const n = weekRows.length;
            const weekRanking = weekRows.map(() => ({
                perStat: {},
                totalScore: 0,
                totalRank: null,
            }));

            for (const stat of statDefs) {
                const { field, highBetter } = stat;
                const items = weekRows.map((row, index) => {
                    const vRaw = row[field];
                    const hasVal =
                        vRaw !== null && vRaw !== undefined && vRaw !== "";
                    let value = Number(hasVal ? vRaw : NaN);
                    if (!hasVal || Number.isNaN(value)) {
                        value = highBetter
                            ? Number.NEGATIVE_INFINITY
                            : Number.POSITIVE_INFINITY;
                    }
                    return { index, value };
                });

                items.sort((a, b) => {
                    if (a.value === b.value) return 0;
                    return highBetter ? b.value - a.value : a.value - b.value;
                });

                let rank = 1;
                for (let i = 0; i < items.length; i++) {
                    if (i > 0 && items[i].value !== items[i - 1].value) {
                        rank = i + 1;
                    }
                    const rowIndex = items[i].index;
                    const bracket = n + 1 - rank;
                    weekRanking[rowIndex].perStat[field] = { rank, bracket };
                    weekRanking[rowIndex].totalScore += bracket;
                }
            }

            const totalItems = weekRanking.map((r, index) => ({
                index,
                value: r.totalScore,
            }));
            totalItems.sort((a, b) => b.value - a.value);

            let rank = 1;
            for (let i = 0; i < totalItems.length; i++) {
                if (i > 0 && totalItems[i].value !== totalItems[i - 1].value) {
                    rank = i + 1;
                }
                weekRanking[totalItems[i].index].totalRank = rank;
            }

            const idx = weekRows.findIndex((r) => r.team_id === teamId);
            if (idx === -1) continue;

            const row = weekRows[idx];
            const rInfo = weekRanking[idx];

            teamViewData.push({
                weekId: w.id,
                weekNumber: w.week_number,
                label: weekLabelFromNumber(w.week_number),
                row,
                ranking: rInfo,
                teamCount: n,
            });
        }

        renderTeamViewTable();
        setTeamViewStatus("Loaded", "ok");
    } catch (err) {
        console.error(err);
        clearTeamChart();
        setTeamViewStatus("Error loading team view", "err");
    }
}

async function loadTeamViewIfTeamSelected() {
    const teamId = Number(teamViewSelect.value);
    if (teamId) {
        await loadTeamView();
    }
}

function renderTeamViewTable() {
    if (!teamViewData.length) {
        teamViewTable.innerHTML = "<tr><td>No data for this team.</td></tr>";
        clearTeamChart();
        return;
    }

    const headerDefs = [
        { label: "Week", chart: null },
        { label: "FG%", chart: "fg_pct" },
        { label: "FT%", chart: "ft_pct" },
        { label: "3PTM", chart: "three_ptm" },
        { label: "PTS", chart: "pts" },
        { label: "REB", chart: "reb" },
        { label: "AST", chart: "ast" },
        { label: "ST", chart: "st" },
        { label: "BLK", chart: "blk" },
        { label: "TO", chart: "turnovers" },
        { label: "Total", chart: "total" },
    ];

    let thead = "<thead><tr>";
    headerDefs.forEach((h) => {
        if (h.chart) {
            thead += `<th data-chart="${h.chart}">${h.label}</th>`;
        } else {
            thead += `<th>${h.label}</th>`;
        }
    });
    thead += "</tr></thead>";

    let tbody = "<tbody>";

    const ordered = [...teamViewData].sort(
        (a, b) => a.weekNumber - b.weekNumber
    );

    ordered.forEach((entry) => {
        const { label, row, ranking, teamCount } = entry;
        const {
            fg_pct,
            ft_pct,
            three_ptm,
            pts,
            reb,
            ast,
            st,
            blk,
            turnovers,
        } = row;

        const fgRank = ranking.perStat.fg_pct || {};
        const ftRank = ranking.perStat.ft_pct || {};
        const threeRank = ranking.perStat.three_ptm || {};
        const ptsRank = ranking.perStat.pts || {};
        const rebRank = ranking.perStat.reb || {};
        const astRank = ranking.perStat.ast || {};
        const stRank = ranking.perStat.st || {};
        const blkRank = ranking.perStat.blk || {};
        const toRank = ranking.perStat.turnovers || {};

        tbody += `<tr>
      <td>${label}</td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${fg_pct ?? ""}</div>
          <div class="stat-rank ${getRankClass(fgRank.rank, teamCount)}">
            ${fgRank.rank
                ? `${formatOrdinal(fgRank.rank)} (${fgRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ft_pct ?? ""}</div>
          <div class="stat-rank ${getRankClass(ftRank.rank, teamCount)}">
            ${ftRank.rank
                ? `${formatOrdinal(ftRank.rank)} (${ftRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${three_ptm ?? ""}</div>
          <div class="stat-rank ${getRankClass(threeRank.rank, teamCount)}">
            ${threeRank.rank
                ? `${formatOrdinal(threeRank.rank)} (${threeRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${pts ?? ""}</div>
          <div class="stat-rank ${getRankClass(ptsRank.rank, teamCount)}">
            ${ptsRank.rank
                ? `${formatOrdinal(ptsRank.rank)} (${ptsRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${reb ?? ""}</div>
          <div class="stat-rank ${getRankClass(rebRank.rank, teamCount)}">
            ${rebRank.rank
                ? `${formatOrdinal(rebRank.rank)} (${rebRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ast ?? ""}</div>
          <div class="stat-rank ${getRankClass(astRank.rank, teamCount)}">
            ${astRank.rank
                ? `${formatOrdinal(astRank.rank)} (${astRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${st ?? ""}</div>
          <div class="stat-rank ${getRankClass(stRank.rank, teamCount)}">
            ${stRank.rank
                ? `${formatOrdinal(stRank.rank)} (${stRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${blk ?? ""}</div>
          <div class="stat-rank ${getRankClass(blkRank.rank, teamCount)}">
            ${blkRank.rank
                ? `${formatOrdinal(blkRank.rank)} (${blkRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${turnovers ?? ""}</div>
          <div class="stat-rank ${getRankClass(toRank.rank, teamCount)}">
            ${toRank.rank
                ? `${formatOrdinal(toRank.rank)} (${toRank.bracket})`
                : ""
            }
          </div>
        </div>
      </td>

      <td class="total-cell">
        <span class="${getRankClass(ranking.totalRank, teamCount)}">
          ${ranking.totalRank
                ? `${formatOrdinal(ranking.totalRank)} (${ranking.totalScore ?? 0
                })`
                : ranking.totalScore ?? 0
            }
        </span>
      </td>
    </tr>`;
    });

    tbody += "</tbody>";
    teamViewTable.innerHTML = thead + tbody;
    drawTeamChart();
}

// Chart --------------------------------------------------------------------

function clearTeamChart() {
    if (!teamChartCtx) return;
    teamChartCtx.clearRect(0, 0, teamChartCanvas.width, teamChartCanvas.height);
    teamChartMetricLabel.textContent = "";
}

function describeMetric(metric) {
    if (metric === "total") return "Total roto score (weekly)";
    const def = statDefs.find((s) => s.field === metric);
    return def ? def.label + " (weekly)" : metric;
}

function drawTeamChart() {
    if (!teamChartCtx) return;

    const displayWidth = teamChartCanvas.clientWidth || 600;
    teamChartCanvas.width = displayWidth;

    const width = teamChartCanvas.width;
    const height = teamChartCanvas.height;

    teamChartCtx.clearRect(0, 0, width, height);

    if (!teamViewData || teamViewData.length === 0) {
        teamChartMetricLabel.textContent = "";
        return;
    }

    const ordered = [...teamViewData].sort(
        (a, b) => a.weekNumber - b.weekNumber
    );
    const labels = ordered.map((e) => e.label);

    const values = ordered.map((entry) => {
        if (teamChartMetric === "total") {
            return entry.ranking && typeof entry.ranking.totalScore === "number"
                ? entry.ranking.totalScore
                : null;
        } else {
            const v = entry.row[teamChartMetric];
            const num = Number(v);
            return Number.isNaN(num) ? null : num;
        }
    });

    const numericValues = values.filter(
        (v) => v !== null && !Number.isNaN(v)
    );
    if (!numericValues.length) {
        teamChartMetricLabel.textContent =
            describeMetric(teamChartMetric) + " — no numeric data";
        return;
    }

    let min = Math.min(...numericValues);
    let max = Math.max(...numericValues);

    if (min === max) {
        const pad = Math.abs(min || 1) * 0.1;
        min -= pad;
        max += pad;
    }

    const paddingLeft = 40;
    const paddingRight = 10;
    const paddingTop = 20;
    const paddingBottom = 24;

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    function xForIndex(i) {
        if (labels.length === 1) return paddingLeft + plotWidth / 2;
        return paddingLeft + (i / (labels.length - 1)) * plotWidth;
    }
    function yForValue(v) {
        const t = (v - min) / (max - min);
        return paddingTop + (1 - t) * plotHeight;
    }

    teamChartCtx.strokeStyle = "#4b5563";
    teamChartCtx.lineWidth = 1;

    // y-axis
    teamChartCtx.beginPath();
    teamChartCtx.moveTo(paddingLeft, paddingTop);
    teamChartCtx.lineTo(paddingLeft, paddingTop + plotHeight);
    teamChartCtx.stroke();

    // x-axis
    teamChartCtx.beginPath();
    teamChartCtx.moveTo(paddingLeft, paddingTop + plotHeight);
    teamChartCtx.lineTo(paddingLeft + plotWidth, paddingTop + plotHeight);
    teamChartCtx.stroke();

    // Y labels
    teamChartCtx.fillStyle = "#9ca3af";
    teamChartCtx.font = "11px system-ui";
    teamChartCtx.textAlign = "right";
    teamChartCtx.textBaseline = "middle";

    teamChartCtx.fillText(max.toFixed(2), paddingLeft - 4, yForValue(max));
    teamChartCtx.fillText(min.toFixed(2), paddingLeft - 4, yForValue(min));

    // X labels
    teamChartCtx.textAlign = "center";
    teamChartCtx.textBaseline = "top";
    labels.forEach((label, i) => {
        const x = xForIndex(i);
        const y = paddingTop + plotHeight + 4;
        teamChartCtx.fillText(label, x, y);
    });

    // Line
    teamChartCtx.strokeStyle = "#3b82f6";
    teamChartCtx.lineWidth = 2;
    teamChartCtx.beginPath();

    let started = false;
    values.forEach((v, i) => {
        if (v === null || Number.isNaN(v)) {
            started = false;
            return;
        }
        const x = xForIndex(i);
        const y = yForValue(v);
        if (!started) {
            teamChartCtx.moveTo(x, y);
            started = true;
        } else {
            teamChartCtx.lineTo(x, y);
        }
    });
    teamChartCtx.stroke();

    // Points
    teamChartCtx.fillStyle = "#3b82f6";
    values.forEach((v, i) => {
        if (v === null || Number.isNaN(v)) return;
        const x = xForIndex(i);
        const y = yForValue(v);
        teamChartCtx.beginPath();
        teamChartCtx.arc(x, y, 3, 0, Math.PI * 2);
        teamChartCtx.fill();
    });

    teamChartMetricLabel.textContent =
        "Metric: " + describeMetric(teamChartMetric);
}

// Edit stats ---------------------------------------------------------------

async function editTeamStats(rowIndex) {
    if (!ensureAdmin()) return;

    const rowData = rowsData[rowIndex];
    if (!rowData) return;

    const teamName = rowData.team_name || "this team";

    const currentValues = statDefs.map((stat) => {
        const v = rowData[stat.field];
        return v === null || v === undefined ? "" : String(v);
    });
    const defaultLine = currentValues.join(", ");

    const msg =
        `Enter stats for "${teamName}" as comma-separated values in this order:\n` +
        `FG%, FT%, 3PTM, PTS, REB, AST, ST, BLK, TO\n\n` +
        `Leave a value blank to keep the existing value.`;

    const input = prompt(msg, defaultLine);
    if (input === null) {
        setStatus("Edit cancelled", "");
        return;
    }

    const parts = input.split(",").map((s) => s.trim());
    const updated = {};
    let invalid = null;

    statDefs.forEach((stat, idx) => {
        const raw = parts[idx];
        const existing = rowData[stat.field];

        if (raw === undefined || raw === "") {
            updated[stat.field] =
                existing === undefined ? null : existing;
        } else {
            const num = Number(raw);
            if (Number.isNaN(num)) {
                invalid = { label: stat.label, raw };
            } else {
                updated[stat.field] = num;
            }
        }
    });

    if (invalid) {
        alert(
            `"${invalid.raw}" is not a valid number for ${invalid.label}. Edit cancelled.`
        );
        return;
    }

    for (const stat of statDefs) {
        rowData[stat.field] = updated[stat.field];
    }

    const payload = {
        teamId: rowData.team_id,
        weekId: currentWeekId,
        fg_pct: rowData.fg_pct ?? null,
        ft_pct: rowData.ft_pct ?? null,
        three_ptm: rowData.three_ptm ?? null,
        pts: rowData.pts ?? null,
        reb: rowData.reb ?? null,
        ast: rowData.ast ?? null,
        st: rowData.st ?? null,
        blk: rowData.blk ?? null,
        turnovers: rowData.turnovers ?? null,
    };

    try {
        await fetchJSON(`${API_BASE}/api/stats`, {
            method: "POST",
            body: JSON.stringify(payload),
        });
        computeRanking();
        renderWeekTable();
        const selectedTeamId = Number(teamViewSelect.value);
        if (selectedTeamId && selectedTeamId === rowData.team_id) {
            await loadTeamView();
        }
        setStatus("Stats updated", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error saving stats", "err");
    }
}

// Deleted lists ------------------------------------------------------------

function renderDeletedLists() {
    if (!deletedWeeks || deletedWeeks.length === 0) {
        deletedWeeksContainer.innerHTML = "<div>No deleted weeks.</div>";
    } else {
        let html =
            '<table><thead><tr><th>Week</th><th>Actions</th></tr></thead><tbody>';
        deletedWeeks.forEach((w) => {
            html += `<tr>
        <td>${weekLabelFromNumber(w.week_number)}</td>
        <td>
          <div class="trash-list-actions">
            <button type="button"
                    class="admin-only"
                    data-action="restore-week"
                    data-id="${w.id}">
              Restore
            </button>
            <button type="button"
                    class="danger admin-only"
                    data-action="force-delete-week"
                    data-id="${w.id}">
              Delete permanently
            </button>
          </div>
        </td>
      </tr>`;
        });
        html += "</tbody></table>";
        deletedWeeksContainer.innerHTML = html;
    }

    if (!deletedTeams || deletedTeams.length === 0) {
        deletedTeamsContainer.innerHTML = "<div>No deleted teams.</div>";
    } else {
        let html =
            '<table><thead><tr><th>Team</th><th>Actions</th></tr></thead><tbody>';
        deletedTeams.forEach((t) => {
            html += `<tr>
        <td>
          <div class="team-cell">
            <div class="team-name">${t.name}</div>
            <div class="team-owner">${t.owner_name ? t.owner_name : ""}</div>
          </div>
        </td>
        <td>
          <div class="trash-list-actions">
            <button type="button"
                    class="admin-only"
                    data-action="restore-team"
                    data-id="${t.id}">
              Restore
            </button>
            <button type="button"
                    class="danger admin-only"
                    data-action="force-delete-team"
                    data-id="${t.id}">
              Delete permanently
            </button>
          </div>
        </td>
      </tr>`;
        });
        html += "</tbody></table>";
        deletedTeamsContainer.innerHTML = html;
    }

    applyAdminVisibility();
}

// Events -------------------------------------------------------------------

addWeekBtn.addEventListener("click", addWeek);
editWeekBtn.addEventListener("click", editCurrentWeek);
deleteWeekBtn.addEventListener("click", deleteWeek);
addTeamBtn.addEventListener("click", addTeam);
editTeamNameBtn.addEventListener("click", editSelectedTeamName);

weekSelect.addEventListener("change", () => {
    currentWeekId = Number(weekSelect.value);
    loadStatsForCurrentWeek();
});

teamViewSelect.addEventListener("change", () => {
    updateTeamChartTitle();
    loadTeamView();
});

teamViewRefreshBtn.addEventListener("click", () => {
    loadTeamView();
});

// Admin toggle with username/password check
if (adminToggleBtn) {
    adminToggleBtn.addEventListener("click", () => {
        if (isAdmin) {
            if (
                confirm(
                    "Turn off admin mode on this browser? You will not see admin controls until you log in again."
                )
            ) {
                setAdminMode(false);
            }
        } else {
            const username = prompt("Admin username:", "");
            if (username === null) return;
            const password = prompt("Admin password:", "");
            if (password === null) return;

            if (username === "admin" && password === "adminpassword") {
                setAdminMode(true);
                alert("Admin mode enabled.");
            } else {
                alert("Incorrect admin username or password.");
            }
        }
    });
}

statsTable.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th) {
        const sortKey = th.dataset.sort;
        if (!sortKey) return;

        if (sortKey === "total") {
            if (
                weekSortState.type === "total" &&
                weekSortState.direction === "asc"
            ) {
                weekSortState = {
                    type: "total",
                    field: null,
                    direction: "desc",
                };
            } else {
                weekSortState = {
                    type: "total",
                    field: null,
                    direction: "asc",
                };
            }
        } else {
            if (
                weekSortState.type === "stat" &&
                weekSortState.field === sortKey
            ) {
                weekSortState = {
                    type: "stat",
                    field: sortKey,
                    direction:
                        weekSortState.direction === "desc" ? "asc" : "desc",
                };
            } else {
                weekSortState = {
                    type: "stat",
                    field: sortKey,
                    direction: "desc",
                };
            }
        }
        renderWeekTable();
        return;
    }

    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    if (!isAdmin) {
        alert("Admin mode is required to edit or delete stats.");
        return;
    }

    const action = btn.dataset.action;

    if (action === "delete-team") {
        const teamId = Number(btn.dataset.teamId);
        const rowEl = btn.closest("tr");
        const rowIndex = rowEl ? Number(rowEl.dataset.rowIndex) : -1;
        const teamName =
            rowIndex >= 0 && rowsData[rowIndex]
                ? rowsData[rowIndex].team_name
                : "this team";
        deleteTeam(teamId, teamName);
    } else if (action === "edit-team") {
        const rowIndex = Number(btn.dataset.rowIndex);
        editTeamStats(rowIndex);
    }
});

teamViewTable.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-chart]");
    if (!th) return;
    const metric = th.dataset.chart;
    if (!metric) return;
    teamChartMetric = metric;
    drawTeamChart();
});

deletedWeeksContainer.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (!id) return;

    if (action === "restore-week") {
        restoreWeek(id);
    } else if (action === "force-delete-week") {
        forceDeleteWeek(id);
    }
});

deletedTeamsContainer.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (!id) return;

    if (action === "restore-team") {
        restoreTeam(id);
    } else if (action === "force-delete-team") {
        forceDeleteTeam(id);
    }
});

// Init ---------------------------------------------------------------------

(async function init() {
    try {
        // Restore admin mode for this browser
        try {
            isAdmin = localStorage.getItem(ADMIN_STORAGE_KEY) === "1";
        } catch {
            isAdmin = false;
        }
        applyAdminVisibility();

        await Promise.all([
            loadWeeks(),
            loadTeams(),
            loadDeletedWeeks(),
            loadDeletedTeams(),
        ]);

        if (weeks.length > 0) {
            currentWeekId = weeks[0].id;
            weekSelect.value = String(currentWeekId);
            await loadStatsForCurrentWeek();
        }

        renderTeamViewSelect();
        await loadTeamViewIfTeamSelected();
    } catch (err) {
        console.error(err);
        setStatus("Error initialising app", "err");
    }
})();
