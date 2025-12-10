const API_BASE = ""; // same origin

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
let teamChart = null;           // Chart.js instance
let teamSummary = null;         // per-team max/min/avg summary from backend
let leagueSummary = null;       // league-wide max/min/avg summary from backend

if (window.Chart && window.ChartDataLabels) {
    Chart.register(window.ChartDataLabels);
}

let weeks = [];
let teams = [];
let deletedWeeks = [];
let deletedTeams = [];
let currentWeekId = null;
let rowsData = [];
let rankingData = [];
let rankingOrder = [];
let teamViewData = [];

let weekSortState = { type: 'total', field: null, direction: 'asc' };

// admin
const adminToggleBtn = document.getElementById("adminToggleBtn");
const adminStatusLabel = document.getElementById("adminStatusLabel");
const ADMIN_KEY = "fantasyAdminMode";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "adminpassword";
let isAdmin = false;

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

function setStatus(message, type = "") {
    statusEl.textContent = message || "";
    statusEl.classList.remove("ok", "err");
    if (type) statusEl.classList.add(type);
}

function setTeamViewStatus(message, type = "") {
    teamViewStatus.textContent = message || "";
    teamViewStatus.classList.remove("ok", "err");
    if (type) teamViewStatus.classList.add(type);
}

async function fetchJSON(url, options = {}) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.json();
}

/* ---------------------- ADMIN MODE ---------------------- */

function applyAdminMode() {
    const adminElements = document.querySelectorAll(".admin-only");
    adminElements.forEach((el) => {
        if (isAdmin) {
            el.classList.remove("admin-only-hidden");
        } else {
            el.classList.add("admin-only-hidden");
        }
    });

    adminToggleBtn.textContent = isAdmin ? "Admin log out" : "Admin log in";
    adminStatusLabel.textContent = isAdmin ? "Admin mode enabled" : "Admin mode disabled";
}

function loadAdminState() {
    try {
        const stored = localStorage.getItem(ADMIN_KEY);
        isAdmin = stored === "1";
    } catch {
        isAdmin = false;
    }
    applyAdminMode();
}

function saveAdminState() {
    try {
        if (isAdmin) {
            localStorage.setItem(ADMIN_KEY, "1");
        } else {
            localStorage.removeItem(ADMIN_KEY);
        }
    } catch {
        // ignore
    }
}

adminToggleBtn.addEventListener("click", () => {
    if (!isAdmin) {
        const username = prompt("Admin username:");
        if (username !== ADMIN_USERNAME) {
            alert("Invalid credentials.");
            return;
        }
        const password = prompt("Admin password:");
        if (password !== ADMIN_PASSWORD) {
            alert("Invalid credentials.");
            return;
        }
        isAdmin = true;
        saveAdminState();
        applyAdminMode();
    } else {
        isAdmin = false;
        saveAdminState();
        applyAdminMode();
    }
});

/* ---------------------- DATA LOADING ---------------------- */

async function loadWeeks() {
    const weeksFromApi = await fetchJSON(`${API_BASE}/api/weeks`);
    weeks = weeksFromApi;
    renderWeekSelect();
}

async function loadTeams() {
    teams = await fetchJSON(`${API_BASE}/api/teams`);
}

async function loadDeletedWeeksAndTeams() {
    deletedWeeks = await fetchJSON(`${API_BASE}/api/weeks/deleted`);
    deletedTeams = await fetchJSON(`${API_BASE}/api/teams/deleted`);
    renderDeletedLists();
}

function renderWeekSelect() {
    weekSelect.innerHTML = "";
    weeks.forEach((w) => {
        const opt = document.createElement("option");
        opt.value = w.id;
        opt.textContent = weekLabelFromNumber(w.week_number);
        weekSelect.appendChild(opt);
    });

    if (!currentWeekId && weeks.length > 0) {
        currentWeekId = weeks[weeks.length - 1].id;
    }
    if (currentWeekId) {
        weekSelect.value = currentWeekId;
    }

    const wrapper = weekSelect.closest(".row");
    if (wrapper) {
        if (weeks.length === 0) {
            editWeekBtn.disabled = true;
            deleteWeekBtn.disabled = true;
        } else {
            editWeekBtn.disabled = false;
            deleteWeekBtn.disabled = false;
        }
    }
}

/* ---------------------- STATS TABLE (WEEK VIEW) ---------------------- */

function computeRanking(rows) {
    const n = rows.length;
    if (n === 0) return [];

    const ranking = rows.map(() => ({
        perStat: {},
        totalScore: 0,
        totalRank: null,
    }));

    statDefs.forEach(({ field, highBetter }) => {
        const items = [];
        rows.forEach((row, index) => {
            const value = row[field];
            if (value === null || value === undefined || value === "") return;
            const num = Number(value);
            if (Number.isNaN(num)) return;
            items.push({ index, value: num });
        });

        if (items.length === 0) return;

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
            ranking[rowIndex].perStat[field] = { rank, bracket };
            ranking[rowIndex].totalScore += bracket;
        }
    });

    const totalItems = ranking.map((r, index) => ({
        index,
        value: r.totalScore,
    }));

    totalItems.sort((a, b) => b.value - a.value);

    let rank = 1;
    for (let i = 0; i < totalItems.length; i++) {
        if (i > 0 && totalItems[i].value !== totalItems[i - 1].value) {
            rank = i + 1;
        }
        ranking[totalItems[i].index].totalRank = rank;
    }

    return ranking;
}

function describeTotalRank(r, n) {
    if (!r || !r.totalRank) return "";
    const rank = r.totalRank;
    const bracketTotal = r.totalScore ?? 0;
    return `${formatOrdinal(rank)} (${bracketTotal})`;
}

function formatOrdinal(rank) {
    const j = rank % 10,
        k = rank % 100;
    if (j === 1 && k !== 11) return rank + "st";
    if (j === 2 && k !== 12) return rank + "nd";
    if (j === 3 && k !== 13) return rank + "rd";
    return rank + "th";
}

function getRankClass(rank, teamCount) {
    if (!rank || teamCount <= 1) return "";
    if (rank === 1) return "rank-best";
    if (rank === teamCount) return "rank-worst";
    return "";
}

function describeMetric(metric) {
    if (metric === "total") return "Total (sum of category brackets)";
    const def = statDefs.find((s) => s.field === metric);
    if (!def) return metric;
    return def.label;
}

async function loadStatsForWeek(weekId) {
    const rows = await fetchJSON(`${API_BASE}/api/stats?weekId=${encodeURIComponent(weekId)}`);
    rowsData = rows;
    rankingData = computeRanking(rows);
    const ranked = rows.map((row, index) => ({
        ...row,
        ranking: rankingData[index],
    }));

    rankingOrder = ranked.slice().sort((a, b) => {
        const ra = a.ranking?.totalRank ?? 9999;
        const rb = b.ranking?.totalRank ?? 9999;
        return ra - rb;
    });

    renderStatsTable();
}

function renderStatsTable() {
    if (!rowsData.length) {
        statsTable.innerHTML = "<tr><td>No teams yet for this week.</td></tr>";
        return;
    }

    const headerRow = `
    <thead>
      <tr>
        <th>Team</th>
        ${statDefs
            .map((s) => `<th class="sortable" data-sort-type="stat" data-field="${s.field}">${s.label}</th>`)
            .join("")}
        <th class="sortable" data-sort-type="total">Total</th>
      </tr>
    </thead>
  `;

    let dataSource;
    if (weekSortState.type === "total") {
        dataSource = rankingOrder.slice();
        if (weekSortState.direction === "desc") dataSource.reverse();
    } else if (weekSortState.type === "stat" && weekSortState.field) {
        const field = weekSortState.field;
        const highBetter = statDefs.find((s) => s.field === field)?.highBetter ?? true;
        dataSource = rowsData
            .map((row, index) => ({ index, row, ranking: rankingData[index] }))
            .sort((a, b) => {
                const va = a.row[field];
                const vb = b.row[field];
                const na = va === null || va === undefined || va === "" ? null : Number(va);
                const nb = vb === null || vb === undefined || vb === "" ? null : Number(vb);

                if (na === null && nb === null) return 0;
                if (na === null) return 1;
                if (nb === null) return -1;
                if (na === nb) return 0;

                return highBetter
                    ? weekSortState.direction === "asc"
                        ? nb - na
                        : na - nb
                    : weekSortState.direction === "asc"
                        ? na - nb
                        : nb - na;
            })
            .map((x) => ({
                ...x.row,
                ranking: rankingData[x.index],
            }));
    } else {
        dataSource = rowsData.map((row, index) => ({
            ...row,
            ranking: rankingData[index],
        }));
    }

    const nTeams = rowsData.length;

    let tbody = "<tbody>";
    dataSource.forEach((row) => {
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
            ranking,
        } = row;

        const fgRank = ranking?.perStat?.fg_pct || {};
        const ftRank = ranking?.perStat?.ft_pct || {};
        const threeRank = ranking?.perStat?.three_ptm || {};
        const ptsRank = ranking?.perStat?.pts || {};
        const rebRank = ranking?.perStat?.reb || {};
        const astRank = ranking?.perStat?.ast || {};
        const stRank = ranking?.perStat?.st || {};
        const blkRank = ranking?.perStat?.blk || {};
        const toRank = ranking?.perStat?.turnovers || {};

        tbody += `<tr data-team-id="${team_id}">
      <td>
        <div class="team-name-cell">
          <span class="team-name-main">${team_name}</span>
          ${owner_name ? `<span class="team-owner">${owner_name}</span>` : ""}
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${fg_pct ?? ""}</div>
          <div class="stat-rank ${getRankClass(fgRank.rank, nTeams)}">
            ${fgRank.rank ? `${formatOrdinal(fgRank.rank)} (${fgRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ft_pct ?? ""}</div>
          <div class="stat-rank ${getRankClass(ftRank.rank, nTeams)}">
            ${ftRank.rank ? `${formatOrdinal(ftRank.rank)} (${ftRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${three_ptm ?? ""}</div>
          <div class="stat-rank ${getRankClass(threeRank.rank, nTeams)}">
            ${threeRank.rank ? `${formatOrdinal(threeRank.rank)} (${threeRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${pts ?? ""}</div>
          <div class="stat-rank ${getRankClass(ptsRank.rank, nTeams)}">
            ${ptsRank.rank ? `${formatOrdinal(ptsRank.rank)} (${ptsRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${reb ?? ""}</div>
          <div class="stat-rank ${getRankClass(rebRank.rank, nTeams)}">
            ${rebRank.rank ? `${formatOrdinal(rebRank.rank)} (${rebRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ast ?? ""}</div>
          <div class="stat-rank ${getRankClass(astRank.rank, nTeams)}">
            ${astRank.rank ? `${formatOrdinal(astRank.rank)} (${astRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${st ?? ""}</div>
          <div class="stat-rank ${getRankClass(stRank.rank, nTeams)}">
            ${stRank.rank ? `${formatOrdinal(stRank.rank)} (${stRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${blk ?? ""}</div>
          <div class="stat-rank ${getRankClass(blkRank.rank, nTeams)}">
            ${blkRank.rank ? `${formatOrdinal(blkRank.rank)} (${blkRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${turnovers ?? ""}</div>
          <div class="stat-rank ${getRankClass(toRank.rank, nTeams)}">
            ${toRank.rank ? `${formatOrdinal(toRank.rank)} (${toRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <span class="${getRankClass(ranking?.totalRank, nTeams)}">
          ${describeTotalRank(ranking, nTeams)}
        </span>
      </td>
    </tr>`;
    });

    tbody += "</tbody>";
    statsTable.innerHTML = headerRow + tbody;
}

statsTable.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const sortType = th.dataset.sortType;
    const field = th.dataset.field || null;

    if (sortType === "total") {
        if (weekSortState.type === "total") {
            weekSortState.direction = weekSortState.direction === "asc" ? "desc" : "asc";
        } else {
            weekSortState.type = "total";
            weekSortState.direction = "asc";
        }
    } else if (sortType === "stat" && field) {
        if (weekSortState.type === "stat" && weekSortState.field === field) {
            weekSortState.direction = weekSortState.direction === "asc" ? "desc" : "asc";
        } else {
            weekSortState.type = "stat";
            weekSortState.field = field;
            weekSortState.direction = "asc";
        }
    }

    renderStatsTable();
});

/* ---------------------- EDIT WEEK / TEAM / STATS ---------------------- */

addWeekBtn.addEventListener("click", async () => {
    if (!isAdmin) {
        alert("Admin only.");
        return;
    }
    const input = prompt("Enter new week number (positive integer, unique):");
    if (!input) return;
    const weekNumber = Number(input);
    if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
        alert("Week number must be a positive integer.");
        return;
    }

    try {
        const newWeek = await fetchJSON(`${API_BASE}/api/weeks`, {
            method: "POST",
            body: JSON.stringify({ weekNumber }),
        });
        weeks.push(newWeek);
        weeks.sort((a, b) => a.week_number - b.week_number);
        currentWeekId = newWeek.id;
        renderWeekSelect();
        await loadStatsForWeek(currentWeekId);
        setStatus("Week added.", "ok");
        await loadDeletedWeeksAndTeams();
    } catch (err) {
        console.error(err);
        alert(err.message || "Error creating week");
    }
});

editWeekBtn.addEventListener("click", async () => {
    if (!isAdmin) {
        alert("Admin only.");
        return;
    }
    if (!weeks.length) {
        alert("No weeks to edit.");
        return;
    }
    const currentId = Number(weekSelect.value);
    const week = weeks.find((w) => w.id === currentId);
    if (!week) return;

    const input = prompt("Edit week number:", week.week_number);
    if (!input) return;
    const weekNumber = Number(input);
    if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
        alert("Week number must be a positive integer.");
        return;
    }

    try {
        const updated = await fetchJSON(`${API_BASE}/api/weeks/${week.id}`, {
            method: "PATCH",
            body: JSON.stringify({ weekNumber }),
        });
        const idx = weeks.findIndex((w) => w.id === week.id);
        if (idx !== -1) {
            weeks[idx] = updated;
            weeks.sort((a, b) => a.week_number - b.week_number);
        }
        currentWeekId = updated.id;
        renderWeekSelect();
        await loadStatsForWeek(currentWeekId);
        setStatus("Week updated.", "ok");
        await loadDeletedWeeksAndTeams();
    } catch (err) {
        console.error(err);
        alert(err.message || "Error updating week");
    }
});

deleteWeekBtn.addEventListener("click", async () => {
    if (!isAdmin) {
        alert("Admin only.");
        return;
    }
    const currentId = Number(weekSelect.value);
    if (!currentId) return;
    const week = weeks.find((w) => w.id === currentId);
    if (!week) return;

    if (!confirm(`Delete ${weekLabelFromNumber(week.week_number)}? (This is a soft delete.)`)) {
        return;
    }

    try {
        await fetchJSON(`${API_BASE}/api/weeks/${currentId}`, { method: "DELETE" });
        weeks = weeks.filter((w) => w.id !== currentId);
        currentWeekId = weeks.length ? weeks[0].id : null;
        renderWeekSelect();
        if (currentWeekId) {
            await loadStatsForWeek(currentWeekId);
        } else {
            statsTable.innerHTML = "<tr><td>No week selected.</td></tr>";
        }
        setStatus("Week deleted (archived).", "ok");
        await loadDeletedWeeksAndTeams();
    } catch (err) {
        console.error(err);
        alert("Error deleting week");
    }
});

addTeamBtn.addEventListener("click", async () => {
    if (!isAdmin) {
        alert("Admin only.");
        return;
    }
    const input = prompt("Enter new team name and owner, comma separated:\nExample: Lakers, Luca");
    if (!input) return;

    const parts = input.split(",").map((p) => p.trim());
    const name = parts[0];
    const owner = parts[1] || "";

    if (!name) {
        alert("Team name is required.");
        return;
    }

    try {
        const newTeam = await fetchJSON(`${API_BASE}/api/teams`, {
            method: "POST",
            body: JSON.stringify({ name, owner }),
        });
        teams.push(newTeam);
        teams.sort((a, b) => a.name.localeCompare(b.name));
        await loadStatsForWeek(currentWeekId);
        await loadTeamsForTeamView();
        setStatus("Team added.", "ok");
        await loadDeletedWeeksAndTeams();
    } catch (err) {
        console.error(err);
        alert(err.message || "Error adding team");
    }
});

statsTable.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const teamId = Number(btn.dataset.teamId);
    const weekId = Number(weekSelect.value || 0);
    if (!teamId || !weekId) return;

    if (action === "edit-stats") {
        if (!isAdmin) {
            alert("Admin only.");
            return;
        }

        const rowData = rowsData.find((r) => r.team_id === teamId);
        const existingParts = statDefs.map((stat) => {
            const v = rowData ? rowData[stat.field] : "";
            return v === null || v === undefined ? "" : String(v);
        });
        const prefill = existingParts.join(", ");
        const input = prompt(
            "Enter stats as comma-separated values in this order:\n" +
            "FG%, FT%, 3PTM, PTS, REB, AST, ST, BLK, TO",
            prefill
        );
        if (!input) return;

        const parts = input.split(",").map((s) => s.trim());
        const updated = {};
        let invalid = null;

        statDefs.forEach((stat, idx) => {
            const raw = parts[idx];
            const existing = rowData ? rowData[stat.field] : null;

            if (raw === undefined || raw === "") {
                updated[stat.field] = existing === undefined ? null : existing;
            } else {
                const num = Number(raw);
                if (Number.isNaN(num)) {
                    invalid = `Invalid number for ${stat.label}: "${raw}"`;
                } else {
                    updated[stat.field] = num;
                }
            }
        });

        if (invalid) {
            alert(invalid);
            return;
        }

        try {
            await fetchJSON(`${API_BASE}/api/stats`, {
                method: "POST",
                body: JSON.stringify({
                    teamId,
                    weekId,
                    ...updated,
                }),
            });
            setStatus("Stats saved.", "ok");
            await loadStatsForWeek(weekId);
            if (Number(teamViewSelect.value) === teamId) {
                await loadTeamView();
            }
        } catch (err) {
            console.error(err);
            alert("Error saving stats");
        }
    } else if (action === "edit-team") {
        if (!isAdmin) {
            alert("Admin only.");
            return;
        }
        const team = teams.find((t) => t.id === teamId);
        if (!team) return;

        const input = prompt(
            "Edit team name and owner, comma separated:",
            `${team.name}${team.owner_name ? ", " + team.owner_name : ""}`
        );
        if (!input) return;

        const parts = input.split(",").map((p) => p.trim());
        const name = parts[0];
        const owner = parts[1] || "";

        if (!name) {
            alert("Team name is required.");
            return;
        }

        try {
            const updated = await fetchJSON(`${API_BASE}/api/teams/${teamId}`, {
                method: "PATCH",
                body: JSON.stringify({ name, owner }),
            });
            const idx = teams.findIndex((t) => t.id === teamId);
            if (idx !== -1) {
                teams[idx] = updated;
                teams.sort((a, b) => a.name.localeCompare(b.name));
            }
            await loadStatsForWeek(weekId);
            await loadTeamsForTeamView();
            if (Number(teamViewSelect.value) === teamId) {
                await loadTeamView();
            }
            setStatus("Team updated.", "ok");
        } catch (err) {
            console.error(err);
            alert("Error updating team");
        }
    } else if (action === "delete-team") {
        if (!isAdmin) {
            alert("Admin only.");
            return;
        }
        const team = teams.find((t) => t.id === teamId);
        if (!team) return;

        if (!confirm(`Delete team "${team.name}"? (This is a soft delete.)`)) {
            return;
        }

        try {
            await fetchJSON(`${API_BASE}/api/teams/${teamId}`, { method: "DELETE" });
            teams = teams.filter((t) => t.id !== teamId);
            await loadStatsForWeek(weekId);
            await loadTeamsForTeamView();
            setStatus("Team deleted (archived).", "ok");
            await loadDeletedWeeksAndTeams();
        } catch (err) {
            console.error(err);
            alert("Error deleting team");
        }
    }
});

/* ---------------------- TEAM VIEW + SUMMARIES ---------------------- */

async function fetchSummaries(teamId) {
    try {
        teamSummary = await fetchJSON(`${API_BASE}/api/team-summary/${teamId}`);
    } catch (err) {
        console.error("Error fetching team summary", err);
        teamSummary = null;
    }

    try {
        leagueSummary = await fetchJSON(`${API_BASE}/api/league-summary`);
    } catch (err) {
        console.error("Error fetching league summary", err);
        leagueSummary = null;
    }
}

async function loadTeamsForTeamView() {
    const allTeams = await fetchJSON(`${API_BASE}/api/teams`);
    teams = allTeams;
    teamViewSelect.innerHTML = "";
    allTeams.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        teamViewSelect.appendChild(opt);
    });
}

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
        const sortedWeeks = [...weeks].sort((a, b) => a.week_number - b.week_number);

        for (const w of sortedWeeks) {
            const weekRows = await fetchJSON(`${API_BASE}/api/stats?weekId=${w.id}`);
            if (!weekRows.length) continue;

            const ranking = computeRanking(weekRows);
            const weekRanking = ranking;

            const idx = weekRows.findIndex((r) => r.team_id === teamId);
            if (idx === -1) continue;

            const row = weekRows[idx];
            const rInfo = weekRanking[idx];
            const n = weekRows.length;

            teamViewData.push({
                weekId: w.id,
                weekNumber: w.week_number,
                label: weekLabelFromNumber(w.week_number),
                row,
                ranking: rInfo,
                teamCount: n,
            });
        }

        await fetchSummaries(teamId);
        renderTeamViewTable();
        drawTeamChart();
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

    const ordered = [...teamViewData].sort((a, b) => a.weekNumber - b.weekNumber);

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
            ${fgRank.rank ? `${formatOrdinal(fgRank.rank)} (${fgRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ft_pct ?? ""}</div>
          <div class="stat-rank ${getRankClass(ftRank.rank, teamCount)}">
            ${ftRank.rank ? `${formatOrdinal(ftRank.rank)} (${ftRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${three_ptm ?? ""}</div>
          <div class="stat-rank ${getRankClass(threeRank.rank, teamCount)}">
            ${threeRank.rank ? `${formatOrdinal(threeRank.rank)} (${threeRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${pts ?? ""}</div>
          <div class="stat-rank ${getRankClass(ptsRank.rank, teamCount)}">
            ${ptsRank.rank ? `${formatOrdinal(ptsRank.rank)} (${ptsRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${reb ?? ""}</div>
          <div class="stat-rank ${getRankClass(rebRank.rank, teamCount)}">
            ${rebRank.rank ? `${formatOrdinal(rebRank.rank)} (${rebRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${ast ?? ""}</div>
          <div class="stat-rank ${getRankClass(astRank.rank, teamCount)}">
            ${astRank.rank ? `${formatOrdinal(astRank.rank)} (${astRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${st ?? ""}</div>
          <div class="stat-rank ${getRankClass(stRank.rank, teamCount)}">
            ${stRank.rank ? `${formatOrdinal(stRank.rank)} (${stRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${blk ?? ""}</div>
          <div class="stat-rank ${getRankClass(blkRank.rank, teamCount)}">
            ${blkRank.rank ? `${formatOrdinal(blkRank.rank)} (${blkRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <div class="stat-cell">
          <div class="stat-value">${turnovers ?? ""}</div>
          <div class="stat-rank ${getRankClass(toRank.rank, teamCount)}">
            ${toRank.rank ? `${formatOrdinal(toRank.rank)} (${toRank.bracket})` : ""}
          </div>
        </div>
      </td>

      <td>
        <span class="${getRankClass(ranking.totalRank, teamCount)}">
          ${describeTotalRank(ranking, teamCount)}
        </span>
      </td>
    </tr>`;
    });

    tbody += "</tbody>";
    teamViewTable.innerHTML = thead + tbody;
}

function clearTeamChart() {
    if (teamChart) {
        teamChart.destroy();
        teamChart = null;
    }
    if (teamChartCanvas) {
        const ctx = teamChartCanvas.getContext("2d");
        if (ctx) {
            ctx.clearRect(0, 0, teamChartCanvas.width, teamChartCanvas.height);
        }
    }
    teamChartMetricLabel.textContent = "";
}

function drawTeamChart() {
    const teamId = Number(teamViewSelect.value);
    if (!teamId || !teamViewData.length) {
        clearTeamChart();
        return;
    }

    const metric = teamChartMetric || "total";

    // Order by week number so x-axis is chronological
    const ordered = [...teamViewData].sort(
        (a, b) => a.weekNumber - b.weekNumber
    );

    const labels = ordered.map((e) => e.label);

    // Team values by week for the selected metric
    const teamValues = ordered.map((entry) => {
        if (metric === "total") {
            const ranking = entry.ranking;
            return ranking && typeof ranking.totalScore === "number"
                ? ranking.totalScore
                : null;
        } else {
            const row = entry.row;
            if (!row) return null;
            const v = row[metric];
            const num = Number(v);
            return Number.isNaN(num) ? null : num;
        }
    });

    const numericTeamValues = teamValues.filter(
        (v) => v !== null && !Number.isNaN(v)
    );
    if (!numericTeamValues.length) {
        clearTeamChart();
        return;
    }

    // Summary lines from backend
    const teamStatSummary =
        teamSummary && metric !== "total" ? teamSummary[metric] : null;
    const leagueStatSummary =
        leagueSummary && metric !== "total" ? leagueSummary[metric] : null;

    const teamMax = teamStatSummary && teamStatSummary.max != null ? teamStatSummary.max : null;
    const teamMin = teamStatSummary && teamStatSummary.min != null ? teamStatSummary.min : null;
    const teamAvg = teamStatSummary && teamStatSummary.avg != null ? teamStatSummary.avg : null;

    const leagueMax = leagueStatSummary && leagueStatSummary.max != null ? leagueStatSummary.max : null;
    const leagueMin = leagueStatSummary && leagueStatSummary.min != null ? leagueStatSummary.min : null;
    const leagueAvg = leagueStatSummary && leagueStatSummary.avg != null ? leagueStatSummary.avg : null;

    // Build scale from all relevant values
    const scaleValues = [...numericTeamValues];
    [teamMax, teamMin, teamAvg, leagueMax, leagueMin, leagueAvg].forEach((v) => {
        if (v !== null && !Number.isNaN(v)) {
            scaleValues.push(v);
        }
    });

    if (!scaleValues.length) {
        clearTeamChart();
        return;
    }

    let min = Math.min(...scaleValues);
    let max = Math.max(...scaleValues);
    if (min === max) {
        const pad = Math.abs(min || 1) * 0.1;
        min -= pad;
        max += pad;
    }

    // Destroy any existing chart
    if (teamChart) {
        teamChart.destroy();
        teamChart = null;
    }

    const datasets = [];

    // Main team line
    datasets.push({
        label: "Team",
        data: teamValues,
        borderColor: "rgba(59, 130, 246, 1)",
        backgroundColor: "rgba(59, 130, 246, 0.4)",
        borderWidth: 2,
        tension: 0.2,
        spanGaps: true,
        pointRadius: 3,
        pointHoverRadius: 4,
        pointHitRadius: 6,
    });

    // Helper to add horizontal line datasets
    function addHorizontalLine(label, value, color, dash, width) {
        if (value === null || Number.isNaN(value)) return;
        datasets.push({
            label,
            data: labels.map(() => value),
            borderColor: color,
            borderWidth: width || 1,
            borderDash: dash || [],
            pointRadius: 0,
            pointHitRadius: 0,
            fill: false,
            tension: 0,
        });
    }

    // Team-level lines
    addHorizontalLine("Team max", teamMax, "rgba(59, 130, 246, 0.9)", [], 1);
    addHorizontalLine("Team min", teamMin, "rgba(59, 130, 246, 0.7)", [4, 4], 1);
    addHorizontalLine("Team avg", teamAvg, "rgba(59, 130, 246, 0.6)", [2, 4], 1);

    // League-level lines
    addHorizontalLine("League max", leagueMax, "rgba(248, 113, 113, 0.9)", [], 1);
    addHorizontalLine("League min", leagueMin, "rgba(248, 113, 113, 0.8)", [4, 4], 1);
    addHorizontalLine("League avg", leagueAvg, "rgba(34, 197, 94, 0.9)", [2, 4], 1);

    teamChart = new Chart(teamChartCanvas, {
        type: "line",
        data: {
            labels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "nearest",
                intersect: false,
            },
            scales: {
                x: {
                    ticks: { color: "#9ca3af" },
                    grid: { color: "rgba(31, 41, 55, 0.5)" },
                },
                y: {
                    ticks: {
                        color: "#9ca3af",
                        callback: (value) =>
                            typeof value === "number" ? value.toFixed(2) : value,
                    },
                    grid: { color: "rgba(31, 41, 55, 0.5)" },
                    suggestedMin: min,
                    suggestedMax: max,
                },
            },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: "#e5e7eb",
                        font: { size: 11 },
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const v = ctx.parsed.y;
                            if (v == null || Number.isNaN(v)) return "";
                            return ctx.dataset.label + ": " + v.toFixed(2);
                        },
                    },
                },
                datalabels: {
                    // Only label the main team line (datasetIndex 0)
                    color: "#e5e7eb",
                    align: "top",
                    anchor: "end",
                    clamp: true,
                    formatter: (value, context) => {
                        if (context.datasetIndex !== 0) return "";
                        if (value == null || Number.isNaN(value)) return "";
                        return Number(value).toFixed(2);
                    },
                    font: {
                        size: 9,
                    },
                },
            },
        },
    });

    teamChartMetricLabel.textContent =
        metric === "total"
            ? "Metric: Total (sum of category brackets)"
            : "Metric: " + metric.toUpperCase();
}

teamViewTable.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-chart]");
    if (!th) return;
    const metric = th.dataset.chart;
    if (!metric) return;
    teamChartMetric = metric;
    drawTeamChart();
});

/* ---------------------- ARCHIVE / TRASH ---------------------- */

function renderDeletedLists() {
    if (!deletedWeeks || deletedWeeks.length === 0) {
        deletedWeeksContainer.innerHTML = '<div>No deleted weeks.</div>';
    } else {
        let html = '<table><thead><tr><th>Week</th><th>Actions</th></tr></thead><tbody>';
        deletedWeeks.forEach((w) => {
            html += `<tr>
        <td>${weekLabelFromNumber(w.week_number)}</td>
        <td>
          <div class="trash-list-actions">
            <button type="button" data-action="restore-week" data-id="${w.id}">
              Restore
            </button>
            <button type="button" data-action="perma-delete-week" data-id="${w.id}">
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
        deletedTeamsContainer.innerHTML = '<div>No deleted teams.</div>';
    } else {
        let html = '<table><thead><tr><th>Team</th><th>Owner</th><th>Actions</th></tr></thead><tbody>';
        deletedTeams.forEach((t) => {
            html += `<tr>
        <td>${t.name}</td>
        <td>${t.owner_name || ""}</td>
        <td>
          <div class="trash-list-actions">
            <button type="button" data-action="restore-team" data-id="${t.id}">
              Restore
            </button>
            <button type="button" data-action="perma-delete-team" data-id="${t.id}">
              Delete permanently
            </button>
          </div>
        </td>
      </tr>`;
        });
        html += "</tbody></table>";
        deletedTeamsContainer.innerHTML = html;
    }
}

deletedWeeksContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (!id) return;

    try {
        if (action === "restore-week") {
            await fetchJSON(`${API_BASE}/api/weeks/${id}/restore`, { method: "POST" });
            setStatus("Week restored.", "ok");
        } else if (action === "perma-delete-week") {
            if (!confirm("Permanently delete this week and its stats? This cannot be undone.")) {
                return;
            }
            await fetchJSON(`${API_BASE}/api/weeks/${id}/permanent`, { method: "DELETE" });
            setStatus("Week permanently deleted.", "ok");
        }
        await loadWeeks();
        if (weeks.length && !currentWeekId) {
            currentWeekId = weeks[0].id;
        }
        if (currentWeekId) {
            await loadStatsForWeek(currentWeekId);
        } else {
            statsTable.innerHTML = "<tr><td>No week selected.</td></tr>";
        }
        await loadDeletedWeeksAndTeams();
    } catch (err) {
        console.error(err);
        alert("Error updating deleted week");
    }
});

deletedTeamsContainer.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (!id) return;

    try {
        if (action === "restore-team") {
            await fetchJSON(`${API_BASE}/api/teams/${id}/restore`, { method: "POST" });
            setStatus("Team restored.", "ok");
        } else if (action === "perma-delete-team") {
            if (!confirm("Permanently delete this team and its stats? This cannot be undone.")) {
                return;
            }
            await fetchJSON(`${API_BASE}/api/teams/${id}/permanent`, { method: "DELETE" });
            setStatus("Team permanently deleted.", "ok");
        }
        await loadTeams();
        await loadStatsForWeek(currentWeekId);
        await loadTeamsForTeamView();
        await loadDeletedWeeksAndTeams();
    } catch (err) {
        console.error(err);
        alert("Error updating deleted team");
    }
});

/* ---------------------- EDIT TEAM NAME IN TEAM VIEW ---------------------- */

editTeamNameBtn.addEventListener("click", async () => {
    if (!isAdmin) {
        alert("Admin only.");
        return;
    }
    const teamId = Number(teamViewSelect.value);
    if (!teamId) {
        alert("Select a team first.");
        return;
    }
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;

    const input = prompt(
        "Edit team name and owner, comma separated:",
        `${team.name}${team.owner_name ? ", " + team.owner_name : ""}`
    );
    if (!input) return;

    const parts = input.split(",").map((p) => p.trim());
    const name = parts[0];
    const owner = parts[1] || "";

    if (!name) {
        alert("Team name is required.");
        return;
    }

    try {
        const updated = await fetchJSON(`${API_BASE}/api/teams/${teamId}`, {
            method: "PATCH",
            body: JSON.stringify({ name, owner }),
        });
        const idx = teams.findIndex((t) => t.id === teamId);
        if (idx !== -1) {
            teams[idx] = updated;
            teams.sort((a, b) => a.name.localeCompare(b.name));
        }
        await loadStatsForWeek(currentWeekId);
        await loadTeamsForTeamView();
        await loadTeamViewIfTeamSelected();
        setStatus("Team updated.", "ok");
    } catch (err) {
        console.error(err);
        alert("Error updating team");
    }
});

teamViewRefreshBtn.addEventListener("click", loadTeamViewIfTeamSelected);

/* ---------------------- INIT ---------------------- */

async function init() {
    try {
        loadAdminState();
        await loadWeeks();
        if (weeks.length) {
            currentWeekId = weeks[weeks.length - 1].id;
            weekSelect.value = currentWeekId;
            await loadStatsForWeek(currentWeekId);
        } else {
            statsTable.innerHTML = "<tr><td>No weeks yet. Add a week first.</td></tr>";
        }

        await loadTeamsForTeamView();
        await loadDeletedWeeksAndTeams();
        setStatus("Loaded.", "ok");
    } catch (err) {
        console.error(err);
        setStatus("Error initialising app.", "err");
    }
}

weekSelect.addEventListener("change", async () => {
    const weekId = Number(weekSelect.value);
    currentWeekId = weekId || null;
    if (currentWeekId) {
        await loadStatsForWeek(currentWeekId);
    }
});

teamViewSelect.addEventListener("change", loadTeamViewIfTeamSelected);

init();
