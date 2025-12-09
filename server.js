const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "fantasy.db");

const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");

    // Teams now include owner_name
    db.run(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      owner_name TEXT,
      deleted_at DATETIME
    )
  `);

    // Weeks use numeric week_number (unique, > 0)
    db.run(`
    CREATE TABLE IF NOT EXISTS weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_number INTEGER NOT NULL UNIQUE,
      deleted_at DATETIME
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      week_id INTEGER NOT NULL,
      fg_pct REAL,
      ft_pct REAL,
      three_ptm REAL,
      pts REAL,
      reb REAL,
      ast REAL,
      st REAL,
      blk REAL,
      turnovers REAL,
      UNIQUE(team_id, week_id),
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY(week_id) REFERENCES weeks(id) ON DELETE CASCADE
    )
  `);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}
function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}
function allAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

/* ---------------------- WEEKS ---------------------- */

// Get active weeks ordered by week_number
app.get("/api/weeks", async (req, res) => {
    try {
        const weeks = await allAsync(
            `SELECT id, week_number
       FROM weeks
       WHERE deleted_at IS NULL
       ORDER BY week_number ASC`
        );
        res.json(weeks);
    } catch (err) {
        console.error("GET /api/weeks", err);
        res.status(500).send("Error fetching weeks");
    }
});

// Create a week with numeric week_number
app.post("/api/weeks", async (req, res) => {
    try {
        let { weekNumber } = req.body;
        weekNumber = Number(weekNumber);

        if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
            return res.status(400).send("weekNumber must be a positive integer");
        }

        const existing = await getAsync(
            `SELECT id FROM weeks WHERE week_number = ? AND deleted_at IS NULL`,
            [weekNumber]
        );
        if (existing) {
            return res.status(400).send("Week number already exists");
        }

        const result = await runAsync(
            `INSERT INTO weeks (week_number) VALUES (?)`,
            [weekNumber]
        );

        const created = await getAsync(
            `SELECT id, week_number FROM weeks WHERE id = ?`,
            [result.lastID]
        );
        res.json(created);
    } catch (err) {
        console.error("POST /api/weeks", err);
        res.status(500).send("Error creating week");
    }
});

// Soft-delete week
app.delete("/api/weeks/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        await runAsync(
            `UPDATE weeks SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
            [id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE /api/weeks/:id", err);
        res.status(500).send("Error deleting week");
    }
});

// List deleted weeks
app.get("/api/weeks/deleted", async (req, res) => {
    try {
        const rows = await allAsync(
            `SELECT id, week_number
       FROM weeks
       WHERE deleted_at IS NOT NULL
       ORDER BY week_number ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error("GET /api/weeks/deleted", err);
        res.status(500).send("Error fetching deleted weeks");
    }
});

// Restore a deleted week
app.post("/api/weeks/:id/restore", async (req, res) => {
    try {
        const id = Number(req.params.id);
        await runAsync(
            `UPDATE weeks SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
            [id]
        );
        const row = await getAsync(
            `SELECT id, week_number FROM weeks WHERE id = ?`,
            [id]
        );
        res.json(row);
    } catch (err) {
        console.error("POST /api/weeks/:id/restore", err);
        res.status(500).send("Error restoring week");
    }
});

// Permanently delete a week
app.delete("/api/weeks/:id/permanent", async (req, res) => {
    try {
        const id = Number(req.params.id);
        await runAsync(`DELETE FROM weeks WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE /api/weeks/:id/permanent", err);
        res.status(500).send("Error permanently deleting week");
    }
});

// Edit week number
app.patch("/api/weeks/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        let { weekNumber } = req.body;
        weekNumber = Number(weekNumber);

        if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
            return res.status(400).send("weekNumber must be a positive integer");
        }

        const exists = await getAsync(
            `SELECT id FROM weeks
       WHERE week_number = ? AND deleted_at IS NULL AND id <> ?`,
            [weekNumber, id]
        );
        if (exists) {
            return res.status(400).send("Week number already exists");
        }

        await runAsync(
            `UPDATE weeks SET week_number = ? WHERE id = ? AND deleted_at IS NULL`,
            [weekNumber, id]
        );
        const updated = await getAsync(
            `SELECT id, week_number FROM weeks WHERE id = ?`,
            [id]
        );
        res.json(updated);
    } catch (err) {
        console.error("PATCH /api/weeks/:id", err);
        res.status(500).send("Error updating week number");
    }
});

/* ---------------------- TEAMS ---------------------- */

// Get active teams
app.get("/api/teams", async (req, res) => {
    try {
        const teams = await allAsync(
            `SELECT id, name, owner_name
       FROM teams
       WHERE deleted_at IS NULL
       ORDER BY name COLLATE NOCASE ASC`
        );
        res.json(teams);
    } catch (err) {
        console.error("GET /api/teams", err);
        res.status(500).send("Error fetching teams");
    }
});

// Create team (name + owner_name)
app.post("/api/teams", async (req, res) => {
    try {
        let { name, owner } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).send("Name is required");
        }
        name = name.trim();
        owner = owner && owner.trim ? owner.trim() : null;

        const existing = await getAsync(
            `SELECT id FROM teams WHERE name = ? AND deleted_at IS NULL`,
            [name]
        );
        if (existing) {
            return res.status(400).send("Team name already exists");
        }

        const result = await runAsync(
            `INSERT INTO teams (name, owner_name) VALUES (?, ?)`,
            [name, owner]
        );
        const created = await getAsync(
            `SELECT id, name, owner_name FROM teams WHERE id = ?`,
            [result.lastID]
        );
        res.json(created);
    } catch (err) {
        console.error("POST /api/teams", err);
        res.status(500).send("Error creating team");
    }
});

// Soft-delete team
app.delete("/api/teams/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        await runAsync(
            `UPDATE teams SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
            [id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE /api/teams/:id", err);
        res.status(500).send("Error deleting team");
    }
});

// List deleted teams
app.get("/api/teams/deleted", async (req, res) => {
    try {
        const rows = await allAsync(
            `SELECT id, name, owner_name
       FROM teams
       WHERE deleted_at IS NOT NULL
       ORDER BY name COLLATE NOCASE ASC`
        );
        res.json(rows);
    } catch (err) {
        console.error("GET /api/teams/deleted", err);
        res.status(500).send("Error fetching deleted teams");
    }
});

// Restore team
app.post("/api/teams/:id/restore", async (req, res) => {
    try {
        const id = Number(req.params.id);
        await runAsync(
            `UPDATE teams SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`,
            [id]
        );
        const row = await getAsync(
            `SELECT id, name, owner_name FROM teams WHERE id = ?`,
            [id]
        );
        res.json(row);
    } catch (err) {
        console.error("POST /api/teams/:id/restore", err);
        res.status(500).send("Error restoring team");
    }
});

// Permanently delete team
app.delete("/api/teams/:id/permanent", async (req, res) => {
    try {
        const id = Number(req.params.id);
        await runAsync(`DELETE FROM teams WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (err) {
        console.error("DELETE /api/teams/:id/permanent", err);
        res.status(500).send("Error permanently deleting team");
    }
});

// Edit team name + owner
app.patch("/api/teams/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);
        let { name, owner } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).send("Name is required");
        }
        name = name.trim();
        owner = owner && owner.trim ? owner.trim() : null;

        const exists = await getAsync(
            `SELECT id FROM teams
       WHERE name = ? AND deleted_at IS NULL AND id <> ?`,
            [name, id]
        );
        if (exists) {
            return res.status(400).send("Team name already exists");
        }

        await runAsync(
            `UPDATE teams
       SET name = ?, owner_name = ?
       WHERE id = ? AND deleted_at IS NULL`,
            [name, owner, id]
        );
        const updated = await getAsync(
            `SELECT id, name, owner_name FROM teams WHERE id = ?`,
            [id]
        );
        res.json(updated);
    } catch (err) {
        console.error("PATCH /api/teams/:id", err);
        res.status(500).send("Error updating team");
    }
});

/* ---------------------- STATS ---------------------- */

// Get stats for a week, including teams with no stats yet
app.get("/api/stats", async (req, res) => {
    try {
        const weekId = Number(req.query.weekId);
        if (!weekId) {
            return res.status(400).send("weekId is required");
        }

        const rows = await allAsync(
            `
      SELECT
        t.id AS team_id,
        t.name AS team_name,
        t.owner_name AS owner_name,
        s.fg_pct,
        s.ft_pct,
        s.three_ptm,
        s.pts,
        s.reb,
        s.ast,
        s.st,
        s.blk,
        s.turnovers
      FROM teams t
      LEFT JOIN stats s
        ON s.team_id = t.id AND s.week_id = ?
      WHERE t.deleted_at IS NULL
      ORDER BY t.name COLLATE NOCASE ASC
      `,
            [weekId]
        );

        res.json(rows);
    } catch (err) {
        console.error("GET /api/stats", err);
        res.status(500).send("Error fetching stats");
    }
});

// Download the raw SQLite DB file as a backup
app.get("/api/export-db", (req, res) => {
    const dbPath = path.join(__dirname, "fantasy.db");

    fs.stat(dbPath, (err, stats) => {
        if (err || !stats.isFile()) {
            console.error("DB export error:", err);
            return res.status(500).send("Database file not found");
        }

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader(
            "Content-Disposition",
            'attachment; filename="fantasy.db"'
        );

        const stream = fs.createReadStream(dbPath);
        stream.on("error", (err) => {
            console.error("DB export stream error:", err);
            if (!res.headersSent) {
                res.status(500).end("Error reading database file");
            } else {
                res.end();
            }
        });
        stream.pipe(res);
    });
});


// Upsert stats for a team-week
app.post("/api/stats", async (req, res) => {
    try {
        const {
            teamId,
            weekId,
            fg_pct,
            ft_pct,
            three_ptm,
            pts,
            reb,
            ast,
            st,
            blk,
            turnovers,
        } = req.body;

        if (!teamId || !weekId) {
            return res.status(400).send("teamId and weekId are required");
        }

        const existing = await getAsync(
            `SELECT id FROM stats WHERE team_id = ? AND week_id = ?`,
            [teamId, weekId]
        );

        const params = [
            fg_pct,
            ft_pct,
            three_ptm,
            pts,
            reb,
            ast,
            st,
            blk,
            turnovers,
        ];

        if (existing) {
            await runAsync(
                `
        UPDATE stats
        SET fg_pct = ?, ft_pct = ?, three_ptm = ?, pts = ?, reb = ?,
            ast = ?, st = ?, blk = ?, turnovers = ?
        WHERE id = ?
        `,
                [...params, existing.id]
            );
        } else {
            await runAsync(
                `
        INSERT INTO stats (
          team_id, week_id,
          fg_pct, ft_pct, three_ptm,
          pts, reb, ast, st, blk, turnovers
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
                [teamId, weekId, ...params]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error("POST /api/stats", err);
        res.status(500).send("Error saving stats");
    }
});

/* ---------------------- START ---------------------- */

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
