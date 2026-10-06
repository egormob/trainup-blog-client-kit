(() => {
  const guard = event => {
    if (event.type === 'auxclick' && event.button !== 1) return;
    const link = event.target.closest?.('[data-channel], [data-consent-cta]');
    if (!link || window.iikConsent?.permissions().decided) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (window.iikConsent) { window.iikConsent.request(link); return; }
    const notice = document.querySelector('[data-consent-notice]');
    if (notice) notice.hidden = false;
    link.classList.remove('is-shaking'); void link.offsetWidth; link.classList.add('is-shaking');
    document.querySelector('#channel-consent')?.focus({preventScroll:true});
  };
  document.addEventListener('click', guard, true);
  document.addEventListener('auxclick', guard, true);
})();
