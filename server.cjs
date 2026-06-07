const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS foster_youth (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE NOT NULL,
        case_number VARCHAR(50) UNIQUE NOT NULL,
        current_placement VARCHAR(200),
        placement_type VARCHAR(100),
        case_worker_id INTEGER,
        entry_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        emergency_contact VARCHAR(200),
        medical_info TEXT,
        education_status VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_workers (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        employee_id VARCHAR(50) UNIQUE NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(150),
        department VARCHAR(100),
        supervisor VARCHAR(200),
        caseload_capacity INTEGER DEFAULT 20,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS placements (
        id SERIAL PRIMARY KEY,
        youth_id INTEGER REFERENCES foster_youth(id),
        placement_name VARCHAR(200) NOT NULL,
        placement_address TEXT,
        placement_type VARCHAR(100),
        start_date DATE NOT NULL,
        end_date DATE,
        placement_status VARCHAR(50) DEFAULT 'active',
        placement_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_activities (
        id SERIAL PRIMARY KEY,
        youth_id INTEGER REFERENCES foster_youth(id),
        case_worker_id INTEGER REFERENCES case_workers(id),
        activity_type VARCHAR(100) NOT NULL,
        activity_date DATE NOT NULL,
        description TEXT NOT NULL,
        outcome VARCHAR(200),
        follow_up_required BOOLEAN DEFAULT false,
        follow_up_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        relationship VARCHAR(100),
        phone VARCHAR(20),
        email VARCHAR(150),
        address TEXT,
        contact_type VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

// Foster Youth CRUD Operations
app.get('/api/foster-youth', async (req, res) => {
  try {
    const { status, case_worker_id, placement_type } = req.query;
    let query = `
      SELECT fy.*, cw.first_name as worker_first_name, cw.last_name as worker_last_name 
      FROM foster_youth fy 
      LEFT JOIN case_workers cw ON fy.case_worker_id = cw.id 
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND fy.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (case_worker_id) {
      query += ` AND fy.case_worker_id = $${paramIndex}`;
      params.push(case_worker_id);
      paramIndex++;
    }

    if (placement_type) {
      query += ` AND fy.placement_type = $${paramIndex}`;
      params.push(placement_type);
      paramIndex++;
    }

    query += ' ORDER BY fy.last_name, fy.first_name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching foster youth:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/foster-youth/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT fy.*, cw.first_name as worker_first_name, cw.last_name as worker_last_name 
      FROM foster_youth fy 
      LEFT JOIN case_workers cw ON fy.case_worker_id = cw.id 
      WHERE fy.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Foster youth not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching foster youth:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/foster-youth', async (req, res) => {
  try {
    const {
      first_name, last_name, date_of_birth, case_number, current_placement,
      placement_type, case_worker_id, entry_date, emergency_contact,
      medical_info, education_status, notes
    } = req.body;

    const notesWithTag = notes ? `[IGM-GOVERNED] ${notes}` : '[IGM-GOVERNED] Case created';

    const result = await pool.query(`
      INSERT INTO foster_youth (
        first_name, last_name, date_of_birth, case_number, current_placement,
        placement_type, case_worker_id, entry_date, emergency_contact,
        medical_info, education_status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      first_name, last_name, date_of_birth, case_number, current_placement,
      placement_type, case_worker_id, entry_date, emergency_contact,
      medical_info, education_status, notesWithTag
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating foster youth:', err);
    if (err.code === '23505') {
      res.status(400).json({ error: 'Case number already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.put('/api/foster-youth/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name, last_name, date_of_birth, case_number, current_placement,
      placement_type, case_worker_id, status, emergency_contact,
      medical_info, education_status, notes
    } = req.body;

    const notesWithTag = notes ? `[IGM-GOVERNED] ${notes}` : null;

    const result = await pool.query(`
      UPDATE foster_youth SET
        first_name = $1, last_name = $2, date_of_birth = $3, case_number = $4,
        current_placement = $5, placement_type = $6, case_worker_id = $7,
        status = $8, emergency_contact = $9, medical_info = $10,
        education_status = $11, notes = $12, updated_at = CURRENT_TIMESTAMP
      WHERE id = $13
      RETURNING *
    `, [
      first_name, last_name, date_of_birth, case_number, current_placement,
      placement_type, case_worker_id, status, emergency_contact,
      medical_info, education_status, notesWithTag, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Foster youth not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating foster youth:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/foster-youth/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM foster_youth WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Foster youth not found' });
    }

    res.json({ message: 'Foster youth deleted successfully' });
  } catch (err) {
    console.error('Error deleting foster youth:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Case Workers CRUD Operations
app.get('/api/case-workers', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cw.*, 
             COUNT(fy.id) as current_caseload
      FROM case_workers cw
      LEFT JOIN foster_youth fy ON cw.id = fy.case_worker_id AND fy.status = 'active'
      GROUP BY cw.id
      ORDER BY cw.last_name, cw.first_name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching case workers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/case-workers', async (req, res) => {
  try {
    const {
      first_name, last_name, employee_id, phone, email,
      department, supervisor, caseload_capacity
    } = req.body;

    const result = await pool.query(`
      INSERT INTO case_workers (
        first_name, last_name, employee_id, phone, email,
        department, supervisor, caseload_capacity
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [first_name, last_name, employee_id, phone, email, department, supervisor, caseload_capacity]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating case worker:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Placements CRUD Operations
app.get('/api/placements', async (req, res) => {
  try {
    const { youth_id } = req.query;
    let query = `
      SELECT p.*, fy.first_name, fy.last_name, fy.case_number
      FROM placements p
      JOIN foster_youth fy ON p.youth_id = fy.id
      WHERE 1=1
    `;
    const params = [];

    if (youth_id) {
      query += ' AND p.youth_id = $1';
      params.push(youth_id);
    }

    query += ' ORDER BY p.start_date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching placements:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/placements', async (req, res) => {
  try {
    const {
      youth_id, placement_name, placement_address, placement_type,
      start_date, placement_notes
    } = req.body;

    const notesWithTag = placement_notes ? `[IGM-GOVERNED] ${placement_notes}` : '[IGM-GOVERNED] Placement created';

    const result = await pool.query(`
      INSERT INTO placements (
        youth_id, placement_name, placement_address, placement_type,
        start_date, placement_notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [youth_id, placement_name, placement_address, placement_type, start_date, notesWithTag]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating placement:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Case Activities CRUD Operations
app.get('/api/activities', async (req, res) => {
  try {
    const { youth_id, case_worker_id, activity_type } = req.query;
    let query = `
      SELECT ca.*, 
             fy.first_name as youth_first_name, fy.last_name as youth_last_name,
             cw.first_name as worker_first_name, cw.last_name as worker_last_name
      FROM case_activities ca
      JOIN foster_youth fy ON ca.youth_id = fy.id
      LEFT JOIN case_workers cw ON ca.case_worker_id = cw.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (youth_id) {
      query += ` AND ca.youth_id = $${paramIndex}`;
      params.push(youth_id);
      paramIndex++;
    }

    if (case_worker_id) {
      query += ` AND ca.case_worker_id = $${paramIndex}`;
      params.push(case_worker_id);
      paramIndex++;
    }

    if (activity_type) {
      query += ` AND ca.activity_type = $${paramIndex}`;
      params.push(activity_type);
      paramIndex++;
    }

    query += ' ORDER BY ca.activity_date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching activities:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/activities', async (req, res) => {
  try {
    const {
      youth_id, case_worker_id, activity_type, activity_date,
      description, outcome, follow_up_required, follow_up_date, notes
    } = req.body;

    const notesWithTag = notes ? `[IGM-GOVERNED] ${notes}` : '[IGM-GOVERNED] Activity logged';

    const result = await pool.query(`
      INSERT INTO case_activities (
        youth_id, case_worker_id, activity_type, activity_date,
        description, outcome, follow_up_required, follow_up_date, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      youth_id, case_worker_id, activity_type, activity_date,
      description, outcome, follow_up_required, follow_up_date, notesWithTag
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating activity:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Contacts endpoint
app.post('/api/contacts', async (req, res) => {
  try {
    const { name, relationship, phone, email, address, contact_type, notes } = req.body;

    const notesWithTag = notes ? `[IGM-GOVERNED] ${notes}` : '[IGM-GOVERNED] Contact added';

    const result = await pool.query(`
      INSERT INTO contacts (name, relationship, phone, email, address, contact_type, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [name, relationship, phone, email, address, contact_type, notesWithTag]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating contact:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contacts ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Statistics endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const totalYouthResult = await pool.query('SELECT COUNT(*) as total FROM foster_youth WHERE status = $1', ['active']);
    const placementTypesResult = await pool.query(`
      SELECT placement_type, COUNT(*) as count 
      FROM foster_youth 
      WHERE status = 'active' AND placement_type IS NOT NULL 
      GROUP BY placement_type
    `);
    const caseWorkerLoadsResult = await pool.query(`
      SELECT cw.id, cw.first_name, cw.last_name, cw.caseload_capacity,
             COUNT(fy.id) as current_caseload
      FROM case_workers cw
      LEFT JOIN foster_youth fy ON cw.id = fy.case_worker_id AND fy.status = 'active'
      GROUP BY cw.id, cw.first_name, cw.last_name, cw.caseload_capacity
      ORDER BY current_caseload DESC
    `);
    const activitiesResult = await pool.query(`
      SELECT activity_type, COUNT(*) as count
      FROM case_activities
      WHERE activity_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY activity_type
      ORDER BY count DESC
    `);

    const stats = {
      total_active_youth: parseInt(totalYouthResult.rows[0].total),
      placement_types: placementTypesResult.rows,
      case_worker_loads: caseWorkerLoadsResult.rows,
      recent_activities: activitiesResult.rows
    };

    res.json(stats);
  } catch (err) {
    console.error('Error fetching statistics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.json([]);
    }

    const searchQuery = `%${query.toLowerCase()}%`;
    const result = await pool.query(`
      SELECT 
        id, 
        first_name, 
        last_name, 
        case_number,
        'foster_youth' as type
      FROM foster_youth 
      WHERE 
        LOWER(first_name) LIKE $1