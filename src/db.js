const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const defaultLocalDbPath = path.join(process.cwd(), 'data', 'scavenger.db');
const dbUrl = process.env.TURSO_DATABASE_URL || `file:${defaultLocalDbPath}`;
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

let client = null;

let databaseReady = false;
let databaseDetails = {
  url: dbUrl,
  ready: false,
};

function ensureLocalDataFile() {
  if (!dbUrl.startsWith('file:')) {
    return;
  }

  const relativePath = dbUrl.replace(/^file:/, '');
  const absolutePath = relativePath.startsWith('/') ? relativePath : path.join(process.cwd(), relativePath);
  const directory = path.dirname(absolutePath);

  if (directory && directory !== '.') {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function getClient() {
  if (!client) {
    ensureLocalDataFile();
    client = createClient({ url: dbUrl, authToken });
  }
  return client;
}

async function initDatabase() {
  try {
    const activeClient = getClient();
    ensureLocalDataFile();
    await activeClient.execute('SELECT 1');
    databaseReady = true;
    databaseDetails.ready = true;

    const { seedChallenges } = require('./seed');

    await activeClient.execute(`
      CREATE TABLE IF NOT EXISTS challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        points INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        challenge_id INTEGER NOT NULL,
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
