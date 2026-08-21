const { getClient } = require('./db');

async function seedChallenges() {
  const client = getClient();
  const result = await client.execute('SELECT COUNT(*) as count FROM challenges');
  const total = Number(result.rows?.[0]?.count || 0);

  if (total > 0) {
    return;
  }

  const seedRows = [
    ['Find Someone Wearing a Cowboy Hat', 'Take a picture showing your find.', 5, 1, 1],
    ['Weirdest Festival Food', 'Capture the most unusual snack or treat you find.', 10, 2, 1],
    ['Group Photo at the Main Stage', 'Get your crew together for a stage-side group shot.', 10, 3, 1],
    ['Find Something Neon', 'Track down something bright, glowing, or extra colorful.', 5, 4, 1],
    ['Best Festival Outfit', 'Snap the most memorable outfit or look in the crowd.', 15, 5, 1],
  ];

  for (const [title, description, points, sortOrder, active] of seedRows) {
    await client.execute({
      sql: `INSERT INTO challenges (title, description, points, sort_order, active) VALUES (?, ?, ?, ?, ?)`,
      args: [title, description, points, sortOrder, active],
    });
  }
}

module.exports = {
  seedChallenges,
};
