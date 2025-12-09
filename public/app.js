// Detect API base (same origin, worker handles /fantasy path)
const API_BASE = "";

// DOM references --------------------------------------------------------------

const weekSelect = document.getElementById("weekSelect");
const addWeekBtn = document.getElementById("addWeekBtn");
const editWeekBtn = document.getElementById("editWeekBtn");
const deleteWeekBtn = document.getElementById("deleteWeekBtn");

const addTeamBtn = document.getElementById("addTeamBtn");
const statsTable = document.getElementById("statsTable");
const statusEl = document.getElementById("status");

const deletedWeeksContainer = document.getElementById("deletedWeeksContainer");
const deletedTeamsContainer = document.getElementById("deletedTeamsContainer");

// Team view
const teamViewSelect = document.getElementById("teamViewSelect");
const teamViewTable = document.getElementById("teamViewTable");
const teamViewStatus = document.getElementById("teamViewStatus");
const teamViewRefreshBtn = document.getElementById("teamViewRefreshBtn");
const editTeamNameBtn = document.getElementById("editTeamNameBtn");
const teamChartTitleEl = document.getElementById("teamChartTitle");

// Chart
const teamChartCanvas = document.getElementById("teamChart");
const teamChartCtx = teamChartCanvas.getContext("2d");
const teamChartMetricLabel = document.getElementById("teamChartMetricLabel");
let teamChartMetric = "total";

// Admin
const adminToggleBtn = document.getElementById("adminToggleBtn");
const downloadDbBtn = document.getElementById("downloadDbBtn");
const ADMIN_STORAGE_KEY = "fantasyAdminMode";

// State ----------------------------------------------------------------------

let isAdmin = false;

let weeks = [];
let teams = [];
let deletedWeeks = [];
let deletedTeams = [];

let currentWeekId = null;
let rowsData = [];        // main table rows for current week
let rankingData = [];     // per-team ranking for current week
let rankingOrder = [];    // sorted team_ids for current week

let teamViewData = [];    // [{ weekId, weekNumber, label, row, ranking, leagueWeekStats }]
let weekSortState = {     // how main table is sorted
    type: "total",        // "total" | "stat"
    field: null,          // stat field when type === "stat"
    direction: "asc",     // "asc" | "desc"
};

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

function weekLabelFromNumber(n) {
    return `Week ${n}`;
}

// Helpers --------------------------------------------------------------------

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
        } catch { }
        throw new Error(txt || res.statusText);
    }

    try {
        return await res.json();
    } catch {
        return null;
    }
}

// Admin helpers --------------------------------------------------------------

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

function ensureAdmin() {
    if (!isAdmin) {
        alert("Admin mode is required for this action.");
        return false;
    }
    return true;
}

// Data loading ---------------------------------------------------------------

async function loadWeeks() {
    weeks = await fetchJSON(`${API_BASE}/api/weeks`);
    if (!Array.isArray(weeks)) weeks = [];

    // Sort by week_number ascending
    weeks.sort((a, b) => a.week_number - b.week_number);

    renderWeekSelect();
}

async function loadDeletedWeeks() {
    deletedWeeks = await fetchJSON(`${API_BASE}/api/weeks/deleted`);
    if (!Array.isArray(deletedWeeks)) deletedWeeks = [];
    deletedWeeks.sort((a, b) => a.week_number - b.week_number);
    renderDeletedLists();
}

async function loadTeams() {
    teams = await fetchJSON(`${API_BASE}/api/teams`);
    if (!Array.isArray(teams)) teams = [];
    teams.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    renderTeamViewSelect();
}

async function loadDeletedTeams() {
    deletedTeams = await fetchJSON(`${API_BASE}/api/teams/deleted`);
    if (!Array.isArray(deletedTeams)) deletedTeams = [];
    deletedTeams.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    renderDeletedLists();
}

async function loadStatsForCurrentWeek() {
    if (!currentWeekId) {
        rowsData = [];
        rankingData = [];
        rankingOrder = [];
        renderWeekTable();
        return;
    }

    try {
        rowsData = await fetchJSON(
            `${API_BASE}/api/stats?weekId=${encodeURIComponent(currentWeekId)}`
        );
        if (!Array.isArray(rowsData)) rowsData = [];
        computeRanking();
        renderWeekTable();
        setStatus("Loaded stats", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error loading stats", "err");
    }
}

// Ranking logic --------------------------------------------------------------

function computeRanking() {
    rankingData = [];
    rankingOrder = [];

    if (!rowsData || rowsData.length === 0) return;

    const teamIds = rowsData.map((r) => r.team_id);

    function rankForField(field, highBetter) {
        const vals = rowsData.map((r, idx) => ({
            team_id: r.team_id,
            index: idx,
            value:
                r[field] === null || r[field] === undefined
                    ? null
                    : Number(r[field]),
        }));

        const valid = vals.filter((v) => v.value !== null && !Number.isNaN(v.value));
        if (valid.length === 0) {
            return new Map();
        }

        valid.sort((a, b) =>
            highBetter ? b.value - a.value : a.value - b.value
        );

        const map = new Map();
        let rank = 1;
        for (const v of valid) {
            map.set(v.team_id, rank);
            rank++;
        }
        return map;
    }

    const rankMaps = {};
    for (const stat of statDefs) {
        rankMaps[stat.field] = rankForField(stat.field, stat.highBetter);
    }

    const n = teamIds.length;
    const teamTotals = new Map();

    for (const teamId of teamIds) {
        let sumOpp = 0;
        for (const stat of statDefs) {
            const m = rankMaps[stat.field];
            const r = m.get(teamId);
            if (!r) continue;
            const opp = n + 1 - r;
            sumOpp += opp;
        }
        teamTotals.set(teamId, sumOpp);
    }

    const totalRankMap = new Map();
    const totalArray = Array.from(teamTotals.entries());
    totalArray.sort((a, b) => b[1] - a[1]); // higher opp sum = better

    let totalRank = 1;
    for (const [teamId] of totalArray) {
        totalRankMap.set(teamId, totalRank);
        totalRank++;
    }

    const teamCount = teamIds.length;

    rankingData = teamIds.map((teamId) => {
        const perStat = {};
        let totalOppSum = 0;

        for (const stat of statDefs) {
            const map = rankMaps[stat.field];
            const r = map.get(teamId) || null;
            const opp = r ? teamCount + 1 - r : null;
            if (opp !== null) totalOppSum += opp;
            perStat[stat.field] = { rank: r, opp: opp };
        }

        const totalRank = totalRankMap.get(teamId) || null;

        return {
            team_id: teamId,
            perStat,
            total: {
                rank: totalRank,
                opp: totalOppSum,
            },
        };
    });

    rankingOrder = teamIds.slice().sort((a, b) => {
        const ra = rankingData.find((r) => r.team_id === a);
        const rb = rankingData.find((r) => r.team_id === b);
        const va = ra?.total?.opp ?? -Infinity;
        const vb = rb?.total?.opp ?? -Infinity;
        return vb - va; // higher opp sum first
    });
}

// Rendering: main week table -------------------------------------------------

function renderWeekSelect() {
    weekSelect.innerHTML = "";
    if (!weeks.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "(no weeks)";
        weekSelect.appendChild(opt);
        currentWeekId = null;
        return;
    }

    for (const w of weeks) {
        const opt = document.createElement("option");
        opt.value = String(w.id);
        opt.textContent = weekLabelFromNumber(w.week_number);
        weekSelect.appendChild(opt);
    }

    // Default: most recent week (highest week_number)
    if (!currentWeekId) {
        currentWeekId = weeks[weeks.length - 1].id;
    }
    weekSelect.value = String(currentWeekId);
}

function formatRank(rank, opp) {
    if (!rank || !opp) return "";
    const suffix =
        rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
    return `${rank}${suffix} (${opp})`;
}

function renderWeekTable() {
    const tbody = statsTable.querySelector("tbody");
    tbody.innerHTML = "";

    if (!rowsData || rowsData.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 12;
        td.textContent = "No teams or stats for this week.";
        td.style.textAlign = "center";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    const rankingByTeam = new Map();
    rankingData.forEach((r) => {
        rankingByTeam.set(r.team_id, r);
    });

    const teamCount = rowsData.length;

    let sortedRows = rowsData.slice();

    if (weekSortState.type === "total") {
        if (weekSortState.direction === "asc") {
            sortedRows.sort((a, b) => {
                const ra = rankingByTeam.get(a.team_id);
                const rb = rankingByTeam.get(b.team_id);
                const va = ra?.total?.opp ?? -Infinity;
                const vb = rb?.total?.opp ?? -Infinity;
                return vb - va;
            });
        } else {
            sortedRows.sort((a, b) => {
                const ra = rankingByTeam.get(a.team_id);
                const rb = rankingByTeam.get(b.team_id);
                const va = ra?.total?.opp ?? -Infinity;
                const vb = rb?.total?.opp ?? -Infinity;
                return va - vb;
            });
        }
    } else if (weekSortState.type === "stat" && weekSortState.field) {
        const field = weekSortState.field;
        const def = statDefs.find((s) => s.field === field);
        const highBetter = def?.highBetter ?? true;
        sortedRows.sort((a, b) => {
            const va = a[field] == null ? null : Number(a[field]);
            const vb = b[field] == null ? null : Number(b[field]);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            return weekSortState.direction === "desc"
                ? vb - va
                : va - vb;
        });
        if (!highBetter) {
            sortedRows.reverse();
        }
    }

    // Precompute per-stat best/worst ranks (for coloring first/last)
    const bestRankByStat = {};
    const worstRankByStat = {};
    for (const stat of statDefs) {
        let best = Infinity;
        let worst = -Infinity;
        for (const r of rankingData) {
            const sr = r.perStat[stat.field]?.rank;
            if (!sr) continue;
            if (sr < best) best = sr;
            if (sr > worst) worst = sr;
        }
        bestRankByStat[stat.field] =
            best === Infinity ? null : best;
        worstRankByStat[stat.field] =
            worst === -Infinity ? null : worst;
    }

    // For total
    let bestTotalRank = Infinity;
    let worstTotalRank = -Infinity;
    for (const r of rankingData) {
        const trank = r.total?.rank;
        if (!trank) continue;
        if (trank < bestTotalRank) bestTotalRank = trank;
        if (trank > worstTotalRank) worstTotalRank = trank;
    }
    if (bestTotalRank === Infinity) bestTotalRank = null;
    if (worstTotalRank === -Infinity) worstTotalRank = null;

    for (let i = 0; i < sortedRows.length; i++) {
        const row = sortedRows[i];
        const r = rankingByTeam.get(row.team_id);

        const tr = document.createElement("tr");
        tr.dataset.rowIndex = String(rowsData.indexOf(row));

        // Team
        const tdTeam = document.createElement("td");
        tdTeam.innerHTML = `
      <div class="team-cell">
        <div class="team-name">${row.team_name}</div>
        <div class="team-owner">${row.owner_name ? row.owner_name : ""
            }</div>
      </div>
    `;
        tr.appendChild(tdTeam);

        // Stats
        for (const stat of statDefs) {
            const td = document.createElement("td");
            td.className = "stat-cell";

            const valRaw = row[stat.field];
            const val =
                valRaw === null || valRaw === undefined
                    ? ""
                    : Number(valRaw).toFixed(
                        stat.field.endsWith("_pct") ? 3 : 1
                    );

            const statRank = r?.perStat[stat.field]?.rank ?? null;
            const opp = r?.perStat[stat.field]?.opp ?? null;
            const rankStr =
                statRank && opp ? formatRank(statRank, opp) : "";

            const rankClasses = [];
            if (teamCount >= 2) {
                const bestRank = bestRankByStat[stat.field];
                const worstRank = worstRankByStat[stat.field];
                if (bestRank && statRank === bestRank) {
                    rankClasses.push("rank-first");
                } else if (worstRank && statRank === worstRank) {
                    rankClasses.push("rank-last");
                }
            }

            td.innerHTML = `
        <div class="stat-value">${val}</div>
        <div class="stat-rank ${rankClasses.join(" ") || ""
                }">${rankStr}</div>
      `;
            tr.appendChild(td);
        }

        // Total
        const tdTotal = document.createElement("td");
        tdTotal.className = "stat-cell";

        let totalRank = r?.total?.rank ?? null;
        const totalOpp = r?.total?.opp ?? null;
        const totalStr =
            totalRank && totalOpp ? formatRank(totalRank, totalOpp) : "";

        let totalClasses = [];
        if (teamCount >= 2) {
            if (bestTotalRank && totalRank === bestTotalRank) {
                totalClasses.push("rank-first");
            } else if (worstTotalRank && totalRank === worstTotalRank) {
                totalClasses.push("rank-last");
            }
        }

        tdTotal.innerHTML = `
      <div class="stat-value">${totalOpp ?? ""}</div>
      <div class="stat-rank ${totalClasses.join(" ")}">${totalStr}</div>
    `;
        tr.appendChild(tdTotal);

        // Actions
        const tdActions = document.createElement("td");
        tdActions.innerHTML = `
      <button type="button"
              class="admin-only"
              data-action="edit-team"
              data-row-index="${rowsData.indexOf(row)}">
        Edit stats
      </button>
      <button type="button"
              class="danger admin-only"
              data-action="delete-team"
              data-team-id="${row.team_id}">
        Delete team
      </button>
    `;
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    }

    applyAdminVisibility();
}

// Weeks CRUD -----------------------------------------------------------------

async function addWeek() {
    if (!ensureAdmin()) return;

    const input = prompt("Enter new week number (1, 2, 3, ...):", "");
    if (input === null) return;

    const n = Number(input);
    if (!Number.isInteger(n) || n <= 0) {
        alert("Week number must be a positive integer.");
        return;
    }
    if (weeks.some((w) => w.week_number === n)) {
        alert("That week number already exists.");
        return;
    }

    try {
        const w = await fetchJSON(`${API_BASE}/api/weeks`, {
            method: "POST",
            body: JSON.stringify({ week_number: n }),
        });
        weeks.push(w);
        weeks.sort((a, b) => a.week_number - b.week_number);

        currentWeekId = w.id;
        renderWeekSelect();
        await loadStatsForCurrentWeek();
        await loadDeletedWeeks();
        await loadTeamViewIfTeamSelected();
        setStatus("Week added", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error adding week", "err");
    }
}

async function editCurrentWeek() {
    if (!ensureAdmin()) return;
    if (!currentWeekId) {
        alert("No week selected.");
        return;
    }

    const current = weeks.find((w) => w.id === currentWeekId);
    if (!current) return;

    const input = prompt(
        "Edit week number:",
        String(current.week_number)
    );
    if (input === null) return;

    const n = Number(input);
    if (!Number.isInteger(n) || n <= 0) {
        alert("Week number must be a positive integer.");
        return;
    }
    if (
        weeks.some(
            (w) => w.week_number === n && w.id !== currentWeekId
        )
    ) {
        alert("Another week already has that number.");
        return;
    }

    try {
        const updated = await fetchJSON(
            `${API_BASE}/api/weeks/${currentWeekId}`,
            {
                method: "PATCH",
                body: JSON.stringify({ week_number: n }),
            }
        );
        const idx = weeks.findIndex((w) => w.id === currentWeekId);
        if (idx !== -1) weeks[idx] = updated;
        weeks.sort((a, b) => a.week_number - b.week_number);

        renderWeekSelect();
        await loadStatsForCurrentWeek();
        await loadTeamViewIfTeamSelected();
        setStatus("Week updated", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error updating week", "err");
    }
}

async function deleteWeek() {
    if (!ensureAdmin()) return;
    if (!currentWeekId) {
        alert("No week selected.");
        return;
    }
    if (weeks.length <= 1) {
        alert("At least one week must remain.");
        return;
    }

    const current = weeks.find((w) => w.id === currentWeekId);
    const label = current
        ? weekLabelFromNumber(current.week_number)
        : "this week";

    const confirmed = confirm(
        `Move ${label} to trash? All stats remain in the database and can be restored later.`
    );
    if (!confirmed) return;

    try {
        await fetchJSON(`${API_BASE}/api/weeks/${currentWeekId}`, {
            method: "DELETE",
        });

        weeks = weeks.filter((w) => w.id !== currentWeekId);

        if (weeks.length > 0) {
            // Move to most recent week
            currentWeekId = weeks[weeks.length - 1].id;
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
            currentWeekId = weeks[weeks.length - 1].id;
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

    if (
        !confirm(
            "Permanently delete this week and all its stats? This cannot be undone."
        )
    ) {
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

// Team CRUD ------------------------------------------------------------------

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
            body: JSON.stringify({
                name: namePart,
                owner: ownerPart || null,
            }),
        });
        teams.push(team);
        teams.sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase())
        );
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
        const restored = await fetchJSON(
            `${API_BASE}/api/teams/${id}/restore`,
            { method: "POST" }
        );
        await loadTeams();
        await loadDeletedTeams();

        if (restored && restored.id) {
            teamViewSelect.value = String(restored.id);
            updateTeamChartTitle();
            await loadTeamViewIfTeamSelected();
        }

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
            "Permanently delete this team and all of its stats? This cannot be undone."
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

// Stats editing --------------------------------------------------------------

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

// Deleted lists rendering ----------------------------------------------------

function renderDeletedLists() {
    // Weeks
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

    // Teams
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
              <div class="team-owner">${t.owner_name ? t.owner_name : ""
                }</div>
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

// Team view & chart ----------------------------------------------------------

function renderTeamViewSelect() {
    teamViewSelect.innerHTML = "";

    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(select team)";
    teamViewSelect.appendChild(opt);

    teams.forEach((t) => {
        const o = document.createElement("option");
        o.value = String(t.id);
        o.textContent = t.owner_name
            ? `${t.name} (${t.owner_name})`
            : t.name;
        teamViewSelect.appendChild(o);
    });
}

function updateTeamChartTitle() {
    const teamId = Number(teamViewSelect.value);
    const team = teams.find((t) => t.id === teamId);
    if (team) {
        teamChartTitleEl.textContent = `Trend by week – ${team.name
            }`;
    } else {
        teamChartTitleEl.textContent = "Trend by week";
    }
}

async function loadTeamView() {
    const teamId = Number(teamViewSelect.value);
    if (!teamId) {
        teamViewData = [];
        teamViewTable.querySelector("tbody").innerHTML = "";
        clearTeamChart();
        return;
    }

    if (!weeks.length) {
        teamViewData = [];
        teamViewTable.querySelector("tbody").innerHTML = "";
        clearTeamChart();
        return;
    }

    const teamRows = [];
    const weekRankings = [];
    const leagueWeekStats = [];

    for (const w of weeks) {
        let weekRows;
        try {
            weekRows = await fetchJSON(
                `${API_BASE}/api/stats?weekId=${encodeURIComponent(w.id)}`
            );
        } catch (err) {
            console.error("Error loading week stats for team view", err);
            weekRows = [];
        }
        if (!Array.isArray(weekRows)) weekRows = [];

        const teamRow = weekRows.find((r) => r.team_id === teamId) || null;
        teamRows.push({ weekId: w.id, weekNumber: w.week_number, row: teamRow });

        // Compute rankings for that week (like main table)
        let rankingForWeek = null;
        if (weekRows.length > 0) {
            const tmpRowsData = weekRows;
            const tmpTeamIds = tmpRowsData.map((r) => r.team_id);

            function weekRankForField(field, highBetter) {
                const vals = tmpRowsData.map((r) => ({
                    team_id: r.team_id,
                    value:
                        r[field] === null || r[field] === undefined
                            ? null
                            : Number(r[field]),
                }));
                const valid = vals.filter(
                    (v) => v.value !== null && !Number.isNaN(v.value)
                );
                if (!valid.length) return new Map();
                valid.sort((a, b) =>
                    highBetter ? b.value - a.value : a.value - b.value
                );
                const m = new Map();
                let rank = 1;
                for (const v of valid) {
                    m.set(v.team_id, rank++);
                }
                return m;
            }

            const weekRankMaps = {};
            for (const stat of statDefs) {
                weekRankMaps[stat.field] = weekRankForField(
                    stat.field,
                    stat.highBetter
                );
            }

            const nTeams = tmpTeamIds.length;
            const weekTotalOpp = new Map();
            for (const tid of tmpTeamIds) {
                let sumOpp = 0;
                for (const stat of statDefs) {
                    const m = weekRankMaps[stat.field];
                    const r = m.get(tid);
                    if (!r) continue;
                    const opp = nTeams + 1 - r;
                    sumOpp += opp;
                }
                weekTotalOpp.set(tid, sumOpp);
            }

            const totalRankMap = new Map();
            const totalArr = Array.from(weekTotalOpp.entries());
            totalArr.sort((a, b) => b[1] - a[1]);
            let rnk = 1;
            for (const [tid] of totalArr) {
                totalRankMap.set(tid, rnk++);
            }

            const perTeam = new Map();
            for (const tid of tmpTeamIds) {
                const perStat = {};
                for (const stat of statDefs) {
                    const m = weekRankMaps[stat.field];
                    const r = m.get(tid) || null;
                    const opp =
                        r && nTeams >= 1 ? nTeams + 1 - r : null;
                    perStat[stat.field] = { rank: r, opp };
                }
                const totalRank = totalRankMap.get(tid) || null;
                const totalOpp = weekTotalOpp.get(tid) || null;
                perTeam.set(tid, {
                    perStat,
                    total: { rank: totalRank, opp: totalOpp },
                });
            }

            rankingForWeek = { perTeam, teamCount: nTeams };

            // League stats for this week (for chart lines)
            const leagueMetrics = {};
            for (const stat of statDefs) {
                const vals = tmpRowsData
                    .map((r) =>
                        r[stat.field] === null || r[stat.field] === undefined
                            ? null
                            : Number(r[stat.field])
                    )
                    .filter((v) => v !== null && !Number.isNaN(v));
                if (!vals.length) {
                    leagueMetrics[stat.field] = {
                        min: null,
                        max: null,
                        avg: null,
                    };
                } else {
                    const min = Math.min(...vals);
                    const max = Math.max(...vals);
                    const avg =
                        vals.reduce((s, x) => s + x, 0) / vals.length;
                    leagueMetrics[stat.field] = { min, max, avg };
                }
            }
            // Also "total" metric for league where we use totalOpp
            const totalOppVals = Array.from(weekTotalOpp.values()).filter(
                (v) => v !== null && !Number.isNaN(v)
            );
            if (totalOppVals.length) {
                const min = Math.min(...totalOppVals);
                const max = Math.max(...totalOppVals);
                const avg =
                    totalOppVals.reduce((s, x) => s + x, 0) /
                    totalOppVals.length;
                leagueMetrics["total"] = { min, max, avg };
            } else {
                leagueMetrics["total"] = { min: null, max: null, avg: null };
            }

            leagueWeekStats.push({
                weekId: w.id,
                weekNumber: w.week_number,
                metrics: leagueMetrics,
            });
        } else {
            weekRankings.push(null);
            leagueWeekStats.push({
                weekId: w.id,
                weekNumber: w.week_number,
                metrics: {},
            });
        }

        weekRankings.push(rankingForWeek);
    }

    // Combine into teamViewData
    teamViewData = [];
    for (let i = 0; i < weeks.length; i++) {
        const w = weeks[i];
        const teamRow = teamRows[i].row;
        const rankingForWeek = weekRankings[i];
        const leagueStatsForWeek = leagueWeekStats[i]?.metrics || {};

        let rankingEntry = null;
        if (rankingForWeek && rankingForWeek.perTeam) {
            rankingEntry =
                rankingForWeek.perTeam.get(teamId) || null;
        }

        teamViewData.push({
            weekId: w.id,
            weekNumber: w.week_number,
            label: weekLabelFromNumber(w.week_number),
            row: teamRow,
            ranking: rankingEntry,
            leagueWeekStats: leagueStatsForWeek,
        });
    }

    renderTeamViewTable();
    drawTeamChart();
}

async function loadTeamViewIfTeamSelected() {
    const teamId = Number(teamViewSelect.value);
    if (teamId) {
        updateTeamChartTitle();
        await loadTeamView();
    } else {
        teamViewData = [];
        teamViewTable.querySelector("tbody").innerHTML = "";
        clearTeamChart();
    }
}

function renderTeamViewTable() {
    const tbody = teamViewTable.querySelector("tbody");
    tbody.innerHTML = "";

    if (!teamViewData || !teamViewData.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 11;
        td.textContent =
            "Select a team to see its weekly stats.";
        td.style.textAlign = "center";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    const teamCountByWeek = {};
    teamViewData.forEach((d, idx) => {
        const leagueMetrics = d.leagueWeekStats || {};
        const anyMetric = Object.values(leagueMetrics)[0];
        // We don't actually need count here for coloring since it's a single team
        teamCountByWeek[idx] = null;
    });

    for (const entry of teamViewData) {
        const tr = document.createElement("tr");

        const tdWeek = document.createElement("td");
        tdWeek.textContent = entry.label;
        tr.appendChild(tdWeek);

        const r = entry.ranking;
        const row = entry.row;

        for (const stat of statDefs) {
            const td = document.createElement("td");
            td.className = "stat-cell";

            const valRaw = row ? row[stat.field] : null;
            const val =
                valRaw === null || valRaw === undefined
                    ? ""
                    : Number(valRaw).toFixed(
                        stat.field.endsWith("_pct") ? 3 : 1
                    );

            const rank = r?.perStat?.[stat.field]?.rank ?? null;
            const opp = r?.perStat?.[stat.field]?.opp ?? null;
            const rankStr = rank && opp ? formatRank(rank, opp) : "";

            td.innerHTML = `
        <div class="stat-value">${val}</div>
        <div class="stat-rank">${rankStr}</div>
      `;
            tr.appendChild(td);
        }

        const tdTotal = document.createElement("td");
        tdTotal.className = "stat-cell";
        const totalRank = r?.total?.rank ?? null;
        const totalOpp = r?.total?.opp ?? null;
        const totalStr =
            totalRank && totalOpp ? formatRank(totalRank, totalOpp) : "";
        tdTotal.innerHTML = `
      <div class="stat-value">${totalOpp ?? ""}</div>
      <div class="stat-rank">${totalStr}</div>
    `;
        tr.appendChild(tdTotal);

        tbody.appendChild(tr);
    }
}

// Chart drawing --------------------------------------------------------------

function clearTeamChart() {
    teamChartCtx.clearRect(
        0,
        0,
        teamChartCanvas.width,
        teamChartCanvas.height
    );
    teamChartMetricLabel.textContent = "Metric: (none)";
}

function describeMetric(metric) {
    if (metric === "total") return "Total (sum of opp points)";
    const def = statDefs.find((s) => s.field === metric);
    return def ? def.label : metric;
}

function drawTeamChart() {
    const teamId = Number(teamViewSelect.value);
    if (!teamId || !teamViewData.length) {
        clearTeamChart();
        return;
    }

    const metric = teamChartMetric || "total";

    const labels = teamViewData.map((d) => d.label);

    const teamValues = teamViewData.map((d) => {
        if (metric === "total") {
            const r = d.ranking;
            return r?.total?.opp ?? null;
        }
        const row = d.row;
        if (!row) return null;
        const v = row[metric];
        return v === null || v === undefined ? null : Number(v);
    });

    const leagueWeekAvgValues = teamViewData.map((d) => {
        const ls = d.leagueWeekStats || {};
        const m = ls[metric];
        if (!m || m.avg == null || Number.isNaN(m.avg)) return null;
        return Number(m.avg);
    });

    const numericTeam = teamValues.filter(
        (v) => v !== null && !Number.isNaN(v)
    );
    const numericLeagueAvg = leagueWeekAvgValues.filter(
        (v) => v !== null && !Number.isNaN(v)
    );

    if (!numericTeam.length && !numericLeagueAvg.length) {
        clearTeamChart();
        return;
    }

    const teamMax =
        numericTeam.length > 0 ? Math.max(...numericTeam) : null;
    const teamMin =
        numericTeam.length > 0 ? Math.min(...numericTeam) : null;
    const teamAvg =
        numericTeam.length > 0
            ? numericTeam.reduce((s, x) => s + x, 0) /
            numericTeam.length
            : null;

    // League global extremes & avg for this metric
    const leagueExtremes = [];
    const leagueAvgsAll = [];

    for (const d of teamViewData) {
        const ls = d.leagueWeekStats || {};
        const m = ls[metric];
        if (!m) continue;
        if (m.min != null && !Number.isNaN(m.min)) {
            leagueExtremes.push(m.min);
        }
        if (m.max != null && !Number.isNaN(m.max)) {
            leagueExtremes.push(m.max);
        }
        if (m.avg != null && !Number.isNaN(m.avg)) {
            leagueAvgsAll.push(m.avg);
        }
    }

    const leagueMin =
        leagueExtremes.length > 0
            ? Math.min(...leagueExtremes)
            : null;
    const leagueMax =
        leagueExtremes.length > 0
            ? Math.max(...leagueExtremes)
            : null;
    const leagueAvg =
        leagueAvgsAll.length > 0
            ? leagueAvgsAll.reduce((s, x) => s + x, 0) /
            leagueAvgsAll.length
            : null;

    const scaleValues = [];
    for (const v of teamValues) {
        if (v !== null && !Number.isNaN(v)) scaleValues.push(v);
    }
    for (const v of leagueWeekAvgValues) {
        if (v !== null && !Number.isNaN(v)) scaleValues.push(v);
    }
    [teamMax, teamMin, teamAvg, leagueMax, leagueMin, leagueAvg].forEach(
        (v) => {
            if (v !== null && !Number.isNaN(v)) scaleValues.push(v);
        }
    );

    if (!scaleValues.length) {
        clearTeamChart();
        return;
    }

    let min = Math.min(...scaleValues);
    let max = Math.max(...scaleValues);
    if (min === max) {
        const d = Math.abs(min) || 1;
        min -= d * 0.5;
        max += d * 0.5;
    }

    const paddingLeft = 40;
    const paddingRight = 20;
    const paddingTop = 20;
    const paddingBottom = 30;
    const width = teamChartCanvas.width;
    const height = teamChartCanvas.height;

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const xForIndex = (idx) => {
        if (labels.length === 1) {
            return paddingLeft + plotWidth / 2;
        }
        const t = idx / (labels.length - 1);
        return paddingLeft + t * plotWidth;
    };

    const yForValue = (v) => {
        const t = (v - min) / (max - min);
        const inverted = 1 - t;
        return paddingTop + inverted * plotHeight;
    };

    teamChartCtx.clearRect(0, 0, width, height);

    // Background
    teamChartCtx.fillStyle = "#020617";
    teamChartCtx.fillRect(0, 0, width, height);

    // Axes
    teamChartCtx.strokeStyle = "#4b5563";
    teamChartCtx.lineWidth = 1;

    teamChartCtx.beginPath();
    teamChartCtx.moveTo(paddingLeft, paddingTop);
    teamChartCtx.lineTo(paddingLeft, paddingTop + plotHeight);
    teamChartCtx.stroke();

    teamChartCtx.beginPath();
    teamChartCtx.moveTo(paddingLeft, paddingTop + plotHeight);
    teamChartCtx.lineTo(paddingLeft + plotWidth, paddingTop + plotHeight);
    teamChartCtx.stroke();

    // Y labels (min / max)
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

    // Helper to draw faint horizontal lines (no labels to avoid clutter)
    function drawHLine(value, color, dash = [4, 4]) {
        if (value === null || Number.isNaN(value)) return;
        const y = yForValue(value);
        teamChartCtx.save();
        teamChartCtx.strokeStyle = color;
        teamChartCtx.lineWidth = 1;
        teamChartCtx.setLineDash(dash);
        teamChartCtx.beginPath();
        teamChartCtx.moveTo(paddingLeft, y);
        teamChartCtx.lineTo(paddingLeft + plotWidth, y);
        teamChartCtx.stroke();
        teamChartCtx.restore();
    }

    // Team extremes (blue-ish)
    drawHLine(teamMax, "rgba(59,130,246,0.5)");
    drawHLine(teamMin, "rgba(59,130,246,0.35)");
    drawHLine(teamAvg, "rgba(59,130,246,0.25)", [2, 4]);

    // League extremes (red/green-ish)
    drawHLine(leagueMax, "rgba(248,113,113,0.5)");
    drawHLine(leagueMin, "rgba(248,113,113,0.35)");
    drawHLine(leagueAvg, "rgba(34,197,94,0.35)", [2, 4]);

    // League average line across weeks
    teamChartCtx.save();
    teamChartCtx.strokeStyle = "#22c55e";
    teamChartCtx.lineWidth = 1.5;
    teamChartCtx.setLineDash([6, 4]);

    let firstLeaguePoint = true;
    for (let i = 0; i < leagueWeekAvgValues.length; i++) {
        const v = leagueWeekAvgValues[i];
        if (v === null || Number.isNaN(v)) continue;
        const x = xForIndex(i);
        const y = yForValue(v);
        if (firstLeaguePoint) {
            teamChartCtx.beginPath();
            teamChartCtx.moveTo(x, y);
            firstLeaguePoint = false;
        } else {
            teamChartCtx.lineTo(x, y);
        }
    }
    if (!firstLeaguePoint) {
        teamChartCtx.stroke();
    }
    teamChartCtx.setLineDash([]);
    teamChartCtx.restore();

    // Team line
    teamChartCtx.save();
    teamChartCtx.strokeStyle = "#3b82f6";
    teamChartCtx.lineWidth = 2;
    let first = true;
    for (let i = 0; i < teamValues.length; i++) {
        const v = teamValues[i];
        if (v === null || Number.isNaN(v)) continue;
        const x = xForIndex(i);
        const y = yForValue(v);
        if (first) {
            teamChartCtx.beginPath();
            teamChartCtx.moveTo(x, y);
            first = false;
        } else {
            teamChartCtx.lineTo(x, y);
        }
    }
    if (!first) {
        teamChartCtx.stroke();
    }

    // Team points + value labels
    teamChartCtx.fillStyle = "#e5e7eb";
    teamChartCtx.font = "10px system-ui";
    teamChartCtx.textAlign = "center";
    teamChartCtx.textBaseline = "bottom";

    for (let i = 0; i < teamValues.length; i++) {
        const v = teamValues[i];
        if (v === null || Number.isNaN(v)) continue;
        const x = xForIndex(i);
        const y = yForValue(v);
        teamChartCtx.beginPath();
        teamChartCtx.arc(x, y, 3, 0, Math.PI * 2);
        teamChartCtx.fill();
        teamChartCtx.fillText(v.toFixed(2), x, y - 4);
    }

    teamChartCtx.restore();

    teamChartMetricLabel.textContent =
        "Metric: " + describeMetric(metric);
}

// Sorting handlers -----------------------------------------------------------

function handleWeekHeaderClick(e) {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const sortKey = th.dataset.sort;
    if (!sortKey) return;

    if (sortKey === "total") {
        if (weekSortState.type === "total") {
            weekSortState = {
                type: "total",
                field: null,
                direction:
                    weekSortState.direction === "asc" ? "desc" : "asc",
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
}

// Events ---------------------------------------------------------------------

addWeekBtn.addEventListener("click", addWeek);
editWeekBtn.addEventListener("click", editCurrentWeek);
deleteWeekBtn.addEventListener("click", deleteWeek);
addTeamBtn.addEventListener("click", addTeam);
editTeamNameBtn.addEventListener("click", editSelectedTeamName);

weekSelect.addEventListener("change", () => {
    currentWeekId = Number(weekSelect.value) || null;
    loadStatsForCurrentWeek();
});

teamViewSelect.addEventListener("change", () => {
    updateTeamChartTitle();
    loadTeamViewIfTeamSelected();
});

teamViewRefreshBtn.addEventListener("click", () => {
    loadTeamViewIfTeamSelected();
});

statsTable.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th) {
        handleWeekHeaderClick(e);
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

// Admin toggle
adminToggleBtn.addEventListener("click", () => {
    if (isAdmin) {
        // log out
        isAdmin = false;
        try {
            localStorage.setItem(ADMIN_STORAGE_KEY, "0");
        } catch { }
        applyAdminVisibility();
        setStatus("Admin mode disabled for this browser.", "");
        return;
    }

    const username = prompt("Enter admin username:", "");
    if (username === null) return;
    const password = prompt("Enter admin password:", "");
    if (password === null) return;

    if (username === "admin" && password === "adminpassword") {
        isAdmin = true;
        try {
            localStorage.setItem(ADMIN_STORAGE_KEY, "1");
        } catch { }
        applyAdminVisibility();
        setStatus("Admin mode enabled for this browser.", "ok");
    } else {
        alert("Invalid admin credentials.");
    }
});

// Download DB
if (downloadDbBtn) {
    downloadDbBtn.addEventListener("click", async () => {
        if (!ensureAdmin()) return;
        try {
            const res = await fetch(`${API_BASE}/api/export-db`);
            if (!res.ok) {
                throw new Error("Failed to download DB");
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "fantasy.db";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            setStatus("Error downloading database", "err");
        }
    });
}

// Init -----------------------------------------------------------------------

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
            // default to most recent week
            currentWeekId = weeks[weeks.length - 1].id;
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
