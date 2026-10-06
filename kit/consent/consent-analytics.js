(() => {
  'use strict';

  const config = window.__IIK_CONSENT_CONFIG__ || {};
  const counterId = Number.isSafeInteger(config.counterId) && config.counterId > 0 ? config.counterId : 0;
  const consent = window.iikConsent;
  let metricaStarted = false;
  let metricaOptions;
  window['disableYaCounter' + counterId] = true;
  const goal = (name, params = {}) => {
    if (!consent?.permissions().analytics) return;
    try { if (typeof window.ym === 'function') window.ym(counterId, 'reachGoal', name, params); }
    catch { /* Analytics must not affect navigation. */ }
  };
  const clearFirstPartyMetrica = () => {
    try {
      const names = (document.cookie || '').split(';').map(part => part.trim().split('=')[0]).filter(name => /^_ym/.test(name));
      const host = window.location.hostname || '';
      const domains = host && !/^[\d.]+$/.test(host) ? host.split('.').map((_, index, parts) => parts.slice(index).join('.')).filter(value => value.includes('.')) : [];
      for (const name of names) {
        document.cookie = name + '=; Max-Age=0; Path=/';
        for (const domain of domains) document.cookie = name + '=; Max-Age=0; Path=/; Domain=' + domain;
      }
      const storage = window.localStorage;
      for (let index = (storage?.length || 0)-1; index >= 0; index--) {
        const name = storage.key(index);
        if (name && /^_ym/.test(name)) storage.removeItem(name);
      }
    } catch { /* Vendor-domain cookies and server records require a separate deletion procedure. */ }
  };
  const startMetrica = permissions => {
    window['disableYaCounter' + counterId] = false;
    if (typeof window.ym !== 'function') {
      const queued = function () { (queued.a = queued.a || []).push(arguments); };
      queued.l = Date.now(); window.ym = queued;
    }
    metricaStarted = true; metricaOptions = permissions;
    try {
      window.ym(counterId, 'init', {
        clickmap: true, trackLinks: true, accurateTrackBounce: true,
        webvisor: permissions.webvisor, triggerEvent: true, disableYtm: true,
        params: { consent_version: consent.version, landing_mode: config.mode || 'candidate' },
      });
    } catch { /* Links remain usable. */ }
    if (!document.querySelector('script[src="https://mc.yandex.ru/metrika/tag.js"]')) {
      const script = document.createElement('script'); script.src = 'https://mc.yandex.ru/metrika/tag.js';
      script.async = true; document.head.append(script);
    }
    goal(config.readyGoal);

  };

  const buttons = [...document.querySelectorAll('[data-channel], [data-consent-cta]')];
  for (const link of buttons) {
    link.addEventListener('click', event => {
      if (!config.subscriptionIndependent && !consent?.permissions().decided) {
        event.preventDefault(); consent?.request(link); return;
      }
      goal(config.buttonGoal, { channel: link.dataset.channel || link.dataset.consentCta });
    });
    link.addEventListener('auxclick', event => {
      if (event.button !== 1) return;
      if (!config.subscriptionIndependent && !consent?.permissions().decided) { event.preventDefault(); consent?.request(link); }
      else goal(config.buttonGoal, { channel: link.dataset.channel || link.dataset.consentCta });
    });
  }
  consent?.subscribe((permissions, reason) => {
    if (!permissions.analytics) clearFirstPartyMetrica();
    if (metricaStarted && (!permissions.analytics || permissions.webvisor !== metricaOptions.webvisor)) {
      window['disableYaCounter' + counterId] = true;
      if (reason === 'expired') {
        // Expiry may be noticed during a native link click: do not reload it.
        try { window.ym(counterId, 'destruct'); } catch { /* Disabled flag remains set. */ }
        metricaStarted = false;
        return;
      }
      // Persisted choice is read before any tracker on the next document.
      window.location.reload(); return;
    }
    if (permissions.analytics && !metricaStarted) startMetrica(permissions);
  });

})();
