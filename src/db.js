const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const defaultLocalDbUrl = `file:${path.join(process.cwd(), 'data', 'scavenger.db')}`;
const remoteDbUrl = process.env.TURSO_DATABASE_URL || '';
const remoteAuthToken = process.env.TURSO_AUTH_TOKEN || undefined;
const requiresRemoteDatabase = process.env.NODE_ENV === 'production' || Boolean(remoteDbUrl);

let client = null;
let databaseReady = false;
let databaseDetails = {
  url: remoteDbUrl || defaultLocalDbUrl,
  ready: false,
  source: remoteDbUrl ? 'turso' : 'local',
};

function ensureLocalDataFile(dbUrl) {
  if (!dbUrl || !dbUrl.startsWith('file:')) {
    return;
  }

  const relativePath = dbUrl.replace(/^file:/, '');
  const absolutePath = relativePath.startsWith('/') ? relativePath : path.join(process.cwd(), relativePath);
  const directory = path.dirname(absolutePath);

  if (directory && directory !== '.') {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function createLocalClient() {
  ensureLocalDataFile(defaultLocalDbUrl);
  return createClient({ url: defaultLocalDbUrl });
}

function createRemoteClient() {
  if (!remoteDbUrl) {
    return createLocalClient();
  }

  return createClient({ url: remoteDbUrl, authToken: remoteAuthToken });
}

function getClient() {
  if (!client) {
    if (requiresRemoteDatabase && (!remoteDbUrl || !remoteAuthToken)) {
      throw new Error('Production requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Local SQLite fallback is disabled.');
    }

    if (remoteDbUrl && remoteAuthToken) {
      try {
        client = createRemoteClient();
        databaseDetails.url = remoteDbUrl;
        databaseDetails.source = 'turso';
      } catch (error) {
        if (requiresRemoteDatabase) {
          throw new Error(`Turso connection failed in production: ${error.message || error}`);
        }
        console.warn('Turso client creation failed. Falling back to local SQLite database.', error.message || error);
        client = createLocalClient();
        databaseDetails.url = defaultLocalDbUrl;
        databaseDetails.source = 'local';
      }
    } else {
      client = createLocalClient();
      databaseDetails.url = defaultLocalDbUrl;
      databaseDetails.source = 'local';
    }
  }

  return client;
}

async function initDatabase() {
  try {
    const activeClient = getClient();
    ensureLocalDataFile(databaseDetails.url);

    try {
      await activeClient.execute('SELECT 1');
    } catch (error) {
      if (databaseDetails.source === 'turso') {
        if (requiresRemoteDatabase) {
          throw new Error(`Turso database check failed in production: ${error.message || error}`);
        }
        console.warn('Turso database check failed. Falling back to local SQLite database.', error.message || error);
        client = createLocalClient();
        databaseDetails.url = defaultLocalDbUrl;
        databaseDetails.source = 'local';
        await client.execute('SELECT 1');
      } else {
        throw error;
      }
    }

    databaseReady = true;
    databaseDetails.ready = true;
    databaseDetails.error = undefined;

    const { seedChallenges } = require('./seed');

    await client.execute(`
      CREATE TABLE IF NOT EXISTS hunts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        default_points INTEGER NOT NULL DEFAULT 5,
        passcode_hash TEXT,
        access_link TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const huntColumns = await client.execute('PRAGMA table_info(hunts)');
    if (huntColumns.rows.length && !huntColumns.rows.some((row) => row.name === 'default_points')) {
      await client.execute('ALTER TABLE hunts ADD COLUMN default_points INTEGER NOT NULL DEFAULT 5');
    }
    if (huntColumns.rows.length && !huntColumns.rows.some((row) => row.name === 'passcode_hash')) {
      await client.execute('ALTER TABLE hunts ADD COLUMN passcode_hash TEXT');
    }
    if (huntColumns.rows.length && !huntColumns.rows.some((row) => row.name === 'access_link')) {
      await client.execute('ALTER TABLE hunts ADD COLUMN access_link TEXT');
    }

    await client.execute(`
      CREATE TABLE IF NOT EXISTS challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        points INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        hunt_id INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const challengeColumns = await client.execute('PRAGMA table_info(challenges)');
    if (challengeColumns.rows.length && !challengeColumns.rows.some((row) => row.name === 'hunt_id')) {
      await client.execute('ALTER TABLE challenges ADD COLUMN hunt_id INTEGER NOT NULL DEFAULT 1');
    }

    await client.execute(`
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge_id INTEGER NOT NULL,
        hunt_id INTEGER NOT NULL DEFAULT 1,
        team_name TEXT NOT NULL,
        image_url TEXT NOT NULL,
        cloudinary_public_id TEXT NOT NULL,
        caption TEXT,
        comment TEXT,
        submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        approved INTEGER NOT NULL DEFAULT 0,
        points_awarded INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(challenge_id) REFERENCES challenges(id)
      )
    `);

    const submissionColumns = await client.execute('PRAGMA table_info(submissions)');
    if (submissionColumns.rows.length && !submissionColumns.rows.some((row) => row.name === 'hunt_id')) {
      await client.execute('ALTER TABLE submissions ADD COLUMN hunt_id INTEGER NOT NULL DEFAULT 1');
    }
    if (submissionColumns.rows.length && !submissionColumns.rows.some((row) => row.name === 'comment')) {
      await client.execute('ALTER TABLE submissions ADD COLUMN comment TEXT');
    }

    await client.execute(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT NOT NULL UNIQUE,
        setting_value TEXT
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS event_teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hunt_id INTEGER NOT NULL,
        team_name TEXT NOT NULL,
        team_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(hunt_id, team_key),
        FOREIGN KEY(hunt_id) REFERENCES hunts(id)
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS team_challenge_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_team_id INTEGER NOT NULL,
        challenge_id INTEGER NOT NULL,
        points_awarded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_team_id, challenge_id),
        FOREIGN KEY(event_team_id) REFERENCES event_teams(id),
        FOREIGN KEY(challenge_id) REFERENCES challenges(id)
      )
    `);

    await client.execute('CREATE INDEX IF NOT EXISTS idx_event_teams_hunt_id ON event_teams(hunt_id)');
    await client.execute('CREATE INDEX IF NOT EXISTS idx_team_challenge_scores_event_team_id ON team_challenge_scores(event_team_id)');

    const existingTeams = await client.execute(`
      SELECT DISTINCT hunt_id, team_name FROM submissions
      WHERE team_name IS NOT NULL AND TRIM(team_name) != ''
    `);
    for (const row of existingTeams.rows) {
      const teamName = String(row.team_name).trim();
      const teamKey = teamName.toLowerCase();
      await client.execute({
        sql: 'INSERT OR IGNORE INTO event_teams (hunt_id, team_name, team_key) VALUES (?, ?, ?)',
        args: [Number(row.hunt_id), teamName, teamKey],
      });
    }

    const existingScores = await client.execute(`
      SELECT s.hunt_id, s.team_name, s.challenge_id, c.points
      FROM submissions s
      JOIN challenges c ON c.id = s.challenge_id AND c.hunt_id = s.hunt_id
      WHERE s.approved = 1
      GROUP BY s.hunt_id, LOWER(TRIM(s.team_name)), s.challenge_id
    `);
    for (const row of existingScores.rows) {
      const teamName = String(row.team_name).trim();
      const teamKey = teamName.toLowerCase();
      const team = await client.execute({
        sql: 'SELECT id FROM event_teams WHERE hunt_id = ? AND team_key = ?',
        args: [Number(row.hunt_id), teamKey],
      });
      if (team.rows.length) {
        await client.execute({
          sql: 'INSERT OR IGNORE INTO team_challenge_scores (event_team_id, challenge_id, points_awarded) VALUES (?, ?, ?)',
          args: [Number(team.rows[0].id), Number(row.challenge_id), Number(row.points)],
        });
      }
    }

    await seedChallenges();
    console.log('Database initialization complete.');
  } catch (error) {
    console.error('Database initialization error:', error.message || error);
    databaseReady = false;
    databaseDetails.ready = false;
    databaseDetails.error = error.message || 'Database unavailable';
    throw error;
  }
}

function getDatabaseStatus() {
  return {
    ...databaseDetails,
    ready: databaseReady,
  };
}

module.exports = {
  client: () => getClient(),
  getClient,
  initDatabase,
  getDatabaseStatus,
};
