
(() => {
  'use strict';
  const root = document.getElementById("trainup-premium-article");
  if (!root || root.dataset.runtimeReady) return;
  root.dataset.runtimeReady = 'true';
(() => {
  'use strict';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  root.querySelectorAll('[data-reviews-gallery]').forEach((gallery) => {
    // Prepare clipped slides together when the gallery approaches the viewport.
    const loadImages = () => gallery.querySelectorAll('img').forEach(image => { image.loading = 'eager'; });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        loadImages();
        observer.disconnect();
      }, { rootMargin: '400px 0px' });
      observer.observe(gallery);
    } else { loadImages(); }
    const track = gallery.querySelector('[data-reviews-track]');
    const section = gallery.closest('[data-section-id]');
    const previous = section.querySelector('[data-reviews-prev]');
    const next = section.querySelector('[data-reviews-next]');
    const update = () => {
      previous.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
    };
    const scroll = (direction) => {
      const slide = track.querySelector('.review-slide');
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      track.scrollBy({ left: direction * (slide.getBoundingClientRect().width + gap), behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    };
    previous.addEventListener('click', () => scroll(-1));
    next.addEventListener('click', () => scroll(1));
    track.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(track);
    update();
  });
})();

(() => {
  const notice = root.querySelector("#registration-notice");
  const action = root.querySelector('[popovertarget="registration-notice"]');
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

/* Public calendar only: native forms stay owned by GetCourse. */
(() => {
  'use strict';
  const config = JSON.parse(document.getElementById("trainup-premium-article").querySelector("[data-calendar-config]").textContent);
  const root = document.getElementById('trainup-premium-article');
  if (!root || root.dataset.calendarReady) return;
  root.dataset.calendarReady = 'true';
  const stages = config.stages;
  const forms = stages.flatMap(stage => stage.forms);
  const timer = root.querySelector('[data-fixed-timer]');
  const heading = root.querySelector('#trainup-premium-article-pricing-title');
  const promotion = root.querySelector('.pricing-status');
  const status = root.querySelector('[data-calendar-status]');
  const buttons = [...root.querySelectorAll('[data-payment-buy]')];
  const buttonStates = new WeakMap();
  const guardedForms = new WeakSet();
  const money = value => new Intl.NumberFormat('ru-RU').format(value);
  const pad = value => String(value).padStart(2, '0');
  const currentStage = () => stages.find(stage => !stage.until || Date.now() < Date.parse(stage.until));
  const findBlock = item => (item.blockId && document.getElementById('ltBlock' + item.blockId))
    || document.querySelector('[data-code="' + item.popupCode + '"]')
    || document.getElementsByClassName(item.popupCode)[0];
  const announce = text => {
    if (!status) return;
    status.textContent = text;
    status.hidden = !text;
  };
  const isActive = (stage, item) => stage.forms.some(form => form.offerId === item.offerId && form.popupCode === item.popupCode);
  const deadlineLabel = until => {
    const formatter = new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow', day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    });
    let parts = formatter.formatToParts(new Date(until));
    const part = type => parts.find(value => value.type === type).value;
    // An exclusive midnight cutoff is displayed as the last minute of the previous day.
    // Only the label changes; the absolute cutoff and price transitions stay exact.
    if (part('hour') === '00' && part('minute') === '00') {
      parts = formatter.formatToParts(new Date(Date.parse(until) - 60000));
    }
    return 'до ' + part('hour') + ':' + part('minute') + ' ' + part('day') + ' ' + part('month');
  };
  function reconcileForms(stage) {
    for (const item of forms) {
      const block = findBlock(item);
      if (!block) continue;
      for (const form of block.querySelectorAll('form')) {
        if (!guardedForms.has(form)) {
          const guardSubmit = event => {
            const selected = sync();
            if (!isActive(selected, item)) {
              event.preventDefault();
              event.stopImmediatePropagation();
              announce('Цена изменилась. Закройте форму и выберите тариф ещё раз.');
            }
          };
          form.addEventListener('submit', guardSubmit, true);
          // Native liteForm may send directly on button click; check the clock
          // synchronously so a boundary between timer ticks cannot use the old form.
          form.addEventListener('click', event => {
            const submit = event.target.closest?.('button[type="submit"], input[type="submit"]');
            if (submit && form.contains(submit)) guardSubmit(event);
          }, true);
          guardedForms.add(form);
        }
        // GetCourse renders submit disabled and clears it in liteForm.onCreate.
        // Capture the native baseline only after that initialization has completed.
        if (form.matches('form.lt-normal-form') && (typeof window.jQuery !== 'function' || !window.jQuery(form).data('gc-liteForm'))) continue;
        const inactive = !isActive(stage, item);
        for (const button of form.querySelectorAll('button[type="submit"], input[type="submit"]')) {
          let state = buttonStates.get(button);
          if (inactive) {
            if (!state) {
              state = { disabled: button.disabled, disabledClass: button.classList.contains('disabled') };
              buttonStates.set(button, state);
            }
            button.disabled = true;
            button.classList.add('disabled');
          } else if (state) {
            button.disabled = state.disabled;
            button.classList.toggle('disabled', state.disabledClass);
            buttonStates.delete(button);
          }
        }
        let notice = form.querySelector('[data-calendar-stale-notice]');
        if (inactive && !notice) {
          notice = document.createElement('p');
          notice.dataset.calendarStaleNotice = '';
          notice.setAttribute('role', 'status');
          notice.textContent = 'Цена изменилась. Закройте эту форму и выберите тариф ещё раз.';
          form.prepend(notice);
        }
        if (notice) notice.hidden = !inactive;
      }
    }
  }
  function sync() {
    const stage = currentStage();
    const full = !stage.until;
    root.dataset.calendarStage = stage.id;
    if (heading) heading.textContent = full ? 'Стоимость' : 'Специальное предложение';
    if (promotion) promotion.hidden = full;
    stage.forms.forEach((item, index) => {
      const card = root.querySelector('[data-fixed-tariff-card="' + item.tariff + '"]');
      if (card) {
        const current = card.querySelector('[data-fixed-current-price]');
        const old = card.querySelector('[data-fixed-old-price]');
        if (current) current.textContent = money(stage.prices[index]);
        if (old) { old.textContent = money(stage.fullPrices[index]); old.hidden = full; old.parentElement.hidden = full; }
      }
      const button = buttons.find(value => value.dataset.fixedTariff === item.tariff);
      if (button) {
        button.dataset.calendarOffer = item.offerId;
        button.dataset.calendarPopup = item.popupCode;
        if (item.blockId) button.dataset.calendarBlock = item.blockId;
        else delete button.dataset.calendarBlock;
      }
    });
    if (timer) {
      timer.hidden = full;
      timer.dataset.fixedDeadline = stage.until || '';
      if (!full) {
        const remaining = Math.max(0, Math.ceil((Date.parse(stage.until) - Date.now()) / 1000));
        timer.querySelector('[data-fixed-countdown-hours]').textContent = pad(Math.floor(remaining / 3600));
        timer.querySelector('[data-fixed-countdown-minutes]').textContent = pad(Math.floor(remaining / 60) % 60);
        timer.querySelector('[data-fixed-countdown-seconds]').textContent = pad(remaining % 60);
        timer.querySelector('[data-fixed-deadline-date]').textContent = deadlineLabel(stage.until);
      }
    }
    reconcileForms(stage);
    return stage;
  }
  for (const button of buttons) {
    button.addEventListener('click', event => {
      event.preventDefault();
      if (root.dataset.checkoutMode !== 'native') { announce('Это предпросмотр. Заказы не отправляются.'); return; }
      const stage = sync();
      const item = stage.forms.find(form => form.tariff === button.dataset.fixedTariff);
      if (!item || !findBlock(item) || typeof window.ltShowModalBlock !== 'function') {
        announce('Форма ещё загружается. Нажмите «Принять участие» ещё раз.');
        return;
      }
      try {
        window.ltShowModalBlock(item.popupCode);
        announce('');
      } catch (_) {
        announce('Не удалось открыть форму. Нажмите «Принять участие» ещё раз.');
      }
    });
  }
  sync();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true });
  setInterval(sync, 1000);
  window.addEventListener('focus', sync);
  window.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
})();


            (() => {
              const shell = root.querySelector('#trainup-premium-article-leadmagnet');
              if (!shell) return;
              const trigger = shell.querySelector('[data-kinescope-start]');
              if (!trigger) return;
              trigger.addEventListener('click', event => {
                event.preventDefault();
                const touchPlayback = window.matchMedia('(pointer: coarse)').matches
                  || window.matchMedia('(hover: none)').matches
                  || navigator.maxTouchPoints > 0
                  || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                const source = new URL(trigger.href);
                source.searchParams.set('autoplay', touchPlayback ? '0' : '1');
                source.searchParams.set('preload', 'false');
                source.searchParams.set('playsinline', '1');
                source.searchParams.set('autopause', '1');
                source.searchParams.set('muted', '0');
                source.searchParams.set('controls', '1');
                source.searchParams.set('texttrack', 'ru');
                source.searchParams.set('title', '0');
                source.searchParams.set('quality', 'auto');
                source.searchParams.set('t', '0');
                const iframe = document.createElement('iframe');
                iframe.src = source.toString();
                iframe.title = trigger.getAttribute('aria-label') || 'Видео';
                iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
                iframe.allowFullscreen = true;
                iframe.loading = 'eager';
                iframe.referrerPolicy = 'strict-origin-when-cross-origin';
                // Remove the entire cover immediately. Native Play remains accessible
                // if the browser declines autoplay; no parent play(), timers or SDK.
                shell.replaceChildren(iframe);
                iframe.focus({ preventScroll: true });
              }, { once: true });
            })();
            



})();

