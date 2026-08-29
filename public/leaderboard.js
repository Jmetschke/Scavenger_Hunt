const container = document.getElementById('leaderboard');

function eventIdFromPath() {
  const match = window.location.pathname.match(/^\/event\/(\d+)\/leaderboard\/?$/);
  return match ? Number(match[1]) : null;
}

async function readJson(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'Scores are unavailable.');
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

async function loadLeaderboard() {
  const eventId = eventIdFromPath();
  if (!eventId) return window.location.replace('/');
  configureNavigation(eventId);
  document.getElementById('copy-event-invitation').addEventListener('click', (event) => {
    copyEventInvitationLink(eventId, event.currentTarget);
  });

  try {
    const event = await readJson(await fetch(`/api/events/${eventId}`));
    const leaderboard = await readJson(await fetch(`/api/leaderboard?hunt_id=${eventId}`));
    document.getElementById('leaderboard-event-name').textContent = `${event.name} Scores`;
    if (!leaderboard.length) {
      container.innerHTML = '<div class="empty-state">No scores yet. Start submitting entries.</div>';
      return;
    }
    container.innerHTML = leaderboard.map((entry) => `
      <div class="leaderboard-item">
        <div class="leaderboard-rank">${entry.rank}.</div>
        <div style="flex:1; font-weight:700;">${entry.team_name}</div>
        <div style="font-weight:800; color: var(--primary);">${entry.total_points} pts</div>
      </div>
    `).join('');
  } catch (error) {
    if (error.status === 401) return window.location.replace(`/event/${eventId}`);
    container.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

window.addEventListener('DOMContentLoaded', loadLeaderboard);
