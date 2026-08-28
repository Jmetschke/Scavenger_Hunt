const adminLoginPanel = document.getElementById('admin-login-panel');
const adminDashboard = document.getElementById('admin-dashboard');
const adminLoginForm = document.getElementById('admin-login-form');
const adminLoginStatus = document.getElementById('admin-login-status');
const challengeForm = document.getElementById('challenge-form');
const challengesList = document.getElementById('admin-challenges-list');
const submissionsList = document.getElementById('admin-submissions-list');
const teamScoresList = document.getElementById('admin-team-scores');
const challengeIdInput = document.getElementById('challenge-id');
const challengeTitleInput = document.getElementById('challenge-title');
const challengeDescriptionInput = document.getElementById('challenge-description');
const challengePointsInput = document.getElementById('challenge-points');
const challengeSortOrderInput = document.getElementById('challenge-sort-order');
const challengeActiveInput = document.getElementById('challenge-active');
const huntForm = document.getElementById('hunt-form');
const huntNameInput = document.getElementById('hunt-name');
const huntDescriptionInput = document.getElementById('hunt-description');
const huntDefaultPointsInput = document.getElementById('hunt-default-points');
const huntPasscodeInput = document.getElementById('hunt-passcode');
const huntAccessLinkInput = document.getElementById('hunt-access-link');
const huntWelcomeImageInput = document.getElementById('hunt-welcome-image');
const huntWelcomeImagePreview = document.getElementById('hunt-welcome-image-preview');
const clearWelcomeImageRow = document.getElementById('clear-welcome-image-row');
const clearWelcomeImageInput = document.getElementById('clear-welcome-image');
const clearPasscodeRow = document.getElementById('clear-passcode-row');
const clearPasscodeInput = document.getElementById('clear-passcode');
const huntActiveInput = document.getElementById('hunt-active');
const saveHuntButton = document.getElementById('save-hunt-button');
const resetHuntButton = document.getElementById('reset-hunt-form');
const huntsList = document.getElementById('admin-hunts-list');
const challengeHuntInput = document.getElementById('challenge-hunt');
const currentHuntName = document.getElementById('current-hunt-name');
const currentHuntDescription = document.getElementById('current-hunt-description');
const currentHuntStatus = document.getElementById('current-hunt-status');
const sectionHuntNames = document.querySelectorAll('.section-hunt-name');
const downloadChallengeTemplate = document.getElementById('download-challenge-template');
const challengeTemplateForm = document.getElementById('challenge-template-form');
const challengeTemplateInput = document.getElementById('challenge-template-input');
const uploadChallengeTemplateButton = document.getElementById('upload-challenge-template');
let hunts = [];
let selectedHuntId = null;
let editingHuntId = null;
let dashboardLoadInProgress = false;

function getSelectedHunt() {
  return hunts.find((hunt) => hunt.id === selectedHuntId);
}

function setChallengeDefaults() {
  const selectedHunt = getSelectedHunt();
  if (!selectedHunt) return;
  challengePointsInput.value = String(selectedHunt.default_points);
  challengeSortOrderInput.value = '';
}

function resetHuntForm() {
  editingHuntId = null;
  huntForm.reset();
  huntDefaultPointsInput.value = '5';
  huntPasscodeInput.value = '';
  huntAccessLinkInput.value = '';
  huntWelcomeImageInput.value = '';
  huntWelcomeImagePreview.src = '';
  huntWelcomeImagePreview.classList.add('hidden');
  clearWelcomeImageInput.checked = false;
  clearWelcomeImageRow.classList.add('hidden');
  clearPasscodeInput.checked = false;
  clearPasscodeRow.classList.add('hidden');
  huntActiveInput.checked = true;
  saveHuntButton.textContent = 'Create Hunt';
}

function startHuntEdit(huntId) {
  const hunt = hunts.find((item) => item.id === huntId);
  if (!hunt) return;

  editingHuntId = hunt.id;
  huntNameInput.value = hunt.name;
  huntDescriptionInput.value = hunt.description || '';
  huntDefaultPointsInput.value = String(hunt.default_points);
  huntPasscodeInput.value = '';
  huntAccessLinkInput.value = hunt.access_link || '';
  huntWelcomeImageInput.value = '';
  huntWelcomeImagePreview.src = hunt.welcome_image_url || '';
  huntWelcomeImagePreview.classList.toggle('hidden', !hunt.welcome_image_url);
  clearWelcomeImageInput.checked = false;
  clearWelcomeImageRow.classList.toggle('hidden', !hunt.welcome_image_url);
  clearPasscodeInput.checked = false;
  clearPasscodeRow.classList.toggle('hidden', !hunt.requires_passcode);
  huntActiveInput.checked = hunt.active;
  saveHuntButton.textContent = 'Save Hunt Changes';
  huntNameInput.focus();
}

function updateSelectedHuntContext() {
  const selectedHunt = hunts.find((hunt) => hunt.id === selectedHuntId);
  if (!selectedHunt) return;

  currentHuntName.textContent = selectedHunt.name;
  currentHuntDescription.textContent = selectedHunt.description || 'No description provided.';
  currentHuntStatus.textContent = selectedHunt.active ? 'Available to participants' : 'Hidden from participants';
  sectionHuntNames.forEach((element) => {
    element.textContent = selectedHunt.name;
  });
}

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

async function fetchForm(url, formData, method) {
  const response = await fetch(url, { method, body: formData });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function setButtonBusy(button, busy, busyLabel = 'Working...') {
  if (busy) {
    button.dataset.defaultLabel = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    return;
  }
  button.disabled = false;
  button.textContent = button.dataset.defaultLabel || button.textContent;
}

async function loadAdminDashboard() {
  if (dashboardLoadInProgress) return;
  dashboardLoadInProgress = true;
  try {
    hunts = await fetchJson('/api/hunts?include_inactive=true');
    if (!selectedHuntId || !hunts.some((hunt) => hunt.id === selectedHuntId)) selectedHuntId = hunts[0]?.id;
    updateSelectedHuntContext();
    challengeHuntInput.innerHTML = hunts.map((hunt) => `<option value="${hunt.id}">${hunt.name}</option>`).join('');
    challengeHuntInput.value = String(selectedHuntId || '');
    huntsList.innerHTML = hunts.map((hunt) => `
      <div class="admin-item ${hunt.id === selectedHuntId ? 'selected-hunt' : ''}">
        <div class="admin-item-header"><strong>${hunt.name}</strong><span>${hunt.active ? 'Available' : 'Hidden'}</span></div>
        <p>${hunt.description || 'No description provided.'}</p>
        <p><strong>New challenges start at ${hunt.default_points} points.</strong></p>
        ${hunt.access_link ? `<p><a href="${hunt.access_link}" target="_blank" rel="noopener">Open event information link</a></p>` : ''}
        <div class="modal-actions">
          <button class="${hunt.id === selectedHuntId ? 'primary-button' : 'secondary-button'} small" type="button" data-select-hunt="${hunt.id}">${hunt.id === selectedHuntId ? 'Editing' : 'Manage'}</button>
          <button class="secondary-button small" type="button" data-edit-hunt="${hunt.id}">Edit</button>
          <button class="secondary-button small" type="button" data-clone-hunt="${hunt.id}">Clone</button>
          <button class="secondary-button small" type="button" data-delete-hunt="${hunt.id}">Delete</button>
        </div>
      </div>
    `).join('');
    huntsList.querySelectorAll('[data-select-hunt]').forEach((button) => button.addEventListener('click', async () => {
      setButtonBusy(button, true, 'Loading...');
      selectedHuntId = Number(button.dataset.selectHunt);
      challengeHuntInput.value = String(selectedHuntId);
      setChallengeDefaults();
      try {
        await loadAdminDashboard();
      } finally {
        setButtonBusy(button, false);
      }
    }));
    huntsList.querySelectorAll('[data-delete-hunt]').forEach((button) => button.addEventListener('click', async () => {
      setButtonBusy(button, true, 'Deleting...');
      try { await deleteHunt(Number(button.dataset.deleteHunt)); } finally { setButtonBusy(button, false); }
    }));
    huntsList.querySelectorAll('[data-edit-hunt]').forEach((button) => button.addEventListener('click', () => startHuntEdit(Number(button.dataset.editHunt))));
    huntsList.querySelectorAll('[data-clone-hunt]').forEach((button) => button.addEventListener('click', async () => {
      setButtonBusy(button, true, 'Cloning...');
      try { await cloneHunt(Number(button.dataset.cloneHunt)); } finally { setButtonBusy(button, false); }
    }));

    const [challenges, submissions, teamScores] = await Promise.all([
      fetchJson(`/api/admin/challenges?hunt_id=${selectedHuntId}`),
      fetchJson(`/api/admin/submissions?hunt_id=${selectedHuntId}`),
      fetchJson(`/api/admin/teams?hunt_id=${selectedHuntId}`),
    ]);
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
      button.addEventListener('click', async () => {
        setButtonBusy(button, true, 'Saving...');
        try { await toggleChallenge(Number(button.dataset.toggleChallenge)); } finally { setButtonBusy(button, false); }
      });
    });

    challengesList.querySelectorAll('[data-delete-challenge]').forEach((button) => {
      button.addEventListener('click', async () => {
        setButtonBusy(button, true, 'Deleting...');
        try { await deleteChallenge(Number(button.dataset.deleteChallenge)); } finally { setButtonBusy(button, false); }
      });
    });

    teamScoresList.innerHTML = teamScores.length ? teamScores.map((team) => `
      <div class="team-score-row">
        <strong>${team.team_name}</strong>
        <span>${team.total_points} pts · ${team.completed_challenges} challenges</span>
      </div>
    `).join('') : '<div class="empty-state">No event teams yet.</div>';
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
        <p>${entry.comment ? `<strong>Comment:</strong> ${entry.comment}` : 'No comment.'}</p>
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
      button.addEventListener('click', async () => {
        setButtonBusy(button, true, 'Saving...');
        try { await updateSubmissionApproval(Number(button.dataset.setApproved), button.dataset.approved === 'true'); } finally { setButtonBusy(button, false); }
      });
    });

    submissionsList.querySelectorAll('[data-delete-submission]').forEach((button) => {
      button.addEventListener('click', async () => {
        setButtonBusy(button, true, 'Deleting...');
        try { await deleteSubmission(Number(button.dataset.deleteSubmission)); } finally { setButtonBusy(button, false); }
      });
    });

    submissionsList.querySelectorAll('[data-save-points]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.dataset.savePoints);
        const input = document.querySelector(`[data-points-input="${id}"]`);
        if (!input) return;
        setButtonBusy(button, true, 'Saving...');
        updateSubmissionPoints(id, Number(input.value || 0)).finally(() => setButtonBusy(button, false));
      });
    });
  } catch (error) {
    challengesList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  } finally {
    dashboardLoadInProgress = false;
  }
}

async function startChallengeEdit(challengeId) {
  try {
    const challenges = await fetchJson(`/api/admin/challenges?hunt_id=${selectedHuntId}`);
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
    const challenges = await fetchJson(`/api/admin/challenges?hunt_id=${selectedHuntId}`);
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

async function deleteHunt(huntId) {
  if (!window.confirm('Delete this empty scavenger hunt?')) return;
  try {
    await fetchJson(`/api/hunts/${huntId}`, { method: 'DELETE' });
    selectedHuntId = null;
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

async function cloneHunt(huntId) {
  const hunt = hunts.find((item) => item.id === huntId);
  if (!hunt) return;
  const name = window.prompt('Name for the cloned hunt:', `${hunt.name} Copy`);
  if (!name || !name.trim()) return;

  try {
    const result = await fetchJson(`/api/hunts/${huntId}/clone`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim() }),
    });
    selectedHuntId = result.id;
    await loadAdminDashboard();
    setChallengeDefaults();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  }
}

async function updateSubmissionApproval(submissionId, approved) {
  try {
    await fetchJson(`/api/submissions/${submissionId}`, {
      method: 'PUT',
      body: JSON.stringify({ approved }),
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
  const submitButton = challengeForm.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, 'Saving...');

  const payload = {
    hunt_id: Number(challengeHuntInput.value),
    title: challengeTitleInput.value.trim(),
    description: challengeDescriptionInput.value.trim(),
    points: Number(challengePointsInput.value || 0),
    sort_order: challengeSortOrderInput.value.trim() === '' ? null : Number(challengeSortOrderInput.value),
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

    challengeTitleInput.value = '';
    challengeDescriptionInput.value = '';
    challengeSortOrderInput.value = '';
    challengeIdInput.value = '';
    challengeActiveInput.checked = true;
    challengePointsInput.value = payload.points;
    loadAdminDashboard();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  } finally {
    setButtonBusy(submitButton, false);
  }
});

challengeHuntInput.addEventListener('change', () => {
  selectedHuntId = Number(challengeHuntInput.value);
  setChallengeDefaults();
  loadAdminDashboard();
});

huntForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setButtonBusy(saveHuntButton, true, 'Saving...');
  try {
    const formData = new FormData(huntForm);
    const result = await fetchForm(editingHuntId ? `/api/hunts/${editingHuntId}` : '/api/hunts', formData, editingHuntId ? 'PUT' : 'POST');
    if (!editingHuntId) selectedHuntId = result.id;
    resetHuntForm();
    await loadAdminDashboard();
    setChallengeDefaults();
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  } finally {
    setButtonBusy(saveHuntButton, false);
  }
});

resetHuntButton.addEventListener('click', resetHuntForm);

downloadChallengeTemplate.addEventListener('click', (event) => {
  if (!selectedHuntId) {
    event.preventDefault();
    setStatus(adminLoginStatus, 'Select a hunt before downloading its challenge template.', 'error');
    return;
  }
  downloadChallengeTemplate.href = `/api/admin/hunts/${selectedHuntId}/challenges/template`;
});

challengeTemplateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedHuntId) return;
  const file = challengeTemplateInput.files && challengeTemplateInput.files[0];
  if (!file) return;
  setButtonBusy(uploadChallengeTemplateButton, true, 'Uploading...');
  const formData = new FormData();
  formData.append('template', file);
  try {
    const result = await fetchForm(`/api/admin/hunts/${selectedHuntId}/challenges/import`, formData, 'POST');
    challengeTemplateForm.reset();
    await loadAdminDashboard();
    setStatus(adminLoginStatus, result.message, 'success');
  } catch (error) {
    setStatus(adminLoginStatus, error.message, 'error');
  } finally {
    setButtonBusy(uploadChallengeTemplateButton, false);
  }
});

huntWelcomeImageInput.addEventListener('change', () => {
  const file = huntWelcomeImageInput.files && huntWelcomeImageInput.files[0];
  if (!file) return;
  huntWelcomeImagePreview.src = URL.createObjectURL(file);
  huntWelcomeImagePreview.classList.remove('hidden');
  clearWelcomeImageInput.checked = false;
});

document.getElementById('reset-challenge-form').addEventListener('click', () => {
  challengeForm.reset();
  challengeIdInput.value = '';
  challengeActiveInput.checked = true;
  setChallengeDefaults();
  challengeTitleInput.focus();
});

adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('admin-password').value;
  const submitButton = adminLoginForm.querySelector('button[type="submit"]');
  setButtonBusy(submitButton, true, 'Signing in...');

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
  } finally {
    setButtonBusy(submitButton, false);
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
      loadAdminDashboard().then(setChallengeDefaults);
    }
  } catch (error) {
    // ignore; login required
  }
});
