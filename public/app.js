const TEAM_KEY = 'festival-team-name';
const HUNT_KEY = 'festival-hunt-id';
const HUNT_PASSCODE_KEY = 'festival-hunt-passcodes';
const challengeList = document.getElementById('challenge-list');
const huntSelect = document.getElementById('hunt-select');
const huntDescription = document.getElementById('hunt-description');
const huntAccessLink = document.getElementById('hunt-access-link');
const teamNameInput = document.getElementById('team-name-input');
const saveTeamButton = document.getElementById('save-team-button');
const changeTeamButton = document.getElementById('change-team-button');
const submissionModal = document.getElementById('submission-modal');
const entriesModal = document.getElementById('entries-modal');
const submissionForm = document.getElementById('submission-form');
const challengeIdInput = document.getElementById('challenge-id');
const challengeNameEl = document.getElementById('submission-challenge-name');
const teamNameForm = document.getElementById('team-name-form');
const imageInput = document.getElementById('image-input');
const imagePreview = document.getElementById('image-preview');
const previewImage = document.getElementById('preview-image');
const uploadStatus = document.getElementById('upload-status');
const submitEntryButton = document.getElementById('submit-entry-button');
const entriesContent = document.getElementById('entries-content');
const teamBanner = document.getElementById('team-banner');
const teamBannerName = document.getElementById('team-banner-name');
const scoreTeamName = document.getElementById('score-team-name');
const scoreTotal = document.getElementById('score-total');
const scoreCompleted = document.getElementById('score-completed');

let currentHuntId = null;
let availableHunts = [];
let scoreRefreshTimer = null;

function getStoredPasscodes() {
  try {
    return JSON.parse(localStorage.getItem(HUNT_PASSCODE_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function getHuntHeaders() {
  const passcode = getStoredPasscodes()[currentHuntId];
  return passcode ? { 'X-Hunt-Passcode': passcode } : {};
}

async function requestHuntAccess(hunt) {
  if (!hunt.requires_passcode || getStoredPasscodes()[hunt.id]) return true;
  const passcode = window.prompt(`Enter the passcode for ${hunt.name}:`);
  if (!passcode) return false;
  const stored = getStoredPasscodes();
  stored[hunt.id] = passcode.trim();
  localStorage.setItem(HUNT_PASSCODE_KEY, JSON.stringify(stored));
  return true;
}

function getStoredHuntId() {
  const stored = Number(localStorage.getItem(HUNT_KEY));
  return Number.isInteger(stored) && stored > 0 ? stored : null;
}

async function loadHunts() {
  const response = await fetch('/api/hunts');
  if (!response.ok) throw new Error('Unable to load scavenger hunts right now.');
  availableHunts = await response.json();
  if (!availableHunts.length) throw new Error('No scavenger hunts have been created yet.');

  const storedId = getStoredHuntId();
  const selected = availableHunts.find((hunt) => hunt.id === storedId) || availableHunts.find((hunt) => hunt.active) || availableHunts[0];
  currentHuntId = selected.id;
  localStorage.setItem(HUNT_KEY, String(currentHuntId));
  huntSelect.innerHTML = availableHunts.map((hunt) => `<option value="${hunt.id}">${hunt.name}${hunt.active ? '' : ' (inactive)'}</option>`).join('');
  huntSelect.value = String(currentHuntId);
  huntDescription.textContent = selected.description || '';
  updateHuntAccessLink(selected);
  if (selected.requires_passcode && !await requestHuntAccess(selected)) {
    throw new Error('Enter the event passcode to view this hunt.');
  }
}

function syncTeamBanner() {
  const teamName = getStoredTeamName();
  if (!teamName) {
    teamBanner.classList.add('hidden');
    teamBannerName.textContent = 'No team saved';
    return;
  }

  teamBannerName.textContent = teamName;
  teamBanner.classList.remove('hidden');
}

function setTeamName(name) {
  const cleaned = String(name || '').trim();
  localStorage.setItem(TEAM_KEY, cleaned || '');
  teamNameInput.value = cleaned;
  teamNameForm.value = cleaned;
  syncTeamBanner();
  return cleaned;
}

function getStoredTeamName() {
  return localStorage.getItem(TEAM_KEY) || '';
}

async function loadTeamScore() {
  const teamName = getStoredTeamName();
  if (!currentHuntId || !teamName) {
    scoreTeamName.textContent = 'Enter a team name';
    scoreTotal.textContent = '0';
    scoreCompleted.textContent = '0 challenges completed';
    return;
  }

  try {
    const response = await fetch(`/api/hunts/${currentHuntId}/teams/score?team_name=${encodeURIComponent(teamName)}`, { headers: getHuntHeaders() });
    if (!response.ok) throw new Error('Score unavailable');
    const score = await response.json();
    scoreTeamName.textContent = score.teamName || teamName;
    scoreTotal.textContent = String(score.totalPoints || 0);
    scoreCompleted.textContent = `${score.completedChallenges || 0} challenges completed`;
  } catch (error) {
    scoreTeamName.textContent = teamName;
    scoreTotal.textContent = '0';
    scoreCompleted.textContent = 'Score unavailable';
  }
}

function queueTeamScoreRefresh() {
  window.clearTimeout(scoreRefreshTimer);
  scoreRefreshTimer = window.setTimeout(loadTeamScore, 250);
}

function showStatus(element, message, type = '') {
  element.classList.remove('hidden', 'success', 'error');
  if (type) element.classList.add(type);
  element.textContent = message;
}

function hideStatus(element) {
  element.classList.add('hidden');
  element.textContent = '';
}

function updateHuntAccessLink(hunt) {
  huntAccessLink.href = hunt?.access_link || '#';
  huntAccessLink.classList.toggle('hidden', !hunt?.access_link);
  huntAccessLink.textContent = hunt?.requires_passcode ? 'Where to find the event passcode' : 'Open event information';
}

function openModal(modal) {
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function bindModalClosers() {
  document.querySelectorAll('[data-close-modal="true"]').forEach((button) => {
    button.addEventListener('click', () => {
      closeModal(submissionModal);
      closeModal(entriesModal);
    });
  });
}

function formatDisplayDate(dateString) {
  if (!dateString) return 'Recently';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadChallenges() {
  try {
    const response = await fetch(`/api/challenges?hunt_id=${currentHuntId}`, { headers: getHuntHeaders() });
    if (response.status === 401) {
      const stored = getStoredPasscodes();
      delete stored[currentHuntId];
      localStorage.setItem(HUNT_PASSCODE_KEY, JSON.stringify(stored));
      const hunt = availableHunts.find((item) => item.id === currentHuntId);
      if (hunt && await requestHuntAccess(hunt)) return loadChallenges();
    }
    if (!response.ok) {
      throw new Error('Unable to load challenges right now.');
    }

    const challenges = await response.json();
    if (!challenges.length) {
      challengeList.innerHTML = '<div class="empty-state">No challenges are live right now. Check back soon.</div>';
      return;
    }

    challengeList.innerHTML = challenges.map((challenge) => `
      <article class="challenge-card">
        <div class="challenge-header">
          <div class="challenge-number">#${challenge.sort_order || challenge.id}</div>
          <span class="challenge-points">${challenge.points} POINTS</span>
        </div>
        <h2 class="challenge-title">${challenge.title}</h2>
        <p class="challenge-description">${challenge.description || 'Capture a memorable moment.'}</p>
        <div class="challenge-metrics">
          <span>${challenge.submission_count} entries</span>
        </div>
        <div class="challenge-actions">
          <button class="primary-button" type="button" data-submit-challenge="${challenge.id}">Submit Photo</button>
          <button class="secondary-button" type="button" data-view-challenge="${challenge.id}">View Entries</button>
        </div>
      </article>
    `).join('');

    challengeList.querySelectorAll('[data-submit-challenge]').forEach((button) => {
      button.addEventListener('click', () => openSubmitModal(Number(button.dataset.submitChallenge)));
    });

    challengeList.querySelectorAll('[data-view-challenge]').forEach((button) => {
      button.addEventListener('click', () => openEntriesModal(Number(button.dataset.viewChallenge)));
    });
  } catch (error) {
    challengeList.innerHTML = `<div class="empty-state">${error.message || 'Challenge data is unavailable.'}</div>`;
  }
}

async function openSubmitModal(challengeId) {
  try {
    const response = await fetch(`/api/challenges?hunt_id=${currentHuntId}`);
    const challenges = await response.json();
    const challenge = challenges.find((item) => Number(item.id) === challengeId);
    if (!challenge) {
      throw new Error('Challenge not found.');
    }

    challengeIdInput.value = String(challenge.id);
    challengeNameEl.textContent = challenge.title;
    teamNameForm.value = getStoredTeamName();
    hideStatus(uploadStatus);
    imageInput.value = '';
    imagePreview.classList.add('hidden');
    previewImage.src = '';
    openModal(submissionModal);
  } catch (error) {
    showStatus(uploadStatus, error.message || 'Unable to open the submission form.', 'error');
    openModal(submissionModal);
  }
}

async function openEntriesModal(challengeId) {
  try {
    const response = await fetch(`/api/challenges/${challengeId}/submissions?hunt_id=${currentHuntId}`, { headers: getHuntHeaders() });
    if (!response.ok) {
      throw new Error('Entries could not be loaded.');
    }

    const result = await response.json();
    const entries = result.submissions || [];

    if (!entries.length) {
      entriesContent.innerHTML = '<div class="empty-state">No entries yet for this challenge.</div>';
      openModal(entriesModal);
      return;
    }

    entriesContent.innerHTML = entries.map((entry) => `
      <article class="entry-card">
        <img src="${entry.image_url}" alt="${entry.team_name} submission" data-large-image="${entry.image_url}" />
        <div class="entry-meta">
          <strong>${entry.team_name}</strong>
          ${entry.caption ? `<p>${entry.caption}</p>` : '<p>No caption added.</p>'}
          ${entry.comment ? `<p><strong>Comment:</strong> ${entry.comment}</p>` : ''}
          <small>${formatDisplayDate(entry.submitted_at)}</small>
        </div>
      </article>
    `).join('');

    entriesContent.querySelectorAll('img').forEach((img) => {
      img.addEventListener('click', () => {
        const viewer = window.open(img.dataset.largeImage, '_blank');
        if (viewer) viewer.focus();
      });
    });

    openModal(entriesModal);
  } catch (error) {
    entriesContent.innerHTML = `<div class="empty-state">${error.message || 'Entries are unavailable right now.'}</div>`;
    openModal(entriesModal);
  }
}

imageInput.addEventListener('change', () => {
  const file = imageInput.files && imageInput.files[0];
  if (!file) {
    imagePreview.classList.add('hidden');
    previewImage.src = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    previewImage.src = event.target.result;
    imagePreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
});

saveTeamButton.addEventListener('click', () => {
  const newName = teamNameInput.value.trim();
  if (!newName) {
    alert('Please enter a team or name first.');
    return;
  }

  setTeamName(newName);
  loadTeamScore();
  teamNameInput.value = newName;
  teamNameForm.value = newName;
});

teamNameInput.addEventListener('input', () => {
  const currentValue = teamNameInput.value.trim();
  if (!currentValue) {
    localStorage.removeItem(TEAM_KEY);
    teamNameForm.value = '';
    queueTeamScoreRefresh();
    return;
  }

  setTeamName(currentValue);
  queueTeamScoreRefresh();
});

teamNameForm.addEventListener('input', () => {
  const currentValue = teamNameForm.value.trim();
  if (!currentValue) {
    localStorage.removeItem(TEAM_KEY);
    teamNameInput.value = '';
    queueTeamScoreRefresh();
    return;
  }

  setTeamName(currentValue);
  queueTeamScoreRefresh();
});

changeTeamButton.addEventListener('click', () => {
  localStorage.removeItem(TEAM_KEY);
  teamNameInput.value = '';
  teamNameForm.value = '';
  syncTeamBanner();
  loadTeamScore();
  teamNameInput.focus();
});

submissionForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = imageInput.files && imageInput.files[0];
  const teamName = teamNameForm.value.trim();
  const caption = document.getElementById('caption-input').value.trim();
  const comment = document.getElementById('comment-input').value.trim();
  const challengeId = challengeIdInput.value;

  if (!challengeId) {
    showStatus(uploadStatus, 'Please choose a challenge first.', 'error');
    return;
  }

  if (!teamName) {
    showStatus(uploadStatus, 'Please enter a team or name.', 'error');
    return;
  }

  if (!file) {
    showStatus(uploadStatus, 'Please choose an image before submitting.', 'error');
    return;
  }

  setTeamName(teamName);
  showStatus(uploadStatus, 'Uploading your photo...', '');
  submitEntryButton.disabled = true;
  submitEntryButton.textContent = 'Uploading...';

  const formData = new FormData();
  formData.append('challenge_id', challengeId);
  formData.append('hunt_id', String(currentHuntId));
  formData.append('team_name', teamName);
  formData.append('caption', caption);
  formData.append('comment', comment);
  formData.append('image', file);

  try {
    const response = await fetch('/api/submissions', {
      method: 'POST',
      headers: getHuntHeaders(),
      body: formData,
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Upload failed. Try again.');
    }

    showStatus(uploadStatus, 'Upload successful! Your entry is live.', 'success');
    submissionForm.reset();
    imagePreview.classList.add('hidden');
    previewImage.src = '';
    teamNameForm.value = getStoredTeamName();
    hideStatus(uploadStatus);
    setTimeout(() => {
      closeModal(submissionModal);
      loadChallenges();
      loadTeamScore();
    }, 700);
  } catch (error) {
    showStatus(uploadStatus, error.message || 'Upload failed. Please try again.', 'error');
  } finally {
    submitEntryButton.disabled = false;
    submitEntryButton.textContent = 'Submit Entry';
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const storedTeam = getStoredTeamName();
  if (storedTeam) {
    teamNameInput.value = storedTeam;
    teamNameForm.value = storedTeam;
  }

  syncTeamBanner();
  bindModalClosers();
  loadHunts().then(() => Promise.all([loadChallenges(), loadTeamScore()])).catch((error) => {
    challengeList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  });
});

huntSelect.addEventListener('change', () => {
  currentHuntId = Number(huntSelect.value);
  localStorage.setItem(HUNT_KEY, String(currentHuntId));
  const selected = availableHunts.find((hunt) => hunt.id === currentHuntId);
  huntDescription.textContent = selected?.description || '';
  updateHuntAccessLink(selected);
  requestHuntAccess(selected).then((hasAccess) => {
    if (hasAccess) {
      loadChallenges();
      loadTeamScore();
    } else {
      challengeList.innerHTML = '<div class="empty-state">Enter the event passcode to view this hunt.</div>';
    }
  });
});
