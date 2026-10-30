(() => {
  const notice = document.getElementById('registration-notice');
  const action = document.querySelector('[popovertarget="registration-notice"]');
  if (!notice || !action) return;
  let timer;
  const stop = () => window.clearTimeout(timer);
  const start = () => {
    stop();
    if (notice.matches(':popover-open') && !notice.matches(':hover')) {
      timer = window.setTimeout(() => notice.hidePopover(), 5000);
    }
  };
  notice.addEventListener('toggle', event => {
    if (event.newState === 'open') start();
    else stop();
  });
  action.addEventListener('click', start);
  notice.addEventListener('pointerenter', stop);
  notice.addEventListener('pointerleave', start);
})();
