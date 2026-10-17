const path = require('path');
const express = require('express');
const pool = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const VALID_TYPES = ['medical', 'fire', 'rescue', 'other'];

app.use(express.json());

// Returns a list of problems (empty list means the input is valid) and a cleaned copy.
function validateRequest(body) {
  const errors = [];
  const { type, location, severity } = body || {};

  if (typeof type !== 'string' || !VALID_TYPES.includes(type)) {
    errors.push(`type is required and must be one of: ${VALID_TYPES.join(', ')}`);
  }

  if (typeof location !== 'string' || location.trim() === '') {
    errors.push('location is required and must be non-empty text');
  } else if (location.trim().length > 255) {
    errors.push('location must be 255 characters or fewer');
  }

  const sev =
    typeof severity === 'string' && severity.trim() !== '' ? Number(severity) : severity;
  if (!Number.isInteger(sev) || sev < 1 || sev > 5) {
    errors.push('severity is required and must be a whole number from 1 to 5');
  }

  return {
    errors,
    value: {
      type,
      location: typeof location === 'string' ? location.trim() : location,
      severity: sev,
    },
  };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/requests', async (req, res, next) => {
  try {
    const { errors, value } = validateRequest(req.body);
    if (errors.length > 0) {
      console.warn(`[intake] Rejected request: ${errors.join('; ')}`);
      return res.status(400).json({ errors });
    }

    const [result] = await pool.query(
      'INSERT INTO requests (type, location, severity, status) VALUES (?, ?, ?, ?)',
      [value.type, value.location, value.severity, 'pending']
    );
    const [rows] = await pool.query('SELECT * FROM requests WHERE id = ?', [result.insertId]);

    console.log(
      `[intake] Saved request #${result.insertId} (${value.type}, severity ${value.severity}, ${value.location})`
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get('/requests', async (req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT * FROM requests ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// The dashboard page lives in the public folder.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Catches any error passed along with next(err) above.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  console.error('[intake] Unexpected error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, async () => {
  console.log(`[intake] Listening on port ${PORT}`);
  try {
    await pool.query('SELECT 1');
    console.log('[intake] Database connection OK');
  } catch (err) {
    console.error('[intake] Could not reach the database:', err.message);
  }
});

function shutdown() {
  console.log('[intake] Shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);