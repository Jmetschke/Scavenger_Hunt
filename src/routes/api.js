const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { getClient, getDatabaseStatus } = require('../db');
const { hasCloudinaryConfig, uploadImageToCloudinary, deleteCloudinaryImage } = require('../cloudinary');
const { optimizeImage } = require('../image-processing');
const { createChallengeTemplate, parseChallengeTemplate } = require('../challenge-template');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, or WebP images are supported. HEIC and HEIF photos are not supported on this server.'));
    }
    cb(null, true);
  },
});

const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
});

function handleUpload(fieldName) {
  const middleware = upload.single(fieldName);
  return (req, res, next) => middleware(req, res, (error) => {
    if (error) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Image is too large. Please choose a photo under 25MB.'
        : error.message || 'The selected image could not be uploaded.';
      return res.status(400).json({ error: message });
    }
    return next();
  });
}

function sanitizeText(value, maxLength = 200) {
  if (value === null || value === undefined) {
    return '';
  }

  const cleaned = String(value).trim().slice(0, maxLength);
  return cleaned.replace(/[<>]/g, '');
}

function sanitizeAccessLink(value) {
  const link = sanitizeText(value, 500);
  if (!link) return '';

  try {
    const url = new URL(link);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch (error) {
    return '';
  }
}

function parseBoolean(value) {
  if (value === true || value === 'true' || value === 'on' || value === 1 || value === '1') {
    return true;
  }
  return false;
}

function hashHuntPasscode(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function getHuntPasscode(req) {
  return req.get('x-hunt-passcode') || req.query.passcode || req.body?.passcode || '';
}

async function requireHuntAccess(req, res, huntId) {
  const client = getClient();
  const result = await client.execute({
    sql: 'SELECT passcode_hash FROM hunts WHERE id = ? AND active = 1',
    args: [huntId],
  });
  if (!result.rows.length) {
    res.status(404).json({ error: 'Scavenger hunt not found.' });
    return false;
  }
  const expected = result.rows[0].passcode_hash;
  if (expected && hashHuntPasscode(getHuntPasscode(req)) !== expected) {
    res.status(401).json({ error: 'This event requires a passcode.', requiresPasscode: true });
    return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  return next();
}

function getRequestedHuntId(req) {
  const value = req.query.hunt_id || req.query.huntId || req.body?.hunt_id || req.body?.huntId;
  if (value === undefined || value === '') return null;
  const huntId = Number(value);
  return Number.isInteger(huntId) && huntId > 0 ? huntId : null;
}

async function getDefaultHuntId() {
  const client = getClient();
  const result = await client.execute('SELECT id FROM hunts WHERE active = 1 ORDER BY id ASC LIMIT 1');
  return result.rows.length ? Number(result.rows[0].id) : null;
}

function mapHunt(row) {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    default_points: Number(row.default_points || 5),
    requires_passcode: Boolean(row.passcode_hash),
    access_link: row.access_link || '',
    welcome_image_url: row.welcome_image_url || '',
    active: Number(row.active) === 1,
    created_at: row.created_at,
  };
}

function normalizeTeamName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getTeamKey(teamName) {
  return normalizeTeamName(teamName).toLowerCase();
}

async function ensureEventTeam(client, huntId, teamName) {
  const displayName = String(teamName || '').trim() || 'Anonymous Team';
  const teamKey = getTeamKey(displayName);
  await client.execute({
    sql: 'INSERT OR IGNORE INTO event_teams (hunt_id, team_name, team_key) VALUES (?, ?, ?)',
    args: [huntId, displayName, teamKey],
  });
  const result = await client.execute({
    sql: 'SELECT id, hunt_id, team_name, team_key FROM event_teams WHERE hunt_id = ? AND team_key = ?',
    args: [huntId, teamKey],
  });
  return result.rows[0];
}

async function syncTeamChallengeScore(client, huntId, challengeId, teamKey) {
  const team = await client.execute({
    sql: 'SELECT id FROM event_teams WHERE hunt_id = ? AND team_key = ?',
    args: [huntId, teamKey],
  });
  if (!team.rows.length) return;

  const submissions = await client.execute({
    sql: 'SELECT team_name, approved FROM submissions WHERE hunt_id = ? AND challenge_id = ?',
    args: [huntId, challengeId],
  });
  const approvedCount = submissions.rows.filter((row) => Number(row.approved) === 1 && getTeamKey(row.team_name) === teamKey).length;
  const eventTeamId = Number(team.rows[0].id);
  if (approvedCount > 0) {
    const challenge = await client.execute({
      sql: 'SELECT points FROM challenges WHERE id = ? AND hunt_id = ?',
      args: [challengeId, huntId],
    });
    if (challenge.rows.length) {
      await client.execute({
        sql: 'INSERT OR IGNORE INTO team_challenge_scores (event_team_id, challenge_id, points_awarded) VALUES (?, ?, ?)',
        args: [eventTeamId, challengeId, Number(challenge.rows[0].points || 0)],
      });
    }
  } else {
    await client.execute({
      sql: 'DELETE FROM team_challenge_scores WHERE event_team_id = ? AND challenge_id = ?',
      args: [eventTeamId, challengeId],
    });
  }
}

function createApiRouter() {
  const router = express.Router();

  router.get('/api/hunts', async (req, res) => {
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `SELECT * FROM hunts ${req.query.include_inactive === 'true' ? '' : 'WHERE active = 1'} ORDER BY active DESC, id ASC`,
      });
      return res.json(result.rows.map(mapHunt));
    } catch (error) {
      console.error('Hunt fetch failed:', error);
      return res.status(500).json({ error: 'Failed to load scavenger hunts.' });
    }
  });

  router.get('/api/hunts/:huntId/teams/score', async (req, res) => {
    const huntId = Number(req.params.huntId);
    const teamName = normalizeTeamName(req.query.team_name || req.query.teamName);
    if (!Number.isInteger(huntId) || huntId <= 0 || !teamName) {
      return res.status(400).json({ error: 'A valid hunt and team name are required.' });
    }
    if (!await requireHuntAccess(req, res, huntId)) return;

    try {
      const client = getClient();
      const team = await client.execute({
        sql: 'SELECT id, team_name FROM event_teams WHERE hunt_id = ? AND team_key = ?',
        args: [huntId, getTeamKey(teamName)],
      });
      if (!team.rows.length) {
        return res.json({ eventId: huntId, teamName, totalPoints: 0, completedChallenges: 0 });
      }
      const score = await client.execute({
        sql: 'SELECT COALESCE(SUM(points_awarded), 0) AS total_points, COUNT(*) AS completed_challenges FROM team_challenge_scores WHERE event_team_id = ?',
        args: [Number(team.rows[0].id)],
      });
      return res.json({
        eventId: huntId,
        teamName: team.rows[0].team_name,
        totalPoints: Number(score.rows[0].total_points || 0),
        completedChallenges: Number(score.rows[0].completed_challenges || 0),
      });
    } catch (error) {
      console.error('Team score fetch failed:', error);
      return res.status(500).json({ error: 'Failed to load team score.' });
    }
  });

  router.get('/api/hunts/:huntId/submissions', async (req, res) => {
    const huntId = Number(req.params.huntId);
    if (!Number.isInteger(huntId) || huntId <= 0) {
      return res.status(400).json({ error: 'Invalid hunt ID.' });
    }
    if (!await requireHuntAccess(req, res, huntId)) return;

    try {
      const client = getClient();
      const hunt = await client.execute({
        sql: 'SELECT id, name FROM hunts WHERE id = ? AND active = 1',
        args: [huntId],
      });
      if (!hunt.rows.length) {
        return res.status(404).json({ error: 'Scavenger hunt not found.' });
      }

      const result = await client.execute({
        sql: `
          SELECT s.id, s.team_name, s.image_url, s.caption, s.comment, s.submitted_at,
            s.approved, c.title AS challenge_title, c.sort_order
          FROM submissions s
          JOIN challenges c ON c.id = s.challenge_id AND c.hunt_id = s.hunt_id
          WHERE s.hunt_id = ?
          ORDER BY s.submitted_at DESC, s.id DESC
        `,
        args: [huntId],
      });

      return res.json({
        hunt: { id: Number(hunt.rows[0].id), name: hunt.rows[0].name },
        submissions: result.rows.map((row) => ({
          id: Number(row.id),
          team_name: row.team_name,
          image_url: row.image_url,
          caption: row.caption,
          comment: row.comment,
          submitted_at: row.submitted_at,
          approved: Number(row.approved) === 1,
          challenge_title: row.challenge_title,
          sort_order: Number(row.sort_order || 0),
        })),
      });
    } catch (error) {
      console.error('Event gallery fetch failed:', error);
      return res.status(500).json({ error: 'Failed to load event gallery.' });
    }
  });

  router.post('/api/hunts', requireAdmin, handleUpload('welcome_image'), async (req, res) => {
    const name = sanitizeText(req.body.name, 120);
    const description = sanitizeText(req.body.description, 500);
    const active = parseBoolean(req.body.active !== undefined ? req.body.active : true);
    const defaultPoints = Number(req.body.default_points ?? 5);
    const passcode = sanitizeText(req.body.passcode, 120);
    const accessLink = sanitizeAccessLink(req.body.access_link);

    if (!name) return res.status(400).json({ error: 'Hunt name is required.' });
    if (!Number.isInteger(defaultPoints) || defaultPoints < 0) {
      return res.status(400).json({ error: 'Default points must be a whole number of zero or greater.' });
    }
    if (req.body.access_link && !accessLink) {
      return res.status(400).json({ error: 'Access link must be a valid HTTP or HTTPS URL.' });
    }

    let welcomeImage = null;
    try {
      const client = getClient();
      if (req.file) {
        if (!hasCloudinaryConfig()) {
          return res.status(503).json({ error: 'Welcome image upload is not configured. Set Cloudinary variables in the environment.' });
        }
        let optimizedImage;
        try {
          optimizedImage = await optimizeImage(req.file.buffer);
        } catch (processingError) {
          return res.status(400).json({ error: processingError.message || 'The welcome image could not be processed.' });
        }
        welcomeImage = await uploadImageToCloudinary(optimizedImage, req.file.originalname, 'festival-scavenger-hunt/welcome');
      }
      const result = await client.execute({
        sql: 'INSERT INTO hunts (name, description, default_points, passcode_hash, access_link, welcome_image_url, welcome_image_public_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [name, description, defaultPoints, passcode ? hashHuntPasscode(passcode) : null, accessLink || null, welcomeImage?.image_url || null, welcomeImage?.cloudinary_public_id || null, active ? 1 : 0],
      });
      return res.status(201).json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (error) {
      if (welcomeImage?.cloudinary_public_id) {
        try {
          await deleteCloudinaryImage(welcomeImage.cloudinary_public_id);
        } catch (cleanupError) {
          console.error('Failed cleaning up welcome image after hunt creation failure:', cleanupError.message || cleanupError);
        }
      }
      if (req.file) console.error('Welcome image upload failed:', error);
      console.error('Hunt creation failed:', error);
      return res.status(500).json({ error: 'Could not create scavenger hunt.' });
    }
  });

  router.post('/api/hunts/:id/clone', requireAdmin, async (req, res) => {
    const sourceHuntId = Number(req.params.id);
    if (!Number.isInteger(sourceHuntId) || sourceHuntId <= 0) {
      return res.status(400).json({ error: 'Invalid hunt ID.' });
    }

    try {
      const client = getClient();
      const source = await client.execute({
        sql: 'SELECT name, description, default_points FROM hunts WHERE id = ?',
        args: [sourceHuntId],
      });
      if (!source.rows.length) return res.status(404).json({ error: 'Scavenger hunt not found.' });

      const sourceRow = source.rows[0];
      const cloneName = sanitizeText(req.body.name, 120) || `${sourceRow.name} Copy`;
      const challenges = await client.execute({
        sql: 'SELECT title, description, points, sort_order, active FROM challenges WHERE hunt_id = ? ORDER BY sort_order ASC, id ASC',
        args: [sourceHuntId],
      });

      await client.execute('BEGIN');
      try {
        const clone = await client.execute({
          sql: 'INSERT INTO hunts (name, description, default_points, active) VALUES (?, ?, ?, 0)',
          args: [cloneName, sourceRow.description || '', Number(sourceRow.default_points || 5)],
        });
        const cloneId = Number(clone.lastInsertRowid);
        for (const challenge of challenges.rows) {
          await client.execute({
            sql: 'INSERT INTO challenges (title, description, points, sort_order, active, hunt_id) VALUES (?, ?, ?, ?, ?, ?)',
            args: [challenge.title, challenge.description || '', Number(challenge.points || 0), Number(challenge.sort_order || 0), Number(challenge.active) === 1 ? 1 : 0, cloneId],
          });
        }
        await client.execute('COMMIT');
        return res.status(201).json({ success: true, id: cloneId, imported: challenges.rows.length, message: 'Hunt cloned successfully.' });
      } catch (error) {
        await client.execute('ROLLBACK');
        throw error;
      }
    } catch (error) {
      console.error('Hunt clone failed:', error);
      return res.status(500).json({ error: 'Could not clone scavenger hunt.' });
    }
  });

  router.put('/api/hunts/:id', requireAdmin, handleUpload('welcome_image'), async (req, res) => {
    const huntId = Number(req.params.id);
    const name = sanitizeText(req.body.name, 120);
    const description = sanitizeText(req.body.description, 500);
    const active = parseBoolean(req.body.active !== undefined ? req.body.active : true);
    const defaultPoints = Number(req.body.default_points ?? 5);
    const passcode = sanitizeText(req.body.passcode, 120);
    const accessLink = sanitizeAccessLink(req.body.access_link);
    const clearPasscode = req.body.clear_passcode === true || req.body.clear_passcode === 'true';
    const clearWelcomeImage = parseBoolean(req.body.clear_welcome_image);

    if (!Number.isInteger(huntId) || huntId <= 0 || !name) {
      return res.status(400).json({ error: 'A valid hunt ID and name are required.' });
    }
    if (!Number.isInteger(defaultPoints) || defaultPoints < 0) {
      return res.status(400).json({ error: 'Default points must be a whole number of zero or greater.' });
    }
    if (req.body.access_link && !accessLink) {
      return res.status(400).json({ error: 'Access link must be a valid HTTP or HTTPS URL.' });
    }

    let welcomeImage = null;
    let welcomeImageSaved = false;
    try {
      const client = getClient();
      const existing = await client.execute({
        sql: 'SELECT welcome_image_public_id FROM hunts WHERE id = ?',
        args: [huntId],
      });
      if (!existing.rows.length) return res.status(404).json({ error: 'Scavenger hunt not found.' });

      if (req.file) {
        if (!hasCloudinaryConfig()) {
          return res.status(503).json({ error: 'Welcome image upload is not configured. Set Cloudinary variables in the environment.' });
        }
        let optimizedImage;
        try {
          optimizedImage = await optimizeImage(req.file.buffer);
        } catch (processingError) {
          return res.status(400).json({ error: processingError.message || 'The welcome image could not be processed.' });
        }
        welcomeImage = await uploadImageToCloudinary(optimizedImage, req.file.originalname, 'festival-scavenger-hunt/welcome');
      }
      const imageUpdate = welcomeImage
        ? 'welcome_image_url = ?, welcome_image_public_id = ?'
        : clearWelcomeImage ? 'welcome_image_url = NULL, welcome_image_public_id = NULL' : '';
      await client.execute({
        sql: `UPDATE hunts SET name = ?, description = ?, default_points = ?, access_link = ?, active = ?${passcode || clearPasscode ? ', passcode_hash = ?' : ''} WHERE id = ?`,
        args: passcode || clearPasscode
          ? [name, description, defaultPoints, accessLink || null, active ? 1 : 0, passcode ? hashHuntPasscode(passcode) : null, huntId]
          : [name, description, defaultPoints, accessLink || null, active ? 1 : 0, huntId],
      });
      if (imageUpdate) {
        const imageArgs = welcomeImage
          ? [welcomeImage.image_url, welcomeImage.cloudinary_public_id, huntId]
          : [huntId];
        await client.execute({
          sql: `UPDATE hunts SET ${imageUpdate} WHERE id = ?`,
          args: imageArgs,
        });
        welcomeImageSaved = true;
        if (welcomeImage && existing.rows[0].welcome_image_public_id) {
          try {
            await deleteCloudinaryImage(existing.rows[0].welcome_image_public_id);
          } catch (cleanupError) {
            console.error('Failed deleting previous welcome image:', cleanupError.message || cleanupError);
          }
        }
      }
      return res.json({ success: true });
    } catch (error) {
      if (!welcomeImageSaved && welcomeImage?.cloudinary_public_id) {
        try {
          await deleteCloudinaryImage(welcomeImage.cloudinary_public_id);
        } catch (cleanupError) {
          console.error('Failed cleaning up welcome image after hunt update failure:', cleanupError.message || cleanupError);
        }
      }
      console.error('Hunt update failed:', error);
      return res.status(500).json({ error: 'Could not update scavenger hunt.' });
    }
  });

  router.delete('/api/hunts/:id', requireAdmin, async (req, res) => {
    const huntId = Number(req.params.id);
    if (!Number.isInteger(huntId) || huntId <= 0) {
      return res.status(400).json({ error: 'Invalid hunt ID.' });
    }

    try {
      const client = getClient();
      const result = await client.execute({
        sql: 'SELECT COUNT(*) AS count FROM challenges WHERE hunt_id = ?',
        args: [huntId],
      });
      if (Number(result.rows[0].count || 0) > 0) {
        return res.status(409).json({ error: 'Delete this hunt\'s challenges before deleting the hunt.' });
      }
      await client.execute({ sql: 'DELETE FROM hunts WHERE id = ?', args: [huntId] });
      return res.json({ success: true });
    } catch (error) {
      console.error('Hunt delete failed:', error);
      return res.status(500).json({ error: 'Could not delete scavenger hunt.' });
    }
  });

  router.get('/api/challenges', async (req, res) => {
    const status = getDatabaseStatus();
    if (!status.ready) {
      return res.status(503).json({ error: 'Database is unavailable. Please try again later.' });
    }

    const huntId = getRequestedHuntId(req) || await getDefaultHuntId();
    if (!await requireHuntAccess(req, res, huntId)) return;
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT c.*, (
            SELECT COUNT(*) FROM submissions s WHERE s.challenge_id = c.id
          ) as submission_count
          FROM challenges c
          WHERE c.active = 1 AND c.hunt_id = ?
          ORDER BY c.sort_order ASC, c.id ASC
        `,
        args: [huntId],
      });

      const challenges = result.rows.map((row) => ({
        id: Number(row.id),
        hunt_id: Number(row.hunt_id),
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
      const huntId = getRequestedHuntId(req);
      if (huntId && !await requireHuntAccess(req, res, huntId)) return;
      const challenge = await client.execute({
        sql: 'SELECT * FROM challenges WHERE id = ? AND (? IS NULL OR hunt_id = ?)',
        args: [challengeId, huntId, huntId],
      });

      if (!challenge.rows.length) {
        return res.status(404).json({ error: 'Challenge not found.' });
      }

      const challengeHuntId = Number(challenge.rows[0].hunt_id);
      if (!await requireHuntAccess(req, res, challengeHuntId)) return;

      const submissions = await client.execute({
        sql: 'SELECT * FROM submissions WHERE challenge_id = ? AND (? IS NULL OR hunt_id = ?) ORDER BY submitted_at DESC',
        args: [challengeId, huntId, huntId],
      });

      return res.json({
        challenge: {
          id: Number(challenge.rows[0].id),
          hunt_id: Number(challenge.rows[0].hunt_id),
          title: challenge.rows[0].title,
          description: challenge.rows[0].description,
        },
        submissions: submissions.rows.map((row) => ({
          id: Number(row.id),
          team_name: row.team_name,
          image_url: row.image_url,
          cloudinary_public_id: row.cloudinary_public_id,
          caption: row.caption,
          comment: row.comment,
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

  router.post('/api/submissions', handleUpload('image'), async (req, res) => {
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

      const challengeId = Number(req.body.challenge_id || req.body.challengeId);
      if (!Number.isInteger(challengeId) || challengeId <= 0) {
        return res.status(400).json({ error: 'Invalid challenge selection.' });
      }

      const client = getClient();
      const challengeExists = await client.execute({
        sql: 'SELECT id, hunt_id FROM challenges WHERE id = ?',
        args: [challengeId],
      });

      if (!challengeExists.rows.length) {
        return res.status(404).json({ error: 'Challenge not found.' });
      }

      const huntId = getRequestedHuntId(req) || Number(challengeExists.rows[0].hunt_id);
      if (getRequestedHuntId(req) && huntId !== Number(challengeExists.rows[0].hunt_id)) {
        return res.status(400).json({ error: 'The selected challenge does not belong to this hunt.' });
      }
      if (!await requireHuntAccess(req, res, huntId)) return;

      const teamName = sanitizeText(req.body.team_name || req.body.teamName, 80) || 'Anonymous Team';
      const caption = sanitizeText(req.body.caption, 240);
      const comment = sanitizeText(req.body.comment, 500);

      let uploadInfo = null;
      if (!hasCloudinaryConfig()) {
        return res.status(503).json({ error: 'Image upload is not configured yet. Set Cloudinary variables in the environment.' });
      }

      try {
        let optimizedImage;
        try {
          optimizedImage = await optimizeImage(req.file.buffer);
        } catch (processingError) {
          return res.status(400).json({ error: processingError.message || 'The selected image could not be processed.' });
        }
        uploadInfo = await uploadImageToCloudinary(optimizedImage, req.file.originalname, 'festival-scavenger-hunt');
      } catch (uploadError) {
        console.error('Cloudinary upload failed:', uploadError);
        return res.status(500).json({ error: 'Image upload failed. Please try again.' });
      }

      const submittedAt = new Date().toISOString();

      try {
        const result = await client.execute({
          sql: `
            INSERT INTO submissions (challenge_id, hunt_id, team_name, image_url, cloudinary_public_id, caption, comment, submitted_at, approved, points_awarded)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
          `,
          args: [challengeId, huntId, teamName, uploadInfo.image_url, uploadInfo.cloudinary_public_id, caption, comment, submittedAt],
        });
        await ensureEventTeam(client, huntId, teamName);

        return res.status(201).json({
          success: true,
          message: 'Submission uploaded successfully.',
          submission: {
            id: Number(result.lastInsertRowid || 0),
            challenge_id: challengeId,
            team_name: teamName,
            image_url: uploadInfo.image_url,
            caption,
            comment,
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
    const huntId = getRequestedHuntId(req) || await getDefaultHuntId();
    if (!await requireHuntAccess(req, res, huntId)) return;
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT et.team_name, COALESCE(SUM(tcs.points_awarded), 0) AS total_points, COUNT(tcs.id) AS completed_challenges
          FROM event_teams et
          LEFT JOIN team_challenge_scores tcs ON tcs.event_team_id = et.id
          WHERE et.hunt_id = ?
          GROUP BY et.id, et.team_name
          ORDER BY total_points DESC, et.team_name ASC
        `,
        args: [huntId],
      });

      const leaderboard = result.rows.map((row, index) => ({
        rank: index + 1,
        team_name: row.team_name,
        total_points: Number(row.total_points || 0),
        completed_challenges: Number(row.completed_challenges || 0),
      }));

      return res.json(leaderboard);
    } catch (error) {
      console.error('Leaderboard failed:', error);
      return res.status(500).json({ error: 'Failed to load leaderboard.', message: error.message });
    }
  });

  router.get('/api/admin/challenges', requireAdmin, async (req, res) => {
    const huntId = getRequestedHuntId(req);
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT c.*, (SELECT COUNT(*) FROM submissions s WHERE s.challenge_id = c.id) as submission_count
          FROM challenges c
          WHERE (? IS NULL OR c.hunt_id = ?)
          ORDER BY c.sort_order ASC, c.id ASC
        `,
        args: [huntId, huntId],
      });

      return res.json(result.rows.map((row) => ({
        id: Number(row.id),
        hunt_id: Number(row.hunt_id),
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

  router.get('/api/admin/hunts/:huntId/challenges/template', requireAdmin, async (req, res) => {
    const huntId = Number(req.params.huntId);
    if (!Number.isInteger(huntId) || huntId <= 0) return res.status(400).json({ error: 'Invalid hunt ID.' });

    try {
      const client = getClient();
      const result = await client.execute({
        sql: 'SELECT title, description, points, sort_order, active FROM challenges WHERE hunt_id = ? ORDER BY sort_order ASC, id ASC',
        args: [huntId],
      });
      const csv = createChallengeTemplate(result.rows);
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="hunt-${huntId}-challenges-template.csv"`,
      });
      return res.send(csv);
    } catch (error) {
      console.error('Challenge template download failed:', error);
      return res.status(500).json({ error: 'Unable to download the challenge template.' });
    }
  });

  router.post('/api/admin/hunts/:huntId/challenges/import', requireAdmin, (req, res, next) => {
    templateUpload.single('template')(req, res, (error) => {
      if (error) {
        const message = error.code === 'LIMIT_FILE_SIZE'
          ? 'The challenge template must be under 1MB.'
          : error.message || 'The challenge template could not be uploaded.';
        return res.status(400).json({ error: message });
      }
      return next();
    });
  }, async (req, res) => {
    const huntId = Number(req.params.huntId);
    if (!Number.isInteger(huntId) || huntId <= 0) return res.status(400).json({ error: 'Invalid hunt ID.' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a CSV challenge template.' });

    try {
      const rows = parseChallengeTemplate(req.file.buffer.toString('utf8'));
      if (!rows.length) return res.status(400).json({ error: 'The challenge template does not contain any challenge rows.' });
      const client = getClient();
      const hunt = await client.execute({ sql: 'SELECT id FROM hunts WHERE id = ?', args: [huntId] });
      if (!hunt.rows.length) return res.status(404).json({ error: 'Scavenger hunt not found.' });

      await client.execute('BEGIN');
      try {
        for (const row of rows) {
          const nextSortOrder = row.sort_order || Number((await client.execute({
            sql: 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order FROM challenges WHERE hunt_id = ?',
            args: [huntId],
          })).rows[0].next_sort_order);
          if (row.sort_order !== null) {
            await client.execute({
              sql: 'UPDATE challenges SET sort_order = sort_order + 1 WHERE hunt_id = ? AND sort_order >= ?',
              args: [huntId, nextSortOrder],
            });
          }
          await client.execute({
            sql: 'INSERT INTO challenges (title, description, points, sort_order, active, hunt_id) VALUES (?, ?, ?, ?, ?, ?)',
            args: [row.title, row.description, row.points, nextSortOrder, row.active ? 1 : 0, huntId],
          });
        }
        await client.execute('COMMIT');
      } catch (error) {
        await client.execute('ROLLBACK');
        throw error;
      }
      return res.status(201).json({ success: true, imported: rows.length, message: `${rows.length} challenges imported.` });
    } catch (error) {
      console.error('Challenge template import failed:', error);
      return res.status(400).json({ error: error.message || 'Unable to import the challenge template.' });
    }
  });

  router.get('/api/admin/submissions', requireAdmin, async (req, res) => {
    const huntId = getRequestedHuntId(req);
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT s.*, c.title AS challenge_title
          FROM submissions s
          LEFT JOIN challenges c ON c.id = s.challenge_id
          WHERE (? IS NULL OR s.hunt_id = ?)
          ORDER BY s.submitted_at DESC
        `,
        args: [huntId, huntId],
      });

      return res.json(result.rows.map((row) => ({
        id: Number(row.id),
        challenge_id: Number(row.challenge_id),
        hunt_id: Number(row.hunt_id),
        challenge_title: row.challenge_title || 'Unknown challenge',
        team_name: row.team_name,
        image_url: row.image_url,
        cloudinary_public_id: row.cloudinary_public_id,
        caption: row.caption,
        comment: row.comment,
        submitted_at: row.submitted_at,
        approved: Number(row.approved) === 1,
        points_awarded: Number(row.points_awarded || 0),
      })));
    } catch (error) {
      console.error('Admin submission fetch failed:', error);
      return res.status(500).json({ error: 'Unable to load submissions.' });
    }
  });

  router.get('/api/admin/teams', requireAdmin, async (req, res) => {
    const huntId = getRequestedHuntId(req);
    try {
      const client = getClient();
      const result = await client.execute({
        sql: `
          SELECT et.team_name,
            COALESCE(SUM(tcs.points_awarded), 0) AS total_points,
            COUNT(tcs.id) AS completed_challenges
          FROM event_teams et
          LEFT JOIN team_challenge_scores tcs ON tcs.event_team_id = et.id
          WHERE (? IS NULL OR et.hunt_id = ?)
          GROUP BY et.id, et.team_name
          ORDER BY total_points DESC, et.team_name ASC
        `,
        args: [huntId, huntId],
      });
      return res.json(result.rows.map((row) => ({
        team_name: row.team_name,
        total_points: Number(row.total_points || 0),
        completed_challenges: Number(row.completed_challenges || 0),
      })));
    } catch (error) {
      console.error('Admin team scores failed:', error);
      return res.status(500).json({ error: 'Unable to load team scores.' });
    }
  });

  router.post('/api/challenges', requireAdmin, async (req, res) => {
    const title = sanitizeText(req.body.title, 120);
    const description = sanitizeText(req.body.description, 500);
    const hasPoints = req.body.points !== undefined && req.body.points !== null && String(req.body.points).trim() !== '';
    const points = hasPoints ? Number(req.body.points) : null;
    const hasSortOrder = req.body.sort_order !== undefined && req.body.sort_order !== null && String(req.body.sort_order).trim() !== '';
    const sortOrder = hasSortOrder ? Number(req.body.sort_order) : null;
    const active = parseBoolean(req.body.active !== undefined ? req.body.active : true);
    const huntId = getRequestedHuntId(req);

    if (!title) {
      return res.status(400).json({ error: 'Challenge title is required.' });
    }

    if (!huntId) {
      return res.status(400).json({ error: 'A valid hunt is required.' });
    }

    if (hasPoints && (!Number.isFinite(points) || points < 0)) {
      return res.status(400).json({ error: 'Points must be a non-negative number.' });
    }

    if (hasSortOrder && (!Number.isInteger(sortOrder) || sortOrder < 1)) {
      return res.status(400).json({ error: 'Sort order must be a positive whole number.' });
    }

    try {
      const client = getClient();
      const hunt = await client.execute({ sql: 'SELECT id, default_points FROM hunts WHERE id = ?', args: [huntId] });
      if (!hunt.rows.length) return res.status(404).json({ error: 'Scavenger hunt not found.' });
      const challengePoints = hasPoints ? points : Number(hunt.rows[0].default_points || 0);
      const nextSortOrder = hasSortOrder ? sortOrder : Number((await client.execute({
        sql: 'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort_order FROM challenges WHERE hunt_id = ? AND active = 1',
        args: [huntId],
      })).rows[0].next_sort_order);
      if (hasSortOrder) {
        await client.execute({
          sql: 'UPDATE challenges SET sort_order = sort_order + 1 WHERE hunt_id = ? AND sort_order >= ?',
          args: [huntId, nextSortOrder],
        });
      }
      const result = await client.execute({
        sql: `
          INSERT INTO challenges (title, description, points, sort_order, active, hunt_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [title, description, challengePoints, nextSortOrder, active ? 1 : 0, huntId],
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
    const huntId = getRequestedHuntId(req);

    if (!Number.isInteger(challengeId) || challengeId <= 0) {
      return res.status(400).json({ error: 'Invalid challenge ID.' });
    }

    if (!title) {
      return res.status(400).json({ error: 'Challenge title is required.' });
    }

    if (!Number.isFinite(points) || points < 0) {
      return res.status(400).json({ error: 'Points must be a non-negative number.' });
    }

    if (!Number.isInteger(sortOrder) || sortOrder < 1) {
      return res.status(400).json({ error: 'Sort order must be a positive whole number.' });
    }

    try {
      const client = getClient();
      const existing = await client.execute({
        sql: 'SELECT hunt_id, sort_order FROM challenges WHERE id = ?',
        args: [challengeId],
      });
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Challenge not found.' });
      }

      const previousHuntId = Number(existing.rows[0].hunt_id);
      const previousSortOrder = Number(existing.rows[0].sort_order);
      const targetHuntId = huntId || previousHuntId;

      if (targetHuntId === previousHuntId) {
        if (sortOrder < previousSortOrder) {
          await client.execute({
            sql: 'UPDATE challenges SET sort_order = sort_order + 1 WHERE hunt_id = ? AND sort_order >= ? AND sort_order < ? AND id != ?',
            args: [targetHuntId, sortOrder, previousSortOrder, challengeId],
          });
        } else if (sortOrder > previousSortOrder) {
          await client.execute({
            sql: 'UPDATE challenges SET sort_order = sort_order - 1 WHERE hunt_id = ? AND sort_order > ? AND sort_order <= ? AND id != ?',
            args: [targetHuntId, previousSortOrder, sortOrder, challengeId],
          });
        }
      } else {
        await client.execute({
          sql: 'UPDATE challenges SET sort_order = sort_order - 1 WHERE hunt_id = ? AND sort_order > ? AND id != ?',
          args: [previousHuntId, previousSortOrder, challengeId],
        });
        await client.execute({
          sql: 'UPDATE challenges SET sort_order = sort_order + 1 WHERE hunt_id = ? AND sort_order >= ?',
          args: [targetHuntId, sortOrder],
        });
      }

      await client.execute({
        sql: `
          UPDATE challenges
          SET title = ?, description = ?, points = ?, sort_order = ?, active = ?, hunt_id = COALESCE(?, hunt_id)
          WHERE id = ?
        `,
        args: [title, description, points, sortOrder, active ? 1 : 0, huntId, challengeId],
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
        sql: 'DELETE FROM team_challenge_scores WHERE challenge_id = ?',
        args: [challengeId],
      });
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
    const hasPoints = req.body.points_awarded !== undefined;
    const pointsAwarded = hasPoints ? Number(req.body.points_awarded) : null;

    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Invalid submission ID.' });
    }

    if (hasPoints && (!Number.isFinite(pointsAwarded) || pointsAwarded < 0)) {
      return res.status(400).json({ error: 'Points awarded must be zero or greater.' });
    }

    try {
      const client = getClient();
      const submission = await client.execute({
        sql: 'SELECT hunt_id, challenge_id, team_name FROM submissions WHERE id = ?',
        args: [submissionId],
      });
      if (!submission.rows.length) {
        return res.status(404).json({ error: 'Submission not found.' });
      }

      await client.execute({
        sql: `UPDATE submissions SET approved = ?, points_awarded = COALESCE(?, points_awarded) WHERE id = ?`,
        args: [approved ? 1 : 0, pointsAwarded, submissionId],
      });
      await syncTeamChallengeScore(
        client,
        Number(submission.rows[0].hunt_id),
        Number(submission.rows[0].challenge_id),
        getTeamKey(submission.rows[0].team_name)
      );

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
        sql: 'SELECT cloudinary_public_id, hunt_id, challenge_id, team_name FROM submissions WHERE id = ?',
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
      await syncTeamChallengeScore(
        client,
        Number(submission.rows[0].hunt_id),
        Number(submission.rows[0].challenge_id),
        getTeamKey(submission.rows[0].team_name)
      );

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
