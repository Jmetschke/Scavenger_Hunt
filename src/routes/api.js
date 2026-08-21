const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { getClient, getDatabaseStatus } = require('../db');
const { hasCloudinaryConfig, uploadImageToCloudinary, deleteCloudinaryImage } = require('../cloudinary');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WebP, HEIC, or HEIF images are allowed.'));
    }
    cb(null, true);
  },
});

function sanitizeText(value, maxLength = 200) {
  if (value === null || value === undefined) {
    return '';
  }

  const cleaned = String(value).trim().slice(0, maxLength);
  return cleaned.replace(/[<>]/g, '');
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  return false;
}

function getAdminToken() {
  const password = process.env.ADMIN_PASSWORD || '';
  return crypto.createHash('sha256').update(password).digest('hex');
}

function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.admin_token;
  const expected = getAdminToken();

  if (!expected || !token || token !== expected) {
    return res.status(401).json({ error: 'Admin access required.' });
  }

  return next();
}

async function getChallengeList() {
  const client = getClient();
  const challengeRows = await client.execute({
    sql: `
      SELECT c.*, (
        SELECT COUNT(*) FROM submissions s WHERE s.challenge_id = c.id
      ) as submission_count
      FROM challenges c
      WHERE c.active = 1
      ORDER BY c.sort_order ASC, c.id ASC
    `,
  });

  return challengeRows.rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    description: row.description,
    points: Number(row.points),
    sort_order: Number(row.sort_order),
    active: Number(row.active) === 1,
    created_at: row.created_at,
    submission_count: Number(row.submission_count || 0),
  }));
}

async function getSubmissionRowsForChallenge(challengeId) {
  const client = getClient();
  const submissions = await client.execute({
    sql: `
      SELECT * FROM submissions WHERE challenge_id = ? ORDER BY submitted_at DESC
    `,
    args: [challengeId],
  });

  return submissions.rows.map((row) => ({
    id: Number(row.id),
    challenge_id: Number(row.challenge_id),
    team_name: row.team_name,
    image_url: row.image_url,
    cloudinary_public_id: row.cloudinary_public_id,
    caption: row.caption,
    submitted_at: row.submitted_at,
    approved: Number(row.approved) === 1,
    points_awarded: Number(row.points_awarded || 0),
  }));
}

function createApiRouter() {
  const router = express.Router();

  router.get('/api/challenges', async (req, res) => {
    const status = getDatabaseStatus();
    if (!status.ready) {
      return res.status(503).json({ error: 'Database is unavailable. Please try again later.' });
    }

    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT c.*, (
            SELECT COUNT(*) FROM submissions s WHERE s.challenge_id = c.id
          ) as submission_count
          FROM challenges c
          WHERE c.active = 1
          ORDER BY c.sort_order ASC, c.id ASC
        `,
      });

      const challenges = result.rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        description: row.description,
        points: Number(row.points),
        sort_order: Number(row.sort_order),
        active: Number(row.active) === 1,
        created_at: row.created_at,
        submission_count: Number(row.submission_count || 0),
      }));

      return res.json(challenges);
    } catch (error) {
      console.error('Challenge fetch failed:', error);
      return res.status(500).json({ error: 'Failed to load challenges.', message: error.message });
    }
  });

  router.get('/api/challenges/:id/submissions', async (req, res) => {
    const challengeId = Number(req.params.id);
    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ error: 'Invalid challenge ID.' });
    }

    try {
      const client = getClient();
      const challenge = await client.execute({
        sql: 'SELECT * FROM challenges WHERE id = ?',
        args: [challengeId],
      });

      if (!challenge.rows.length) {
        return res.status(404).json({ error: 'Challenge not found.' });
      }

      const submissions = await client.execute({
        sql: 'SELECT * FROM submissions WHERE challenge_id = ? ORDER BY submitted_at DESC',
        args: [challengeId],
      });

      return res.json({
        challenge: {
          id: Number(challenge.rows[0].id),
          title: challenge.rows[0].title,
          description: challenge.rows[0].description,
        },
        submissions: submissions.rows.map((row) => ({
          id: Number(row.id),
          team_name: row.team_name,
          image_url: row.image_url,
          cloudinary_public_id: row.cloudinary_public_id,
          caption: row.caption,
          submitted_at: row.submitted_at,
          approved: Number(row.approved) === 1,
          points_awarded: Number(row.points_awarded || 0),
        })),
      });
    } catch (error) {
      console.error('Submission fetch failed:', error);
      return res.status(500).json({ error: 'Failed to load submissions.' });
    }
  });

  router.post('/api/submissions', upload.single('image'), async (req, res) => {
    const status = getDatabaseStatus();
    if (!status.ready) {
      return res.status(503).json({ error: 'Database is unavailable. Please try again later.' });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Please select an image to upload.' });
      }

      if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({ error: 'Invalid image type.' });
      }

      if (req.file.size > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image is too large. Please upload an image under 10MB.' });
      }

      const challengeId = Number(req.body.challenge_id || req.body.challengeId);
      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: 'Invalid challenge selection.' });
      }

      const client = getClient();
      const challengeExists = await client.execute({
        sql: 'SELECT id FROM challenges WHERE id = ?',
        args: [challengeId],
      });

      if (!challengeExists.rows.length) {
        return res.status(404).json({ error: 'Challenge not found.' });
      }

      const teamName = sanitizeText(req.body.team_name || req.body.teamName, 80) || 'Anonymous Team';
      const caption = sanitizeText(req.body.caption, 240);

      let uploadInfo = null;
      if (!hasCloudinaryConfig()) {
        return res.status(503).json({ error: 'Image upload is not configured yet. Set Cloudinary variables in the environment.' });
      }

      try {
        uploadInfo = await uploadImageToCloudinary(req.file.buffer, req.file.originalname, 'festival-scavenger-hunt');
      } catch (uploadError) {
        console.error('Cloudinary upload failed:', uploadError);
        return res.status(500).json({ error: 'Image upload failed. Please try again.', details: uploadError.message });
      }

      const submittedAt = new Date().toISOString();

      try {
        const result = await client.execute({
          sql: `
            INSERT INTO submissions (challenge_id, team_name, image_url, cloudinary_public_id, caption, submitted_at, approved, points_awarded)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0)
          `,
          args: [challengeId, teamName, uploadInfo.image_url, uploadInfo.cloudinary_public_id, caption, submittedAt],
        });

        return res.status(201).json({
          success: true,
          message: 'Submission uploaded successfully.',
          submission: {
            id: Number(result.lastInsertRowid || 0),
            challenge_id: challengeId,
            team_name: teamName,
            image_url: uploadInfo.image_url,
            caption,
            submitted_at: submittedAt,
          },
        });
      } catch (dbError) {
        console.error('Database write failed after Cloudinary upload. Cleaning up image.', dbError);
        try {
          await deleteCloudinaryImage(uploadInfo.cloudinary_public_id);
        } catch (cleanupError) {
          console.error('Cloudinary cleanup failed:', cleanupError);
        }

        return res.status(500).json({
          error: 'Submission could not be saved. The image upload was rolled back.',
          message: dbError.message,
        });
      }
    } catch (error) {
      console.error('Submission create failed:', error);
      return res.status(500).json({ error: 'Failed to submit entry.', message: error.message });
    }
  });

  router.get('/api/leaderboard', async (req, res) => {
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT s.team_name, SUM(CASE WHEN s.approved = 1 THEN COALESCE(s.points_awarded, 0) ELSE 0 END) AS total_points
          FROM submissions s
          GROUP BY s.team_name
          ORDER BY total_points DESC, s.team_name ASC
        `,
      });

      const leaderboard = result.rows.map((row, index) => ({
        rank: index + 1,
        team_name: row.team_name,
        total_points: Number(row.total_points || 0),
      }));

      return res.json(leaderboard);
    } catch (error) {
      console.error('Leaderboard failed:', error);
      return res.status(500).json({ error: 'Failed to load leaderboard.', message: error.message });
    }
  });

  router.post('/api/admin/login', (req, res) => {
    const password = String(req.body.password || '');
    const expected = getAdminToken();

    if (!process.env.ADMIN_PASSWORD) {
      return res.status(503).json({ error: 'Admin password has not been configured.' });
    }

    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Incorrect admin password.' });
    }

    res.cookie('admin_token', expected, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8,
    });

    return res.json({ success: true, message: 'Admin signed in.' });
  });

  router.get('/api/admin/challenges', requireAdmin, async (req, res) => {
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT c.*, (SELECT COUNT(*) FROM submissions s WHERE s.challenge_id = c.id) as submission_count
          FROM challenges c
          ORDER BY c.sort_order ASC, c.id ASC
        `,
      });

      return res.json(result.rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        description: row.description,
        points: Number(row.points),
        sort_order: Number(row.sort_order),
        active: Number(row.active) === 1,
        created_at: row.created_at,
        submission_count: Number(row.submission_count || 0),
      })));
    } catch (error) {
      console.error('Admin challenge fetch failed:', error);
      return res.status(500).json({ error: 'Unable to load challenges.' });
    }
  });

  router.get('/api/admin/submissions', requireAdmin, async (req, res) => {
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT s.*, c.title AS challenge_title
          FROM submissions s
          LEFT JOIN challenges c ON c.id = s.challenge_id
          ORDER BY s.submitted_at DESC
        `,
      });

      return res.json(result.rows.map((row) => ({
        id: Number(row.id),
        challenge_id: Number(row.challenge_id),
        challenge_title: row.challenge_title || 'Unknown challenge',
        team_name: row.team_name,
        image_url: row.image_url,
        cloudinary_public_id: row.cloudinary_public_id,
        caption: row.caption,
        submitted_at: row.submitted_at,
        approved: Number(row.approved) === 1,
        points_awarded: Number(row.points_awarded || 0),
      })));
    } catch (error) {
      console.error('Admin submission fetch failed:', error);
      return res.status(500).json({ error: 'Unable to load submissions.' });
    }
  });

  router.post('/api/challenges', requireAdmin, async (req, res) => {
    const title = sanitizeText(req.body.title, 120);
    const description = sanitizeText(req.body.description, 500);
    const points = Number(req.body.points || 0);
    const sortOrder = Number(req.body.sort_order || 0);
    const active = parseBoolean(req.body.active !== undefined ? req.body.active : true);

    if (!title) {
      return res.status(400).json({ error: 'Challenge title is required.' });
    }

    if (!Number.isFinite(points) || points < 0) {
      return res.status(400).json({ error: 'Points must be a non-negative number.' });
    }

    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          INSERT INTO challenges (title, description, points, sort_order, active)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [title, description, points, sortOrder, active ? 1 : 0],
      });

      return res.status(201).json({ success: true, id: Number(result.lastInsertRowid), message: 'Challenge created.' });
    } catch (error) {
      console.error('Challenge creation failed:', error);
      return res.status(500).json({ error: 'Could not create challenge.' });
    }
  });

  router.put('/api/challenges/:id', requireAdmin, async (req, res) => {
    const challengeId = Number(req.params.id);
    const title = sanitizeText(req.body.title, 120);
    const description = sanitizeText(req.body.description, 500);
    const points = Number(req.body.points || 0);
    const sortOrder = Number(req.body.sort_order || 0);
    const active = parseBoolean(req.body.active !== undefined ? req.body.active : true);

    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ error: 'Invalid challenge ID.' });
    }

    if (!title) {
      return res.status(400).json({ error: 'Challenge title is required.' });
    }

    if (!Number.isFinite(points) || points < 0) {
      return res.status(400).json({ error: 'Points must be a non-negative number.' });
    }

    try {
      const client = getClient();
      await client.execute({
        sql: `
          UPDATE challenges
          SET title = ?, description = ?, points = ?, sort_order = ?, active = ?
          WHERE id = ?
        `,
        args: [title, description, points, sortOrder, active ? 1 : 0, challengeId],
      });

      return res.json({ success: true, message: 'Challenge updated.' });
    } catch (error) {
      console.error('Challenge update failed:', error);
      return res.status(500).json({ error: 'Could not update challenge.' });
    }
  });

  router.delete('/api/challenges/:id', requireAdmin, async (req, res) => {
    const challengeId = Number(req.params.id);
    const force = req.query.force === 'true';

    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ error: 'Invalid challenge ID.' });
    }

    try {
      const client = getClient();
      const submissionCheck = await client.execute({
        sql: 'SELECT COUNT(*) as count FROM submissions WHERE challenge_id = ?',
        args: [challengeId],
      });

      const hasSubmissions = Number(submissionCheck.rows[0].count || 0) > 0;
      if (hasSubmissions && !force) {
        return res.status(409).json({
          error: 'This challenge has submissions. Use the force option to confirm deletion and remove related records.',
          requiresForce: true,
        });
      }

      if (hasSubmissions && force) {
        const submissions = await client.execute({
          sql: 'SELECT cloudinary_public_id FROM submissions WHERE challenge_id = ?',
          args: [challengeId],
        });

        for (const row of submissions.rows) {
          try {
            await deleteCloudinaryImage(row.cloudinary_public_id);
          } catch (error) {
            console.error('Failed deleting challenge submission image in Cloudinary:', error.message || error);
          }
        }

        await client.execute({
          sql: 'DELETE FROM submissions WHERE challenge_id = ?',
          args: [challengeId],
        });
      }

      await client.execute({
        sql: 'DELETE FROM challenges WHERE id = ?',
        args: [challengeId],
      });

      return res.json({ success: true, message: 'Challenge deleted.' });
    } catch (error) {
      console.error('Challenge delete failed:', error);
      return res.status(500).json({ error: 'Could not delete challenge.' });
    }
  });

  router.put('/api/submissions/:id', requireAdmin, async (req, res) => {
    const submissionId = Number(req.params.id);
    const approved = parseBoolean(req.body.approved !== undefined ? req.body.approved : false);
    const pointsAwarded = Number(req.body.points_awarded || 0);

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Invalid submission ID.' });
    }

    if (!Number.isFinite(pointsAwarded) || pointsAwarded < 0) {
      return res.status(400).json({ error: 'Points awarded must be zero or greater.' });
    }

    try {
      const client = getClient();
      await client.execute({
        sql: `UPDATE submissions SET approved = ?, points_awarded = ? WHERE id = ?`,
        args: [approved ? 1 : 0, pointsAwarded, submissionId],
      });

      return res.json({ success: true, message: 'Submission updated.' });
    } catch (error) {
      console.error('Submission update failed:', error);
      return res.status(500).json({ error: 'Could not update submission.' });
    }
  });

  router.delete('/api/submissions/:id', requireAdmin, async (req, res) => {
    const submissionId = Number(req.params.id);

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Invalid submission ID.' });
    }

    try {
      const client = getClient();
      const submission = await client.execute({
        sql: 'SELECT cloudinary_public_id FROM submissions WHERE id = ?',
        args: [submissionId],
      });

      if (!submission.rows.length) {
        return res.status(404).json({ error: 'Submission not found.' });
      }

      const publicId = submission.rows[0].cloudinary_public_id;

      if (publicId) {
        try {
          await deleteCloudinaryImage(publicId);
        } catch (error) {
          console.error('Cloudinary delete error during admin deletion:', error.message || error);
        }
      }

      await client.execute({
        sql: 'DELETE FROM submissions WHERE id = ?',
        args: [submissionId],
      });

      return res.json({ success: true, message: 'Submission deleted.' });
    } catch (error) {
      console.error('Submission delete failed:', error);
      return res.status(500).json({ error: 'Could not delete submission.' });
    }
  });

  return router;
}

module.exports = {
  createApiRouter,
};
