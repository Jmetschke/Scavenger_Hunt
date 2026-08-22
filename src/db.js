const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const defaultLocalDbUrl = `file:${path.join(process.cwd(), 'data', 'scavenger.db')}`;
const remoteDbUrl = process.env.TURSO_DATABASE_URL || '';
const remoteAuthToken = process.env.TURSO_AUTH_TOKEN || undefined;

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
    if (remoteDbUrl && remoteAuthToken) {
      try {
        client = createRemoteClient();
        databaseDetails.url = remoteDbUrl;
        databaseDetails.source = 'turso';
      } catch (error) {
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
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const huntColumns = await client.execute('PRAGMA table_info(hunts)');
    if (huntColumns.rows.length && !huntColumns.rows.some((row) => row.name === 'default_points')) {
      await client.execute('ALTER TABLE hunts ADD COLUMN default_points INTEGER NOT NULL DEFAULT 5');
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

    await client.execute(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        setting_key TEXT NOT NULL UNIQUE,
        setting_value TEXT
      )
    `);

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
