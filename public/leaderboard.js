async function loadLeaderboard() {
  const container = document.getElementById('leaderboard');

  try {
    const response = await fetch('/api/leaderboard');
    if (!response.ok) {
      throw new Error('Leaderboard is unavailable right now.');
    }

    const leaderboard = await response.json();
    if (!leaderboard.length) {
      container.innerHTML = '<div class="empty-state">No approved scores yet. Start submitting entries.</div>';
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
    container.innerHTML = `<div class="empty-state">${error.message || 'Leaderboard is unavailable.'}</div>`;
  }
}

window.addEventListener('DOMContentLoaded', loadLeaderboard);
