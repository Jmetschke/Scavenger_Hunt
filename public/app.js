const LEGACY_TEAM_KEY = 'festival-team-name';
const entryScreen = document.getElementById('event-entry-screen');
const eventApp = document.getElementById('event-app');
const eventPickerForm = document.getElementById('event-picker-form');
const eventPickerSelect = document.getElementById('event-picker-select');
const eventCodeGroup = document.getElementById('event-code-group');
const eventCodeInput = document.getElementById('event-code-input');
const eventAccessLink = document.getElementById('event-access-link');
const eventEntryStatus = document.getElementById('event-entry-status');
const challengeList = document.getElementById('challenge-list');
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
const cameraInput = document.getElementById('camera-input');
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
const eventWelcomeImage = document.getElementById('event-welcome-image');
const eventWelcomeName = document.getElementById('event-welcome-name');
const eventWelcomeDescription = document.getElementById('event-welcome-description');

let currentEventId = null;
let availableEvents = [];
let scoreRefreshTimer = null;
let selectedImageFile = null;

function eventIdFromPath() {
  const match = window.location.pathname.match(/^\/event\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

function teamStorageKey() {
  return `festival-team-name:${currentEventId}`;
}

function getStoredTeamName() {
  if (!currentEventId) return '';
  return localStorage.getItem(teamStorageKey()) || localStorage.getItem(LEGACY_TEAM_KEY) || '';
}

function setStoredTeamName(name) {
  const cleaned = String(name || '').trim();
  if (cleaned) localStorage.setItem(teamStorageKey(), cleaned);
  else localStorage.removeItem(teamStorageKey());
  return cleaned;
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

function setButtonBusy(button, busy, busyLabel = 'Working...') {
  if (busy) {
    button.dataset.defaultLabel = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.defaultLabel || button.textContent;
  }
}

async function readJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.status = response.status;
    error.details = result;
    throw error;
  }
  return result;
}

function selectedEntryEvent() {
  return availableEvents.find((event) => event.id === Number(eventPickerSelect.value));
}

function updateEntryFields() {
  const event = selectedEntryEvent();
  const requiresCode = Boolean(event?.requires_passcode);
  eventCodeGroup.classList.toggle('hidden', !requiresCode);
  eventCodeInput.required = requiresCode;
  eventCodeInput.value = '';
  eventAccessLink.href = event?.access_link || '#';
  eventAccessLink.classList.toggle('hidden', !requiresCode || !event?.access_link);
  hideStatus(eventEntryStatus);
}

async function loadEventList(preferredId = null) {
  availableEvents = await readJson(await fetch('/api/hunts'));
  if (!availableEvents.length) throw new Error('No active events are available right now.');
  eventPickerSelect.innerHTML = availableEvents.map((event) => `<option value="${event.id}">${event.name}</option>`).join('');
  const selected = availableEvents.find((event) => event.id === preferredId) || availableEvents[0];
  eventPickerSelect.value = String(selected.id);
  eventPickerSelect.disabled = Boolean(preferredId && availableEvents.some((event) => event.id === preferredId));
  updateEntryFields();
}

function showEntryScreen() {
  eventApp.classList.add('hidden');
  entryScreen.classList.remove('hidden');
}

function configureEventNavigation(eventId) {
  document.getElementById('event-hunt-link').href = `/event/${eventId}`;
  document.getElementById('event-gallery-link').href = `/event/${eventId}/gallery`;
  document.getElementById('event-scores-link').href = `/event/${eventId}/leaderboard`;
}

function syncTeamDisplay() {
  const teamName = getStoredTeamName();
  teamNameInput.value = teamName;
  teamNameForm.value = teamName;
  teamBannerName.textContent = teamName || 'No team saved';
  teamBanner.classList.toggle('hidden', !teamName);
}

function updateEventHeader(event) {
  eventWelcomeName.textContent = event.name;
  eventWelcomeDescription.textContent = event.description || '';
  eventWelcomeImage.src = event.welcome_image_url || '';
  eventWelcomeImage.alt = event.welcome_image_url ? `${event.name} welcome banner` : '';
  eventWelcomeImage.classList.toggle('hidden', !event.welcome_image_url);
  huntAccessLink.href = event.access_link || '#';
  huntAccessLink.classList.toggle('hidden', !event.access_link);
}

async function loadCurrentEvent() {
  const response = await fetch(`/api/events/${currentEventId}`);
  if (response.status === 401) {
    await loadEventList(currentEventId);
    showEntryScreen();
    return false;
  }
  const event = await readJson(response);
  configureEventNavigation(currentEventId);
  updateEventHeader(event);
  syncTeamDisplay();
  entryScreen.classList.add('hidden');
  eventApp.classList.remove('hidden');
  await Promise.all([loadChallenges(), loadTeamScore()]);
  return true;
}

async function loadTeamScore() {
  const teamName = getStoredTeamName();
  if (!teamName) {
    scoreTeamName.textContent = 'Enter a team name';
    scoreTotal.textContent = '0';
    scoreCompleted.textContent = '0 challenges completed';
    return;
  }

  try {
    const score = await readJson(await fetch(`/api/hunts/${currentEventId}/teams/score?team_name=${encodeURIComponent(teamName)}`));
    scoreTeamName.textContent = score.teamName || teamName;
    scoreTotal.textContent = String(score.totalPoints || 0);
    scoreCompleted.textContent = `${score.completedChallenges || 0} challenges completed`;
  } catch (error) {
    scoreTeamName.textContent = teamName;
    scoreTotal.textContent = '0';
    scoreCompleted.textContent = error.status === 401 ? 'Event access required' : 'Score unavailable';
  }
}

function queueTeamScoreRefresh() {
  window.clearTimeout(scoreRefreshTimer);
  scoreRefreshTimer = window.setTimeout(loadTeamScore, 250);
}

function openModal(modal) {
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modal) {
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function formatDisplayDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadChallenges() {
  try {
    const challenges = await readJson(await fetch(`/api/challenges?hunt_id=${currentEventId}`));
    if (!challenges.length) {
      challengeList.innerHTML = '<div class="empty-state">No challenges are live right now. Check back soon.</div>';
      return;
    }

    challengeList.innerHTML = challenges.map((challenge) => `
      <article class="challenge-card">
        <div class="challenge-header"><div class="challenge-number">#${challenge.sort_order || challenge.id}</div><span class="challenge-points">${challenge.points} POINTS</span></div>
        <h2 class="challenge-title">${challenge.title}</h2>
        <p class="challenge-description">${challenge.description || 'Capture a memorable moment.'}</p>
        <div class="challenge-metrics"><span>${challenge.submission_count} entries</span></div>
        <div class="challenge-actions">
          <button class="primary-button" type="button" data-submit-challenge="${challenge.id}">Submit Photo</button>
          <button class="secondary-button" type="button" data-view-challenge="${challenge.id}">View Entries</button>
        </div>
      </article>
    `).join('');

    challengeList.querySelectorAll('[data-submit-challenge]').forEach((button) => button.addEventListener('click', () => openSubmitModal(Number(button.dataset.submitChallenge), button)));
    challengeList.querySelectorAll('[data-view-challenge]').forEach((button) => button.addEventListener('click', () => openEntriesModal(Number(button.dataset.viewChallenge), button)));
  } catch (error) {
    if (error.status === 401) window.location.assign(`/event/${currentEventId}`);
    else challengeList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

async function getChallenge(challengeId) {
  const challenges = await readJson(await fetch(`/api/challenges?hunt_id=${currentEventId}`));
  return challenges.find((challenge) => Number(challenge.id) === challengeId);
}

async function openSubmitModal(challengeId, button) {
  setButtonBusy(button, true, 'Loading...');
  try {
    const challenge = await getChallenge(challengeId);
    if (!challenge) throw new Error('Challenge not found.');
    challengeIdInput.value = String(challenge.id);
    challengeNameEl.textContent = challenge.title;
    teamNameForm.value = getStoredTeamName();
    hideStatus(uploadStatus);
    selectedImageFile = null;
    cameraInput.value = '';
    imageInput.value = '';
    imagePreview.classList.add('hidden');
    previewImage.src = '';
    openModal(submissionModal);
  } catch (error) {
    showStatus(uploadStatus, error.message, 'error');
    openModal(submissionModal);
  } finally {
    setButtonBusy(button, false);
  }
}

async function openEntriesModal(challengeId, button) {
  setButtonBusy(button, true, 'Loading...');
  try {
    const result = await readJson(await fetch(`/api/challenges/${challengeId}/submissions?hunt_id=${currentEventId}`));
    const entries = result.submissions || [];
    entriesContent.innerHTML = entries.length ? entries.map((entry) => `
      <article class="entry-card">
        <img src="${entry.image_url}" alt="${entry.team_name} submission" data-large-image="${entry.image_url}" />
        <div class="entry-meta"><strong>${entry.team_name}</strong>${entry.caption ? `<p>${entry.caption}</p>` : '<p>No caption added.</p>'}${entry.comment ? `<p><strong>Comment:</strong> ${entry.comment}</p>` : ''}<small>${formatDisplayDate(entry.submitted_at)}</small></div>
      </article>
    `).join('') : '<div class="empty-state">No entries yet for this challenge.</div>';
    entriesContent.querySelectorAll('[data-large-image]').forEach((image) => image.addEventListener('click', () => window.open(image.dataset.largeImage, '_blank')));
    openModal(entriesModal);
  } catch (error) {
    entriesContent.innerHTML = `<div class="empty-state">${error.message}</div>`;
    openModal(entriesModal);
  } finally {
    setButtonBusy(button, false);
  }
}

function selectSubmissionImage(input, otherInput) {
  const file = input.files?.[0];
  if (!file) return;
  selectedImageFile = file;
  otherInput.value = '';
  hideStatus(uploadStatus);
  const reader = new FileReader();
  reader.onload = (event) => {
    previewImage.src = event.target.result;
    imagePreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

eventPickerSelect.addEventListener('change', updateEntryFields);
eventPickerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const selected = selectedEntryEvent();
  if (!selected) return;
  const button = eventPickerForm.querySelector('button[type="submit"]');
  setButtonBusy(button, true, 'Entering...');
  try {
    await readJson(await fetch(`/api/events/${selected.id}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: eventCodeInput.value }),
    }));
    window.location.assign(`/event/${selected.id}`);
  } catch (error) {
    showStatus(eventEntryStatus, error.message, 'error');
    eventCodeInput.focus();
  } finally {
    setButtonBusy(button, false);
  }
});

saveTeamButton.addEventListener('click', () => {
  const name = setStoredTeamName(teamNameInput.value);
  teamNameInput.value = name;
  teamNameForm.value = name;
  syncTeamDisplay();
  loadTeamScore();
});

teamNameInput.addEventListener('input', () => {
  setStoredTeamName(teamNameInput.value);
  teamNameForm.value = teamNameInput.value.trim();
  syncTeamDisplay();
  queueTeamScoreRefresh();
});

teamNameForm.addEventListener('input', () => {
  setStoredTeamName(teamNameForm.value);
  teamNameInput.value = teamNameForm.value.trim();
  syncTeamDisplay();
  queueTeamScoreRefresh();
});

changeTeamButton.addEventListener('click', () => {
  setStoredTeamName('');
  syncTeamDisplay();
  loadTeamScore();
  teamNameInput.focus();
});

document.getElementById('copy-event-invitation').addEventListener('click', (event) => {
  copyEventInvitationLink(currentEventId, event.currentTarget);
});

cameraInput.addEventListener('change', () => selectSubmissionImage(cameraInput, imageInput));
imageInput.addEventListener('change', () => selectSubmissionImage(imageInput, cameraInput));
document.querySelectorAll('[data-close-modal="true"]').forEach((button) => button.addEventListener('click', () => {
  closeModal(submissionModal);
  closeModal(entriesModal);
}));

submissionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const teamName = teamNameForm.value.trim();
  if (!teamName) return showStatus(uploadStatus, 'Please enter a team or name.', 'error');
  if (!selectedImageFile) return showStatus(uploadStatus, 'Please choose an image before submitting.', 'error');

  setStoredTeamName(teamName);
  showStatus(uploadStatus, 'Uploading your photo...', '');
  setButtonBusy(submitEntryButton, true, 'Uploading...');
  const formData = new FormData(submissionForm);
  formData.set('hunt_id', String(currentEventId));
  formData.set('image', selectedImageFile);

  try {
    const result = await readJson(await fetch('/api/submissions', { method: 'POST', body: formData }));
    const points = Number(result.submission?.points_awarded || 0);
    showStatus(uploadStatus, `Upload successful! ${points} point${points === 1 ? '' : 's'} added.`, 'success');
    submissionForm.reset();
    selectedImageFile = null;
    imagePreview.classList.add('hidden');
    teamNameForm.value = getStoredTeamName();
    window.setTimeout(() => {
      closeModal(submissionModal);
      loadChallenges();
      loadTeamScore();
    }, 700);
  } catch (error) {
    showStatus(uploadStatus, error.message, 'error');
  } finally {
    setButtonBusy(submitEntryButton, false);
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  currentEventId = eventIdFromPath();
  try {
    if (!currentEventId) {
      await loadEventList();
      showEntryScreen();
      return;
    }
    await loadCurrentEvent();
  } catch (error) {
    showEntryScreen();
    showStatus(eventEntryStatus, error.message, 'error');
  }
});
