const express = require('express');
const pool = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3001);
const INTERVAL_MS = Number(process.env.ALLOCATION_INTERVAL_MS || 5000);

// Simple matching rule: which kind of resource suits which kind of request.
const RESOURCE_FOR = {
  medical: 'hospital_bed',
  fire: 'rescue_team',
  rescue: 'rescue_team',
  other: 'rescue_team',
};

// Lets the dashboard (served from port 3000) read data from this service (port 3001).
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/allocations', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.id, a.request_id, a.resource_id, a.allocated_at,
              r.type AS request_type, r.location AS request_location, r.severity,
              res.name AS resource_name, res.type AS resource_type
         FROM allocations a
         JOIN requests r   ON r.id = a.request_id
         JOIN resources res ON res.id = a.resource_id
        ORDER BY a.id DESC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/resources', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, type, location, available FROM resources ORDER BY id'
    );
    res.json(rows.map((row) => ({ ...row, available: Boolean(row.available) })));
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error('[allocation] Unexpected error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Tries to allocate one request. Returns true if it succeeded, false if the request
// was already taken or no suitable resource is free right now.
async function tryAllocate(requestId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the request so nobody else processes it at the same time.
    const [requestRows] = await conn.query(
      `SELECT id, type, severity FROM requests
        WHERE id = ? AND status = 'pending'
        FOR UPDATE SKIP LOCKED`,
      [requestId]
    );
    if (requestRows.length === 0) {
      await conn.rollback();
      return false;
    }
    const request = requestRows[0];

    // Lock one free resource of the right type.
    const [resourceRows] = await conn.query(
      `SELECT id, name FROM resources
        WHERE available = TRUE AND type = ?
        ORDER BY id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [RESOURCE_FOR[request.type]]
    );
    if (resourceRows.length === 0) {
      await conn.rollback();
      return false;
    }
    const resource = resourceRows[0];

    await conn.query('INSERT INTO allocations (request_id, resource_id) VALUES (?, ?)', [
      request.id,
      resource.id,
    ]);
    await conn.query('UPDATE resources SET available = FALSE WHERE id = ?', [resource.id]);
    await conn.query("UPDATE requests SET status = 'allocated' WHERE id = ?", [request.id]);

    await conn.commit();
    console.log(
      `[allocation] Request #${request.id} (${request.type}, severity ${request.severity}) -> ${resource.name}`
    );
    return true;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

let cycleRunning = false;

async function runAllocationCycle() {
  if (cycleRunning) return; // do not start a new cycle while the previous one is still busy
  cycleRunning = true;
  try {
    const [pending] = await pool.query(
      `SELECT id FROM requests
        WHERE status = 'pending'
        ORDER BY severity DESC, created_at ASC, id ASC`
    );

    let allocated = 0;
    for (const { id } of pending) {
      try {
        if (await tryAllocate(id)) allocated += 1;
      } catch (err) {
        console.error(`[allocation] Failed to allocate request #${id}:`, err.message);
      }
    }

    if (pending.length > 0) {
      console.log(
        `[allocation] Cycle done: ${pending.length} pending, ${allocated} allocated, ${pending.length - allocated} waiting for a free resource`
      );
    }
  } catch (err) {
    console.error('[allocation] Cycle failed:', err.message);
  } finally {
    cycleRunning = false;
  }
}

const server = app.listen(PORT, async () => {
  console.log(`[allocation] Listening on port ${PORT}`);
  try {
    await pool.query('SELECT 1');
    console.log('[allocation] Database connection OK');
  } catch (err) {
    console.error('[allocation] Could not reach the database:', err.message);
  }
});

const timer = setInterval(runAllocationCycle, INTERVAL_MS);
console.log(`[allocation] Allocation loop runs every ${INTERVAL_MS} ms`);

function shutdown() {
  console.log('[allocation] Shutting down');
  clearInterval(timer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);