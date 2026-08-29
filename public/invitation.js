async function copyEventInvitationLink(eventId, button) {
  const invitationLink = `${window.location.origin}/event/${eventId}`;
  const originalLabel = button.textContent;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(invitationLink);
    } else {
      const temporaryInput = document.createElement('textarea');
      temporaryInput.value = invitationLink;
      temporaryInput.setAttribute('readonly', '');
      temporaryInput.style.position = 'fixed';
      temporaryInput.style.opacity = '0';
      document.body.appendChild(temporaryInput);
      temporaryInput.select();
      const copied = document.execCommand('copy');
      temporaryInput.remove();
      if (!copied) throw new Error('Copy was not available.');
    }
    button.textContent = 'Link Copied!';
    window.setTimeout(() => { button.textContent = originalLabel; }, 1800);
  } catch (error) {
    window.prompt('Copy this invitation link:', invitationLink);
  }
}
