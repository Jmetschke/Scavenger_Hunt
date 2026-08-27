const GALLERY_HUNT_KEY = 'festival-gallery-hunt-id';
const HUNT_PASSCODE_KEY = 'festival-hunt-passcodes';
const gallerySelect = document.getElementById('gallery-hunt-select');
const galleryDescription = document.getElementById('gallery-hunt-description');
const galleryAccessLink = document.getElementById('gallery-access-link');
const galleryEventName = document.getElementById('gallery-event-name');
const galleryCount = document.getElementById('gallery-count');
const galleryGrid = document.getElementById('gallery-grid');
let hunts = [];

function updateGalleryAccessLink(hunt) {
  galleryAccessLink.href = hunt?.access_link || '#';
  galleryAccessLink.classList.toggle('hidden', !hunt?.access_link);
  galleryAccessLink.textContent = hunt?.requires_passcode ? 'Where to find the event passcode' : 'Open event information';
}

function getStoredPasscodes() {
  try {
    return JSON.parse(localStorage.getItem(HUNT_PASSCODE_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

async function requestHuntAccess(hunt) {
  const stored = getStoredPasscodes();
  if (!hunt.requires_passcode || stored[hunt.id]) return true;
  const passcode = window.prompt(`Enter the passcode for ${hunt.name}:`);
  if (!passcode) return false;
  stored[hunt.id] = passcode.trim();
  localStorage.setItem(HUNT_PASSCODE_KEY, JSON.stringify(stored));
  return true;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function getStoredHuntId() {
  const id = Number(localStorage.getItem(GALLERY_HUNT_KEY));
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadGallery(huntId, retry = true) {
  galleryGrid.innerHTML = '<div class="empty-state">Loading photos...</div>';
  const response = await fetch(`/api/hunts/${huntId}/submissions`, {
    headers: { 'X-Hunt-Passcode': getStoredPasscodes()[huntId] || '' },
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) {
    const stored = getStoredPasscodes();
    delete stored[huntId];
    localStorage.setItem(HUNT_PASSCODE_KEY, JSON.stringify(stored));
    const hunt = hunts.find((item) => item.id === huntId);
    if (hunt && retry && await requestHuntAccess(hunt)) return loadGallery(huntId, false);
  }
  if (!response.ok) throw new Error(result.error || 'Unable to load this event gallery.');

  galleryEventName.textContent = result.hunt.name;
  galleryCount.textContent = `${result.submissions.length} ${result.submissions.length === 1 ? 'photo' : 'photos'}`;
  if (!result.submissions.length) {
    galleryGrid.innerHTML = '<div class="empty-state">No photos have been submitted for this event yet.</div>';
    return;
  }

  galleryGrid.innerHTML = result.submissions.map((entry) => `
    <article class="gallery-card">
      <button class="gallery-image-button" type="button" data-large-image="${entry.image_url}" aria-label="View photo from ${entry.team_name}">
        <img src="${entry.image_url}" alt="${entry.team_name} submission for ${entry.challenge_title}" loading="lazy" />
      </button>
      <div class="gallery-card-meta">
        <strong>${entry.team_name}</strong>
        <span>${entry.challenge_title}</span>
        ${entry.caption ? `<p>${entry.caption}</p>` : ''}
        ${entry.comment ? `<p><strong>Comment:</strong> ${entry.comment}</p>` : ''}
        <small>${formatDate(entry.submitted_at)}</small>
      </div>
    </article>
  `).join('');

  galleryGrid.querySelectorAll('[data-large-image]').forEach((button) => {
    button.addEventListener('click', () => {
      const viewer = window.open(button.dataset.largeImage, '_blank');
      if (viewer) viewer.focus();
    });
  });
}

async function initializeGallery() {
  try {
    const response = await fetch('/api/hunts');
    if (!response.ok) throw new Error('Unable to load events right now.');
    hunts = await response.json();
    if (!hunts.length) throw new Error('No active events are available.');

    const storedId = getStoredHuntId();
    const selected = hunts.find((hunt) => hunt.id === storedId) || hunts[0];
    gallerySelect.innerHTML = hunts.map((hunt) => `<option value="${hunt.id}">${hunt.name}</option>`).join('');
    gallerySelect.value = String(selected.id);
    galleryDescription.textContent = selected.description || '';
    updateGalleryAccessLink(selected);
    localStorage.setItem(GALLERY_HUNT_KEY, String(selected.id));
    if (selected.requires_passcode && !await requestHuntAccess(selected)) {
      throw new Error('Enter the event passcode to view this gallery.');
    }
    await loadGallery(selected.id);
  } catch (error) {
    galleryGrid.innerHTML = `<div class="empty-state">${error.message || 'Gallery unavailable.'}</div>`;
  }
}

gallerySelect.addEventListener('change', async () => {
  const huntId = Number(gallerySelect.value);
  const selected = hunts.find((hunt) => hunt.id === huntId);
  localStorage.setItem(GALLERY_HUNT_KEY, String(huntId));
  galleryDescription.textContent = selected?.description || '';
  updateGalleryAccessLink(selected);
  if (!selected) return;
  const hasAccess = await requestHuntAccess(selected);
  if (!hasAccess) {
    galleryGrid.innerHTML = '<div class="empty-state">Enter the event passcode to view this gallery.</div>';
    return;
  }
  try {
    await loadGallery(huntId);
  } catch (error) {
    galleryGrid.innerHTML = `<div class="empty-state">${error.message || 'Gallery unavailable.'}</div>`;
  }
});

window.addEventListener('DOMContentLoaded', initializeGallery);
