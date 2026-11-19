/** VIS Nexo splash: ninguna demora artificial, sin porcentaje inventado. */
const splash = document.querySelector('#vis-startup');
if (splash) {
  const status = splash.querySelector('#vis-startup-stage');
  const recovery = splash.querySelector('#vis-startup-recovery');
  let finished = false;
  const recoveryTimer = window.setTimeout(() => {
    if (!finished) {
      status.textContent = 'El inicio está tardando más de lo esperado';
      recovery.hidden = false;
    }
  }, 15000);
  splash.querySelector('[data-vis-retry]')?.addEventListener('click', () => window.location.reload());
  document.addEventListener('vis:nexo:startup', event => {
    if (finished) return;
    const stage = event.detail?.stage;
    if (stage === 'session') {
      splash.classList.add('is-session');
      status.textContent = 'Recuperando sesión y configuraciones';
    } else if (stage === 'ready') {
      finished = true;
      window.clearTimeout(recoveryTimer);
      splash.classList.add('is-finished');
      window.setTimeout(() => splash.remove(), 250);
    }
  });
}
