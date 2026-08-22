async function loadLeaderboard() {
  const container = document.getElementById('leaderboard');
  const huntId = new URLSearchParams(window.location.search).get('hunt_id') || localStorage.getItem('festival-hunt-id') || '';
  const passcodes = JSON.parse(localStorage.getItem('festival-hunt-passcodes') || '{}');

  try {
    const huntsResponse = await fetch('/api/hunts');
    const hunts = await huntsResponse.json();
    const hunt = hunts.find((item) => String(item.id) === String(huntId)) || hunts[0];
    const selectedHuntId = hunt ? hunt.id : huntId;
    if (hunt?.requires_passcode && !passcodes[selectedHuntId]) {
      const passcode = window.prompt(`Enter the passcode for ${hunt.name}:`);
      if (!passcode) throw new Error('Enter the event passcode to view the leaderboard.');
      passcodes[selectedHuntId] = passcode.trim();
      localStorage.setItem('festival-hunt-passcodes', JSON.stringify(passcodes));
    }
    const response = await fetch(`/api/leaderboard?hunt_id=${encodeURIComponent(selectedHuntId)}`, {
      headers: { 'X-Hunt-Passcode': passcodes[selectedHuntId] || '' },
    });
    if (response.status === 401) {
      delete passcodes[selectedHuntId];
      localStorage.setItem('festival-hunt-passcodes', JSON.stringify(passcodes));
      throw new Error('The event passcode was not accepted. Return to the event page and try again.');
    }
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
