const adminLoginPanel = document.getElementById('admin-login-panel');
const adminDashboard = document.getElementById('admin-dashboard');
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginStatus = document.getElementById('admin-login-status');
const challengeForm = document.getElementById('challenge-form');
const challengesList = document.getElementById('admin-challenges-list');
const submissionsList = document.getElementById('admin-submissions-list');
const challengeIdInput = document.getElementById('challenge-id');
const challengeTitleInput = document.getElementById('challenge-title');
const challengeDescriptionInput = document.getElementById('challenge-description');
const challengePointsInput = document.getElementById('challenge-points');
const challengeSortOrderInput = document.getElementById('challenge-sort-order');
const challengeActiveInput = document.getElementById('challenge-active');

function setStatus(element, message, kind = '') {
  element.classList.remove('hidden', 'success', 'error');
  if (kind) element.classList.add(kind);
  element.textContent = message;
}

function hideStatus(element) {
  element.classList.add('hidden');
  element.textContent = '';
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

async function loadAdminDashboard() {
  try {
    const challenges = await fetchJson('/api/admin/challenges');
    challengesList.innerHTML = challenges.length ? challenges.map((challenge) => `
      <div class="admin-item">
        <div class="admin-item-header">
          <strong>#${challenge.sort_order || challenge.id} ${challenge.title}</strong>
          <span>${challenge.active ? 'Active' : 'Inactive'}</span>
        </div>
        <p>${challenge.description || 'No description provided.'}</p>
        <p>${challenge.points} pts · ${challenge.submission_count} entries</p>
        <div class="modal-actions">
          <button class="secondary-button small" type="button" data-edit-challenge="${challenge.id}">Edit</button>
          <button class="secondary-button small" type="button" data-toggle-challenge="${challenge.id}">${challenge.active ? 'Deactivate' : 'Activate'}</button>
          <button class="secondary-button small" type="button" data-delete-challenge="${challenge.id}">Delete</button>
        </div>
      </div>
    `).join('') : '<div class="empty-state">No challenges yet.</div>';

    challengesList.querySelectorAll('[data-edit-challenge]').forEach((button) => {
      button.addEventListener('click', () => startChallengeEdit(Number(button.dataset.editChallenge)));
    });

    challengesList.querySelectorAll('[data-toggle-challenge]').forEach((button) => {
      button.addEventListener('click', () => toggleChallenge(Number(button.dataset.toggleChallenge)));
    });

    challengesList.querySelectorAll('[data-delete-challenge]').forEach((button) => {
      button.addEventListener('click', () => deleteChallenge(Number(button.dataset.deleteChallenge)));
    });

    const submissions = await fetchJson('/api/admin/submissions');
    if (!submissions.length) {
      submissionsList.innerHTML = '<div class="empty-state">No submissions yet.</div>';
      return;
    }

    submissionsList.innerHTML = submissions.map((entry) => `
      <div class="admin-submission-card">
        <div class="admin-submission-header">
          <strong>${entry.team_name}</strong>
          <span>${entry.approved ? 'Approved' : 'Pending'}</span>
        </div>
        <div class="two-column">
          <div>
            <p><strong>Challenge:</strong> ${entry.challenge_title}</p>
            <p><strong>Submitted:</strong> ${new Date(entry.submitted_at).toLocaleString()}</p>
            <p><strong>Points:</strong> ${entry.points_awarded}</p>
          </div>
          <div>
            ${entry.image_url ? `<img class="submission-thumb" src="${entry.image_url}" alt="${entry.team_name} photo" />` : '<div class="empty-state">No image</div>'}
          </div>
        </div>
        <p>${entry.caption || 'No caption.'}</p>
        <div class="modal-actions">
          <button class="secondary-button small" type="button" data-set-approved="${entry.id}" data-approved="true">Approve</button>
          <button class="secondary-button small" type="button" data-set-approved="${entry.id}" data-approved="false">Reject</button>
          <button class="secondary-button small" type="button" data-delete-submission="${entry.id}">Delete</button>
        </div>
        <div class="field-group">
          <label class="label" for="points-${entry.id}">Points Awarded</label>
          <input id="points-${entry.id}" type="number" min="0" value="${entry.points_awarded}" data-points-input="${entry.id}" />
          <button class="primary-button small" type="button" data-save-points="${entry.id}">Save Points</button>
        </div>
      </div>
    `).join('');

    submissionsList.querySelectorAll('[data-set-approved]').forEach((button) => {
      button.addEventListener('click', () => updateSubmissionApproval(Number(button.dataset.setApproved), button.dataset.approved === 'true'));
    });

    submissionsList.querySelectorAll('[data-delete-submission]').forEach((button) => {
      button.addEventListener('click', () => deleteSubmission(Number(button.dataset.deleteSubmission)));
    });

    submissionsList.querySelectorAll('[data-save-points]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.savePoints);
        const input = document.querySelector(`[data-points-input="${id}"]`);
        if (!input) return;
        updateSubmissionPoints(id, Number(input.value || 0));
      });
    });
  } catch (error) {
    challengesList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

async function startChallengeEdit(challengeId) {
  try {
    const challenges = await fetchJson('/api/admin/challenges');
    const challenge = challenges.find((item) => Number(item.id) === challengeId);
    if (!challenge) return;

    challengeIdInput.value = challenge.id;
    challengeTitleInput.value = challenge.title;
    challengeDescriptionInput.value = challenge.description || '';
    challengePointsInput.value = challenge.points;
    challengeSortOrderInput.value = challenge.sort_order;
    challengeActiveInput.checked = challenge.active;
    challengeTitleInput.focus();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

async function toggleChallenge(challengeId) {
  try {
    const challenges = await fetchJson('/api/admin/challenges');
    const challenge = challenges.find((item) => Number(item.id) === challengeId);
    if (!challenge) return;

    await fetchJson(`/api/challenges/${challengeId}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: challenge.title,
        description: challenge.description || '',
        points: challenge.points,
        sort_order: challenge.sort_order,
        active: !challenge.active,
      }),
    });

    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

async function deleteChallenge(challengeId) {
  const confirmed = window.confirm('Delete this challenge and all associated entries?');
  if (!confirmed) return;

  try {
    await fetchJson(`/api/challenges/${challengeId}?force=true`, {
      method: 'DELETE',
    });
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

async function updateSubmissionApproval(submissionId, approved) {
  try {
    await fetchJson(`/api/submissions/${submissionId}`, {
      method: 'PUT',
      body: JSON.stringify({ approved, points_awarded: 0 }),
    });
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

async function updateSubmissionPoints(submissionId, points) {
  try {
    await fetchJson(`/api/submissions/${submissionId}`, {
      method: 'PUT',
      body: JSON.stringify({ approved: true, points_awarded: points }),
    });
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

async function deleteSubmission(submissionId) {
  const confirmed = window.confirm('Delete this submission and its Cloudinary image?');
  if (!confirmed) return;

  try {
    await fetchJson(`/api/submissions/${submissionId}`, {
      method: 'DELETE',
    });
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

challengeForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    title: challengeTitleInput.value.trim(),
    description: challengeDescriptionInput.value.trim(),
    points: Number(challengePointsInput.value || 0),
    sort_order: Number(challengeSortOrderInput.value || 0),
    active: challengeActiveInput.checked,
  };

  try {
    if (challengeIdInput.value) {
      await fetchJson(`/api/challenges/${challengeIdInput.value}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } else {
      await fetchJson('/api/challenges', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    challengeForm.reset();
    challengeIdInput.value = '';
    challengeActiveInput.checked = true;
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
});

document.getElementById('reset-challenge-form').addEventListener('click', () => {
  challengeForm.reset();
  challengeIdInput.value = '';
  challengeActiveInput.checked = true;
  challengeTitleInput.focus();
});

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('admin-password').value;

  try {
    await fetchJson('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });

    adminLoginPanel.classList.add('hidden');
    adminDashboard.classList.remove('hidden');
    hideStatus(adminLoginStatus);
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  adminLoginPanel.classList.remove('hidden');
  adminDashboard.classList.add('hidden');
  challengeActiveInput.checked = true;

  try {
    const response = await fetch('/api/admin/challenges', { credentials: 'same-origin' });
    if (response.ok) {
      adminLoginPanel.classList.add('hidden');
      adminDashboard.classList.remove('hidden');
      loadAdminDashboard();
    }
  } catch (error) {
    // ignore; login required
  }
});
