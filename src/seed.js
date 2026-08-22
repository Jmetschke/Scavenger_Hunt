const { getClient } = require('./db');

async function seedChallenges() {
  const client = getClient();
  const huntResult = await client.execute('SELECT COUNT(*) as count FROM hunts');
  const huntTotal = Number(huntResult.rows?.[0]?.count || 0);

  if (huntTotal === 0) {
    await client.execute({
      sql: 'INSERT INTO hunts (name, description, active) VALUES (?, ?, ?)',
      args: ["Bristol Ren Faire EO 26'", 'Initial festival scavenger hunt for the first event.', 1],
    });
  }

  const result = await client.execute('SELECT COUNT(*) as count FROM challenges');
  const total = Number(result.rows?.[0]?.count || 0);

  if (total > 0) {
    return;
  }

  const defaultHunt = await client.execute({
    sql: 'SELECT id FROM hunts ORDER BY id ASC LIMIT 1',
  });
  const defaultHuntId = Number(defaultHunt.rows?.[0]?.id || 1);

  const seedRows = [
    ['Find Someone Wearing a Cowboy Hat', 'Take a picture showing your find.', 5, 1, 1],
    ['Weirdest Festival Food', 'Capture the most unusual snack or treat you find.', 10, 2, 1],
    ['Group Photo at the Main Stage', 'Get your crew together for a stage-side group shot.', 10, 3, 1],
    ['Find Something Neon', 'Track down something bright, glowing, or extra colorful.', 5, 4, 1],
    ['Best Festival Outfit', 'Snap the most memorable outfit or look in the crowd.', 15, 5, 1],
  ];

  for (const [title, description, points, sortOrder, active] of seedRows) {
    await client.execute({
      sql: `INSERT INTO challenges (title, description, points, sort_order, active, hunt_id) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [title, description, points, sortOrder, active, defaultHuntId],
    });
  }
}

module.exports = {
  seedChallenges,
};
