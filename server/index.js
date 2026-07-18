const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || (process.env.DATABASE_URL ? undefined : 'localhost'),
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || (process.env.DATABASE_URL ? undefined : 'hospital_queue'),
  user: process.env.PGUSER || (process.env.DATABASE_URL ? undefined : 'postgres'),
  password: process.env.PGPASSWORD || undefined
});

const DEFAULT_CONSULTATION_MINUTES = 12;
const DEFAULT_LAB_MINUTES = 15;
const LAB_PRIORITY = { prescribed: 1, doctorReferral: 5, self: 10 };

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !body[field]);
  return missing.length ? `${missing.join(', ')} required.` : null;
}

async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result;
}

async function getUser(username, password) {
  const result = await query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
  return result.rows[0];
}

async function getDoctor(doctorId) {
  const result = await query('SELECT * FROM doctors WHERE id = $1', [doctorId]);
  return result.rows[0];
}

async function getLab(labId) {
  const result = await query('SELECT * FROM labs WHERE id = $1', [labId]);
  return result.rows[0];
}

async function estimateDoctorWait(client, doctorId) {
  const averageResult = await client.query(
    `SELECT COALESCE(ROUND(AVG(duration_minutes))::int, $2) AS average
       FROM activity_logs
      WHERE actor_role = 'doctor' AND actor_id = $1 AND action = 'finish_patient'`,
    [doctorId, DEFAULT_CONSULTATION_MINUTES]
  );
  const waitingResult = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM tokens
      WHERE doctor_id = $1 AND status IN ('waiting_doctor', 'in_doctor')`,
    [doctorId]
  );
  return waitingResult.rows[0].count * averageResult.rows[0].average;
}

async function estimateLabWait(client, labId) {
  const lab = await client.query('SELECT capacity FROM labs WHERE id = $1', [labId]);
  const waiting = await client.query(
    `SELECT COUNT(*)::int AS count FROM tokens WHERE lab_id = $1 AND status = 'waiting_lab'`,
    [labId]
  );
  const capacity = Math.max(1, lab.rows[0]?.capacity || 1);
  return Math.ceil(waiting.rows[0].count / capacity) * DEFAULT_LAB_MINUTES;
}

async function createSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS hospitals (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT '';

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'hospital', 'patient', 'doctor', 'lab')),
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      hospital_id INTEGER REFERENCES hospitals(id) ON DELETE CASCADE,
      doctor_id INTEGER,
      lab_id INTEGER,
      travel_minutes INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id SERIAL PRIMARY KEY,
      hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      daily_token_limit INTEGER NOT NULL DEFAULT 50,
      consultation_fee INTEGER NOT NULL DEFAULT 0,
      avg_consultation_minutes INTEGER NOT NULL DEFAULT 12,
      avg_daily_break_minutes INTEGER NOT NULL DEFAULT 120,
      on_break BOOLEAN NOT NULL DEFAULT FALSE,
      break_started_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE doctors ADD COLUMN IF NOT EXISTS consultation_fee INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE doctors ADD COLUMN IF NOT EXISTS avg_consultation_minutes INTEGER NOT NULL DEFAULT 12;
    ALTER TABLE doctors ADD COLUMN IF NOT EXISTS avg_daily_break_minutes INTEGER NOT NULL DEFAULT 120;

    CREATE TABLE IF NOT EXISTS labs (
      id SERIAL PRIMARY KEY,
      hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
      daily_token_limit INTEGER NOT NULL DEFAULT 100,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE users
      ADD CONSTRAINT users_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE;

    ALTER TABLE users
      ADD CONSTRAINT users_lab_fk FOREIGN KEY (lab_id) REFERENCES labs(id) ON DELETE CASCADE;
  `).catch((error) => {
    if (!String(error.message).includes('already exists')) {
      throw error;
    }
  });

  await query(`
    CREATE TABLE IF NOT EXISTS tokens (
      id SERIAL PRIMARY KEY,
      token_number INTEGER NOT NULL,
      patient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      patient_name TEXT NOT NULL,
      hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      doctor_id INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
      lab_id INTEGER REFERENCES labs(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN (
        'waiting_doctor', 'in_doctor', 'waiting_lab', 'in_lab', 'finished'
      )),
      prescribed_lab BOOLEAN NOT NULL DEFAULT FALSE,
      priority INTEGER NOT NULL DEFAULT 5,
      token_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    );

    ALTER TABLE tokens ADD COLUMN IF NOT EXISTS token_date DATE NOT NULL DEFAULT CURRENT_DATE;
    CREATE INDEX IF NOT EXISTS tokens_doctor_status_idx ON tokens(doctor_id, status, token_date, created_at);
    CREATE INDEX IF NOT EXISTS tokens_lab_status_idx ON tokens(lab_id, status, priority, token_date, created_at);

    CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      actor_role TEXT NOT NULL,
      actor_id INTEGER,
      token_id INTEGER REFERENCES tokens(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      duration_minutes INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  await query(
    `INSERT INTO users (role, name, username, password)
     VALUES ('admin', 'System Admin', $1, $2)
     ON CONFLICT (username) DO NOTHING`,
    [adminUsername, adminPassword]
  );
}

async function getHospitals() {
  const result = await query(`
    SELECT
      h.*,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id', d.id,
        'name', d.name,
        'dailyTokenLimit', d.daily_token_limit,
        'consultationFee', d.consultation_fee,
        'avgConsultationMinutes', d.avg_consultation_minutes,
        'avgDailyBreakMinutes', d.avg_daily_break_minutes
      )) FILTER (WHERE d.id IS NOT NULL), '[]') AS doctors,
      COALESCE(json_agg(DISTINCT jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'capacity', l.capacity,
        'dailyTokenLimit', l.daily_token_limit
      )) FILTER (WHERE l.id IS NOT NULL), '[]') AS labs
    FROM hospitals h
    LEFT JOIN doctors d ON d.hospital_id = h.id
    LEFT JOIN labs l ON l.hospital_id = h.id
    GROUP BY h.id
    ORDER BY h.name
  `);
  return result.rows;
}

async function getStatus() {
  const doctors = await query(`
    SELECT d.*,
      h.name AS hospital_name,
      row_to_json(current_token) AS current,
      COALESCE(waiting.queue, '[]') AS queue,
      COALESCE(waiting.count, 0)::int AS queue_length,
      COALESCE(finished.count, 0)::int AS finished_today,
      COALESCE(avg_times.avg_service_minutes, d.avg_consultation_minutes)::int AS avg_service_minutes,
      COALESCE(break_times.avg_break_minutes, d.avg_daily_break_minutes)::int AS avg_break_minutes,
      COALESCE(daily_tokens.count, 0)::int AS todays_tokens,
      GREATEST(0, d.daily_token_limit - COALESCE(daily_tokens.count, 0))::int AS tokens_remaining,
      (COALESCE(waiting.count, 0) * COALESCE(avg_times.avg_service_minutes, d.avg_consultation_minutes))::int AS avg_wait_minutes,
      (COALESCE(waiting.count, 0) * COALESCE(avg_times.avg_service_minutes, d.avg_consultation_minutes) + COALESCE(break_times.avg_break_minutes, d.avg_daily_break_minutes))::int AS avg_wait_with_break_minutes
    FROM doctors d
    JOIN hospitals h ON h.id = d.hospital_id
    LEFT JOIN LATERAL (
      SELECT t.* FROM tokens t
      WHERE t.doctor_id = d.id AND t.status = 'in_doctor'
      ORDER BY t.started_at
      LIMIT 1
    ) current_token ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(t ORDER BY t.created_at) AS queue, COUNT(*) AS count
      FROM tokens t
      WHERE t.doctor_id = d.id AND t.status = 'waiting_doctor'
    ) waiting ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count
      FROM tokens t
      WHERE t.doctor_id = d.id AND t.status = 'finished' AND t.finished_at::date = CURRENT_DATE
    ) finished ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(ROUND(AVG(duration_minutes))::int, d.avg_consultation_minutes) AS avg_service_minutes
      FROM activity_logs
      WHERE actor_role = 'doctor'
        AND actor_id = d.id
        AND action = 'finish_patient'
        AND created_at >= NOW() - INTERVAL '30 days'
    ) avg_times ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(ROUND(AVG(duration_minutes))::int, d.avg_daily_break_minutes) AS avg_break_minutes
      FROM activity_logs
      WHERE actor_role = 'doctor'
        AND actor_id = d.id
        AND action = 'break_end'
        AND created_at >= NOW() - INTERVAL '30 days'
    ) break_times ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count
      FROM tokens t
      WHERE t.doctor_id = d.id AND t.token_date = CURRENT_DATE
    ) daily_tokens ON TRUE
    ORDER BY h.name, d.name
  `);

  const labs = await query(`
    SELECT l.*,
      h.name AS hospital_name,
      COALESCE(active.queue, '[]') AS active_patients,
      COALESCE(waiting.queue, '[]') AS queue,
      COALESCE(waiting.count, 0)::int AS queue_length,
      COALESCE(finished.count, 0)::int AS finished_today
    FROM labs l
    JOIN hospitals h ON h.id = l.hospital_id
    LEFT JOIN LATERAL (
      SELECT json_agg(t ORDER BY t.started_at) AS queue
      FROM tokens t
      WHERE t.lab_id = l.id AND t.status = 'in_lab'
    ) active ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(t ORDER BY GREATEST(1, t.priority - FLOOR(EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 300)), t.created_at) AS queue, COUNT(*) AS count
      FROM tokens t
      WHERE t.lab_id = l.id AND t.status = 'waiting_lab'
    ) waiting ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS count
      FROM tokens t
      WHERE t.lab_id = l.id AND t.status = 'finished' AND t.finished_at::date = CURRENT_DATE
    ) finished ON TRUE
    ORDER BY h.name, l.name
  `);

  const stats = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS total_users,
      (SELECT COUNT(*)::int FROM hospitals) AS total_hospitals,
      (SELECT COUNT(*)::int FROM doctors) AS total_doctors,
      (SELECT COUNT(*)::int FROM labs) AS total_labs,
      (SELECT COUNT(*)::int FROM tokens) AS total_tokens,
      (SELECT COUNT(*)::int FROM tokens WHERE status LIKE 'waiting_%') AS waiting_tokens,
      (SELECT COUNT(*)::int FROM tokens WHERE status = 'finished') AS finished_tokens,
      (SELECT COALESCE(ROUND(AVG(duration_minutes), 1), 0) FROM activity_logs WHERE action = 'finish_patient') AS average_service_minutes,
      (SELECT COUNT(*)::int FROM activity_logs WHERE action = 'break_start' AND created_at::date = CURRENT_DATE) AS breaks_today
  `);

  return {
    doctors: doctors.rows,
    labs: labs.rows,
    stats: stats.rows[0]
  };
}

app.get('/api/hospitals', async (req, res) => {
  try {
    res.json(await getHospitals());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/register/hospital', async (req, res) => {
  const missing = requireFields(req.body, ['name', 'username', 'password']);
  if (missing) return res.status(400).json({ error: missing });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hospital = await client.query(
      'INSERT INTO hospitals (name, branch) VALUES ($1, $2) RETURNING *',
      [req.body.name, req.body.branch || '']
    );
    const user = await client.query(
      `INSERT INTO users (role, name, username, password, hospital_id)
       VALUES ('hospital', $1, $2, $3, $4) RETURNING *`,
      [req.body.name, req.body.username, req.body.password, hospital.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ user: sanitizeUser(user.rows[0]), hospital: hospital.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.code === '23505' ? 'Username already exists.' : error.message });
  } finally {
    client.release();
  }
});

app.post('/api/register/patient', async (req, res) => {
  const missing = requireFields(req.body, ['name', 'username', 'password']);
  if (missing) return res.status(400).json({ error: missing });

  try {
    const user = await query(
      `INSERT INTO users (role, name, username, password, travel_minutes)
       VALUES ('patient', $1, $2, $3, $4) RETURNING *`,
      [req.body.name, req.body.username, req.body.password, Number(req.body.travelMinutes) || 0]
    );
    res.json({ user: sanitizeUser(user.rows[0]) });
  } catch (error) {
    res.status(400).json({ error: error.code === '23505' ? 'Username already exists.' : error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const user = await getUser(req.body.username, req.body.password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tokens', async (req, res) => {
  try {
    const userId = Number(req.query.userId);
    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter required.' });
    }
    const fromParam = req.query.from;
    const toParam = req.query.to;
    const today = new Date();
    const defaultFrom = new Date(today);
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    const defaultTo = new Date(today);
    defaultTo.setDate(defaultTo.getDate() + 30);
    const fromDate = fromParam ? new Date(fromParam) : defaultFrom;
    const toDate = toParam ? new Date(toParam) : defaultTo;
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new Error('Invalid date range.');
    }
    if (fromDate > toDate) {
      throw new Error('Invalid date range.');
    }
    const fromString = fromDate.toISOString().split('T')[0];
    const toString = toDate.toISOString().split('T')[0];
    const tokens = await query(
      `SELECT * FROM tokens
        WHERE patient_user_id = $1
          AND token_date BETWEEN $2 AND $3
        ORDER BY token_date DESC, created_at DESC`,
      [userId, fromString, toString]
    );
    res.json({ tokens: tokens.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/hospitals/:hospitalId/doctors', async (req, res) => {
  const missing = requireFields(req.body, ['name', 'username', 'password']);
  if (missing) return res.status(400).json({ error: missing });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const doctor = await client.query(
      `INSERT INTO doctors (hospital_id, name, daily_token_limit, consultation_fee, avg_consultation_minutes, avg_daily_break_minutes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.hospitalId, req.body.name, Number(req.body.dailyTokenLimit) || 50, Number(req.body.consultationFee) || 0, Number(req.body.avgConsultationMinutes) || 12, Number(req.body.avgDailyBreakMinutes) || 120]
    );
    const user = await client.query(
      `INSERT INTO users (role, name, username, password, hospital_id, doctor_id)
       VALUES ('doctor', $1, $2, $3, $4, $5) RETURNING *`,
      [req.body.name, req.body.username, req.body.password, req.params.hospitalId, doctor.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ doctor: doctor.rows[0], user: sanitizeUser(user.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.code === '23505' ? 'Username already exists.' : error.message });
  } finally {
    client.release();
  }
});

app.post('/api/hospitals/:hospitalId/labs', async (req, res) => {
  const missing = requireFields(req.body, ['name', 'username', 'password']);
  if (missing) return res.status(400).json({ error: missing });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lab = await client.query(
      `INSERT INTO labs (hospital_id, name, capacity, daily_token_limit)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        req.params.hospitalId,
        req.body.name,
        Math.max(1, Number(req.body.capacity) || 1),
        Number(req.body.dailyTokenLimit) || 100
      ]
    );
    const user = await client.query(
      `INSERT INTO users (role, name, username, password, hospital_id, lab_id)
       VALUES ('lab', $1, $2, $3, $4, $5) RETURNING *`,
      [req.body.name, req.body.username, req.body.password, req.params.hospitalId, lab.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ lab: lab.rows[0], user: sanitizeUser(user.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.code === '23505' ? 'Username already exists.' : error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/hospitals/:hospitalId/doctors/:doctorId', async (req, res) => {
  const client = await pool.connect();
  try {
    const doctor = await client.query(
      `UPDATE doctors SET name = $1, daily_token_limit = $2, consultation_fee = $3, avg_consultation_minutes = $4, avg_daily_break_minutes = $5 WHERE id = $6 AND hospital_id = $7 RETURNING *`,
      [req.body.name, Number(req.body.dailyTokenLimit) || 50, Number(req.body.consultationFee) || 0, Number(req.body.avgConsultationMinutes) || 12, Number(req.body.avgDailyBreakMinutes) || 120, req.params.doctorId, req.params.hospitalId]
    );
    if (!doctor.rows[0]) throw new Error('Doctor not found.');
    await client.query(
      `UPDATE users SET name = $1 WHERE doctor_id = $2`,
      [req.body.name, req.params.doctorId]
    );
    res.json({ doctor: doctor.rows[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/hospitals/:hospitalId/doctors/:doctorId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const doctor = await client.query(
      `DELETE FROM doctors WHERE id = $1 AND hospital_id = $2 RETURNING *`,
      [req.params.doctorId, req.params.hospitalId]
    );
    if (!doctor.rows[0]) throw new Error('Doctor not found.');
    await client.query(`DELETE FROM users WHERE doctor_id = $1`, [req.params.doctorId]);
    await client.query('COMMIT');
    res.json({ message: 'Doctor deleted.' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.patch('/api/hospitals/:hospitalId/labs/:labId', async (req, res) => {
  const client = await pool.connect();
  try {
    const lab = await client.query(
      `UPDATE labs SET name = $1, capacity = $2, daily_token_limit = $3 WHERE id = $4 AND hospital_id = $5 RETURNING *`,
      [req.body.name, Math.max(1, Number(req.body.capacity) || 1), Number(req.body.dailyTokenLimit) || 100, req.params.labId, req.params.hospitalId]
    );
    if (!lab.rows[0]) throw new Error('Lab not found.');
    await client.query(
      `UPDATE users SET name = $1 WHERE lab_id = $2`,
      [req.body.name, req.params.labId]
    );
    res.json({ lab: lab.rows[0] });
  } catch (error) {
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/hospitals/:hospitalId/labs/:labId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lab = await client.query(
      `DELETE FROM labs WHERE id = $1 AND hospital_id = $2 RETURNING *`,
      [req.params.labId, req.params.hospitalId]
    );
    if (!lab.rows[0]) throw new Error('Lab not found.');
    await client.query(`DELETE FROM users WHERE lab_id = $1`, [req.params.labId]);
    await client.query('COMMIT');
    res.json({ message: 'Lab deleted.' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.delete('/api/tokens/:tokenId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = await client.query(
      `DELETE FROM tokens WHERE id = $1 AND patient_user_id = $2 AND status IN ('waiting_doctor', 'waiting_lab') RETURNING *`,
      [req.params.tokenId, req.body.userId]
    );
    if (!token.rows[0]) throw new Error('Active token not found or cannot be deleted.');
    await client.query('COMMIT');
    res.json({ message: 'Token deleted.' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/tokens', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const patient = await client.query("SELECT * FROM users WHERE id = $1 AND role = 'patient'", [req.body.userId]);
    if (!patient.rows[0]) throw new Error('Patient login required.');

    const requestedDate = req.body.tokenDate ? new Date(req.body.tokenDate) : new Date();
    if (Number.isNaN(requestedDate.getTime())) throw new Error('Invalid token date.');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 30);
    const tokenDate = new Date(requestedDate);
    tokenDate.setHours(0, 0, 0, 0);
    if (tokenDate < today || tokenDate > maxDate) {
      throw new Error('Token date must be today or within the next 30 days.');
    }
    const tokenDateString = tokenDate.toISOString().split('T')[0];

    let target;
    let status;
    let limit;
    let count;
    let hospitalId;
    let doctorId = null;
    let labId = null;
    let priority = 0;
    let prescribedLab = false;

    if (req.body.destination === 'doctor') {
      const existingDoctorActive = await client.query(
        `SELECT 1 FROM tokens
          WHERE patient_user_id = $1
            AND token_date = $2
            AND status IN ('waiting_doctor', 'in_doctor')
          LIMIT 1`,
        [patient.rows[0].id, tokenDateString]
      );
      if (existingDoctorActive.rows[0]) throw new Error('Patient already has an active doctor appointment for that date.');
      target = await client.query('SELECT * FROM doctors WHERE id = $1', [req.body.doctorId]);
      if (!target.rows[0]) throw new Error('Doctor must be selected.');
      hospitalId = target.rows[0].hospital_id;
      doctorId = target.rows[0].id;
      status = 'waiting_doctor';
      limit = target.rows[0].daily_token_limit;
      count = await client.query(
        `SELECT COUNT(*)::int AS count FROM tokens
          WHERE doctor_id = $1 AND token_date = $2`,
        [doctorId, tokenDateString]
      );
    } else if (req.body.destination === 'lab') {
      const existingLabActive = await client.query(
        `SELECT 1 FROM tokens
          WHERE patient_user_id = $1
            AND token_date = $2
            AND status IN ('waiting_lab', 'in_lab')
          LIMIT 1`,
        [patient.rows[0].id, tokenDateString]
      );
      if (existingLabActive.rows[0]) throw new Error('Patient already has an active lab appointment for that date.');

      target = await client.query('SELECT * FROM labs WHERE id = $1', [req.body.labId]);
      if (!target.rows[0]) throw new Error('Lab must be selected.');
      hospitalId = target.rows[0].hospital_id;
      labId = target.rows[0].id;
      status = 'waiting_lab';
      priority = LAB_PRIORITY.self;
      prescribedLab = Boolean(req.body.prescribedLab);
      limit = target.rows[0].daily_token_limit;
      count = await client.query(
        `SELECT COUNT(*)::int AS count FROM tokens
          WHERE lab_id = $1 AND token_date = $2`,
        [labId, tokenDateString]
      );
    } else {
      throw new Error('Choose doctor or lab queue.');
    }

    if (count.rows[0].count >= limit) {
      throw new Error('Daily token limit reached for this queue.');
    }

    const tokenNumber = count.rows[0].count + 1;
    const token = await client.query(
      `INSERT INTO tokens (
        token_number, patient_user_id, patient_name, hospital_id, doctor_id, lab_id,
        status, prescribed_lab, priority, token_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        tokenNumber,
        patient.rows[0].id,
        patient.rows[0].name,
        hospitalId,
        doctorId,
        labId,
        status,
        prescribedLab,
        priority,
        tokenDateString
      ]
    );

    const wait = status === 'waiting_lab'
      ? await estimateLabWait(client, labId)
      : await estimateDoctorWait(client, doctorId);

    await client.query('COMMIT');
    res.json({ token: token.rows[0], estimatedWaitMinutes: wait });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/doctors/:doctorId/next', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const doctor = await client.query('SELECT * FROM doctors WHERE id = $1 FOR UPDATE', [req.params.doctorId]);
    if (!doctor.rows[0]) throw new Error('Doctor not found.');
    if (doctor.rows[0].on_break) throw new Error('Doctor is on break.');

    const active = await client.query(
      "SELECT * FROM tokens WHERE doctor_id = $1 AND status = 'in_doctor'",
      [req.params.doctorId]
    );
    if (active.rows[0]) throw new Error('Finish current patient first.');

    const next = await client.query(
      `SELECT * FROM tokens
        WHERE doctor_id = $1 AND status = 'waiting_doctor'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [req.params.doctorId]
    );
    if (!next.rows[0]) throw new Error('No patients in queue.');

    const current = await client.query(
      "UPDATE tokens SET status = 'in_doctor', started_at = NOW() WHERE id = $1 RETURNING *",
      [next.rows[0].id]
    );
    await client.query(
      "INSERT INTO activity_logs (actor_role, actor_id, token_id, action) VALUES ('doctor', $1, $2, 'next_patient')",
      [req.params.doctorId, current.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ current: current.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/doctors/:doctorId/send-lab', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const doctor = await client.query('SELECT * FROM doctors WHERE id = $1', [req.params.doctorId]);
    if (!doctor.rows[0]) throw new Error('Doctor not found.');
    const lab = req.body.labId
      ? await client.query('SELECT * FROM labs WHERE id = $1 AND hospital_id = $2', [req.body.labId, doctor.rows[0].hospital_id])
      : await client.query('SELECT * FROM labs WHERE hospital_id = $1 ORDER BY id LIMIT 1', [doctor.rows[0].hospital_id]);
    if (!lab.rows[0]) throw new Error('No lab available for this hospital.');

    const token = await client.query(
      `UPDATE tokens
          SET status = 'waiting_lab', lab_id = $1, prescribed_lab = TRUE, priority = $2, started_at = NULL
        WHERE doctor_id = $3 AND status = 'in_doctor'
        RETURNING *`,
      [lab.rows[0].id, LAB_PRIORITY.doctorReferral, req.params.doctorId]
    );
    if (!token.rows[0]) throw new Error('No current patient to send to lab.');
    await client.query(
      "INSERT INTO activity_logs (actor_role, actor_id, token_id, action) VALUES ('doctor', $1, $2, 'send_to_lab')",
      [req.params.doctorId, token.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ token: token.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/doctors/:doctorId/finish', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = await client.query(
      `UPDATE tokens
          SET status = 'finished', finished_at = NOW()
        WHERE doctor_id = $1 AND status = 'in_doctor'
        RETURNING *, GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int) AS duration_minutes`,
      [req.params.doctorId]
    );
    if (!token.rows[0]) throw new Error('No current patient to finish.');
    await client.query(
      `INSERT INTO activity_logs (actor_role, actor_id, token_id, action, duration_minutes)
       VALUES ('doctor', $1, $2, 'finish_patient', $3)`,
      [req.params.doctorId, token.rows[0].id, token.rows[0].duration_minutes]
    );
    await client.query('COMMIT');
    res.json({ finished: token.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/doctors/:doctorId/break', async (req, res) => {
  try {
    const doctor = await getDoctor(req.params.doctorId);
    if (!doctor) return res.status(404).json({ error: 'Doctor not found.' });

    if (doctor.on_break) {
      const result = await query(
        `UPDATE doctors SET on_break = FALSE, break_started_at = NULL
          WHERE id = $1
          RETURNING GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - $2::timestamptz)) / 60)::int) AS duration_minutes`,
        [req.params.doctorId, doctor.break_started_at]
      );
      await query(
        "INSERT INTO activity_logs (actor_role, actor_id, action, duration_minutes) VALUES ('doctor', $1, 'break_end', $2)",
        [req.params.doctorId, result.rows[0].duration_minutes]
      );
      res.json({ message: 'Break ended.', durationMinutes: result.rows[0].duration_minutes });
    } else {
      await query('UPDATE doctors SET on_break = TRUE, break_started_at = NOW() WHERE id = $1', [req.params.doctorId]);
      await query("INSERT INTO activity_logs (actor_role, actor_id, action) VALUES ('doctor', $1, 'break_start')", [req.params.doctorId]);
      res.json({ message: 'Break started.' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/labs/:labId/start', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lab = await client.query('SELECT * FROM labs WHERE id = $1', [req.params.labId]);
    if (!lab.rows[0]) throw new Error('Lab not found.');

    const active = await client.query(
      "SELECT COUNT(*)::int AS count FROM tokens WHERE lab_id = $1 AND status = 'in_lab'",
      [req.params.labId]
    );
    if (active.rows[0].count >= lab.rows[0].capacity) throw new Error('Lab capacity is full.');

    const next = await client.query(
      `SELECT * FROM tokens
        WHERE lab_id = $1 AND status = 'waiting_lab'
        ORDER BY GREATEST(1, priority - FLOOR(EXTRACT(EPOCH FROM NOW() - created_at) / 300)), created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [req.params.labId]
    );
    if (!next.rows[0]) throw new Error('No patients in lab queue.');

    const current = await client.query(
      "UPDATE tokens SET status = 'in_lab', started_at = NOW() WHERE id = $1 RETURNING *",
      [next.rows[0].id]
    );
    await client.query(
      "INSERT INTO activity_logs (actor_role, actor_id, token_id, action) VALUES ('lab', $1, $2, 'next_patient')",
      [req.params.labId, current.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ current: current.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/labs/:labId/finish', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const token = await client.query(
      `UPDATE tokens
          SET status = CASE WHEN doctor_id IS NULL THEN 'finished' ELSE 'waiting_doctor' END,
              finished_at = CASE WHEN doctor_id IS NULL THEN NOW() ELSE NULL END,
              started_at = NULL
        WHERE lab_id = $1 AND id = $2 AND status = 'in_lab'
        RETURNING *, GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int) AS duration_minutes`,
      [req.params.labId, req.body.patientId]
    );
    if (!token.rows[0]) throw new Error('No active lab patient found.');
    await client.query(
      `INSERT INTO activity_logs (actor_role, actor_id, token_id, action, duration_minutes)
       VALUES ('lab', $1, $2, 'finish_patient', $3)`,
      [req.params.labId, token.rows[0].id, token.rows[0].duration_minutes]
    );
    await client.query('COMMIT');
    res.json({ finished: token.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/status', async (req, res) => {
  try {
    res.json(await getStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/database', async (req, res) => {
  try {
    const [users, hospitals, doctors, labs, tokens, logs] = await Promise.all([
      query('SELECT id, role, name, username, hospital_id, doctor_id, lab_id, travel_minutes, created_at FROM users ORDER BY id'),
      query('SELECT * FROM hospitals ORDER BY id'),
      query('SELECT * FROM doctors ORDER BY id'),
      query('SELECT * FROM labs ORDER BY id'),
      query('SELECT * FROM tokens ORDER BY id DESC LIMIT 200'),
      query('SELECT * FROM activity_logs ORDER BY id DESC LIMIT 200')
    ]);
    res.json({
      users: users.rows,
      hospitals: hospitals.rows,
      doctors: doctors.rows,
      labs: labs.rows,
      tokens: tokens.rows,
      activityLogs: logs.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 4000;

createSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Queue management server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize PostgreSQL schema:', error.message);
    process.exit(1);
  });
