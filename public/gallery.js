const galleryEventName = document.getElementById('gallery-event-name');
const galleryDescription = document.getElementById('gallery-description');
const galleryCount = document.getElementById('gallery-count');
const galleryGrid = document.getElementById('gallery-grid');

function eventIdFromPath() {
  const match = window.location.pathname.match(/^\/event\/(\d+)\/gallery\/?$/);
  return match ? Number(match[1]) : null;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

async function readJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Gallery unavailable.');
    error.status = response.status;
    throw error;
  }
  return result;
}

function configureNavigation(eventId) {
  document.getElementById('event-hunt-link').href = `/event/${eventId}`;
  document.getElementById('event-gallery-link').href = `/event/${eventId}/gallery`;
  document.getElementById('event-scores-link').href = `/event/${eventId}/leaderboard`;
}

async function initializeGallery() {
  const eventId = eventIdFromPath();
  if (!eventId) return window.location.replace('/');
  configureNavigation(eventId);
  document.getElementById('copy-event-invitation').addEventListener('click', (event) => {
    copyEventInvitationLink(eventId, event.currentTarget);
  });

  try {
    const [event, result] = await Promise.all([
      readJson(await fetch(`/api/events/${eventId}`)),
      readJson(await fetch(`/api/hunts/${eventId}/submissions`)),
    ]);
    galleryEventName.textContent = `${event.name} Gallery`;
    galleryDescription.textContent = event.description || '';
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
          <strong>${entry.team_name}</strong><span>${entry.challenge_title}</span>
          ${entry.caption ? `<p>${entry.caption}</p>` : ''}${entry.comment ? `<p><strong>Comment:</strong> ${entry.comment}</p>` : ''}
          <small>${formatDate(entry.submitted_at)}</small>
        </div>
      </article>
    `).join('');
    galleryGrid.querySelectorAll('[data-large-image]').forEach((button) => button.addEventListener('click', () => window.open(button.dataset.largeImage, '_blank')));
  } catch (error) {
    if (error.status === 401) return window.location.replace(`/event/${eventId}`);
    galleryGrid.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

window.addEventListener('DOMContentLoaded', initializeGallery);
