(() => {
  'use strict';
  const config = window.__IIK_CONSENT_CONFIG__ || {};
  const key = config.preferenceKey || 'consent-choice-unconfigured';
  const version = config.consentVersion || 'unconfigured';
  const lifetime = 180 * 86400000;
  const checkbox = document.querySelector('#channel-consent');
  const dialog = document.querySelector('#cookie-settings');
  const list = document.querySelector('[data-cookie-list]');
  const notice = document.querySelector('[data-consent-notice]');
  let rows = [
    ['essential', 'Ваш выбор cookie', 'Обязательные', 'localStorage · только настройки и их версия, до 180 дней. Без рекламных идентификаторов.'],
    ['serviceIds', 'ID пользователя в Telegram или ВК', 'Работа бота · обязательно', 'Бот получает ID после запуска диалога в выбранном мессенджере, чтобы отправлять вам ответы. На этой странице ID не собирается. Это данные работы бота, а не cookie аналитики.'],
    ['uid', '_ym_uid', 'Аналитика', 'Различает браузеры посетителей для статистики. До 1 года.'],
    ['date', '_ym_d', 'Аналитика', 'Хранит дату первого посещения. До 1 года.'],
    ['enabled', '_ym_metrika_enabled', 'Аналитика', 'Проверяет работу cookies Метрики. До 60 минут.'],
    ['isad', '_ym_isad', 'Аналитика', 'Определяет наличие блокировщика рекламы. До 20 часов.'],
    ['fa', '_ym_fa', 'Аналитика', 'Вспомогательный идентификатор Метрики вместе с _ym_uid.'],
    ['host', '_ym_hostIndex', 'Аналитика', 'Ограничивает повторные запросы Метрики. До 1 суток.'],
    ['storage', 'Хранилище Метрики', 'Аналитика', 'localStorage: _ym_uid и _ym_retryReqs. Идентификатор браузера и повторная отправка запросов.'],
    ['vendorVisit', 'yabs-sid', 'Яндекс', 'Идентификатор визита на стороне Яндекса; на время сессии браузера.'],
    ['vendorAux', 'ymex', 'Яндекс', 'Вспомогательные сведения об идентификаторах Метрики; до 1 года.'],
    ['vendorUid', 'yandexuid', 'Яндекс', 'Идентификатор браузера на стороне Яндекса.'],
    ['vendorSecure', 'yuidss', 'Яндекс', 'Идентификатор браузера для взаимодействия с сервисами Яндекса.'],
    ['vendorI', 'i', 'Яндекс', 'Дополнительный идентификатор в технологиях Яндекса.'],
    ['vendorBh', 'bh', 'Яндекс', 'Дополнительный cookie Яндекса, наблюдавшийся при работе Метрики. Отключается вместе со счётчиком.'],
    ['vendorAsc', '_yasc', 'Яндекс', 'Дополнительный cookie Яндекса, наблюдавшийся при работе Метрики. Отключается вместе со счётчиком.'],
    ['vendorSync', 'sync_cookie_csrf', 'Яндекс', 'Защита обмена при синхронизации cookies Яндекса.'],
    ['vendorSyncSecondary', 'sync_cookie_csrf_secondary', 'Яндекс', 'Защита дополнительного обмена при синхронизации cookies.'],
    ['vendorSyncOk', 'sync_cookie_ok_secondary', 'Яндекс', 'Результат дополнительной синхронизации cookies Яндекса. Отключается вместе со счётчиком.'],
    ['visor', '_ym_visorc / _ym_visorc_*', 'Вебвизор', 'Запись взаимодействий со страницей. Cookie сеанса до 30 минут.'],
  ];
  if (!config.serviceIdsEnabled) rows = rows.filter(([id]) => id !== 'serviceIds');
  if (!(config.counterId > 0)) rows = rows.filter(([id]) => ['essential', 'serviceIds'].includes(id));
  const required = new Set(['essential', 'serviceIds']);
  const optional = rows.filter(([id]) => !required.has(id)).map(([id]) => id);
  const core = optional.filter(id => !['visor', 'attribution'].includes(id));
  const defaults = value => Object.fromEntries(optional.map(id => [id, value]));
  let choice = null;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved?.version === version && typeof saved.approved === 'boolean' && Number.isFinite(saved.at) && saved.at <= Date.now() && Date.now() - saved.at < lifetime &&
        optional.every(id => typeof saved.options?.[id] === 'boolean')) choice = saved;
    else if (saved !== null) localStorage.removeItem(key);
  } catch { /* A storage failure leaves everything optional disabled. */ }
  let draft = defaults(true);
  let noticeTimer, expiryTimer;
  const subscribers = new Set();
  const currentPermissions = () => ({
    decided: choice?.approved === true,
    withdrawn: choice?.approved === false,
    analytics: config.counterId > 0 && choice?.approved === true && core.every(id => choice.options[id]),
    webvisor: config.counterId > 0 && choice?.approved === true && core.every(id => choice.options[id]) && choice.options.visor,
    attribution: choice?.approved === true && choice.options.attribution === true,
  });
  const hideNotice = () => {
    clearTimeout(noticeTimer); notice.hidden = true; checkbox.removeAttribute('aria-invalid');
  };
  const syncCheckbox = () => {
    const approved = choice?.approved === true;
    const all = approved && optional.every(id => choice.options[id]);
    checkbox.checked = all;
    checkbox.indeterminate = approved && !all;
  };
  const notify = reason => {
    for (const callback of subscribers) { try { callback(currentPermissions(), reason); } catch { /* Never block navigation. */ } }
  };
  const checkExpiry = () => {
    if (!choice) return;
    const age = Date.now() - choice.at;
    if (age >= 0 && age < lifetime) return;
    choice = null;
    clearTimeout(expiryTimer);
    try { localStorage.removeItem(key); } catch { /* The in-memory choice still expires. */ }
    syncCheckbox(); hideNotice(); notify('expired');
  };
  const scheduleExpiry = () => {
    clearTimeout(expiryTimer);
    if (!choice) return;
    // Browser timers cannot represent 180 days in a single signed 32-bit delay.
    expiryTimer = setTimeout(() => { checkExpiry(); scheduleExpiry(); },
      Math.min(2147483647, Math.max(1, choice.at + lifetime - Date.now())));
  };
  const permissions = () => { checkExpiry(); return currentPermissions(); };
  const commit = (options, approved = true) => {
    choice = { version, at: Date.now(), approved, options: { ...options } };
    try { localStorage.setItem(key, JSON.stringify(choice)); } catch { /* Choice still applies in this visit. */ }
    syncCheckbox(); hideNotice();
    scheduleExpiry(); notify('choice');
  };
  for (const [id, title, , description] of rows) {
    const label = document.createElement('label'); label.className = 'cookie-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.cookie = id;
    input.checked = true; input.disabled = required.has(id); input.setAttribute('aria-label', title);
    input.addEventListener('change', () => { if (!required.has(id)) draft[id] = input.checked; });
    const text = document.createElement('span'); text.className = 'cookie-option__text';
    const heading = document.createElement('span'); heading.className = 'cookie-option__title'; heading.textContent = title;
    const detail = document.createElement('span'); detail.className = 'cookie-option__description'; detail.textContent = description;
    text.append(heading, detail); label.append(input, text); list.append(label);
  }
  let opener;
  document.querySelector('[data-cookie-settings]').addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation(); checkExpiry(); hideNotice(); opener = event.currentTarget;
    // Reopen the saved selection; precheck all options only before a first choice.
    draft = { ...(choice?.options || defaults(true)) };
    for (const input of list.querySelectorAll('input:not([disabled])')) input.checked = draft[input.dataset.cookie];
    dialog.showModal();
  });
  const close = () => { dialog.close(); opener?.focus({preventScroll:true}); };
  document.querySelector('[data-cookie-close]').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close();
  } });
  document.querySelector('[data-cookie-accept]').addEventListener('click', () => { close(); commit(defaults(true)); });
  document.querySelector('[data-cookie-save]').addEventListener('click', () => { close(); commit({ ...draft }); });
  // A click on the mixed state accepts all; the next click withdraws confirmation.
  // The main control always restores default options; Save applies a custom choice.
  checkbox.addEventListener('change', () => commit(defaults(true), checkbox.checked));
  syncCheckbox(); scheduleExpiry();
  window.addEventListener('pageshow', checkExpiry);
  window.addEventListener('focus', checkExpiry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkExpiry(); });
  window.addEventListener('storage', event => {
    if (event.key === key) window.location.reload();
  });
  window.iikConsent = Object.freeze({
    version,
    permissions,
    snapshot: () => { checkExpiry(); return choice ? JSON.parse(JSON.stringify(choice)) : null; },
    subscribe(callback) { subscribers.add(callback); callback(permissions()); },
    request(link) {
      clearTimeout(noticeTimer); checkbox.setAttribute('aria-invalid','true'); notice.hidden = false;
      link.classList.remove('is-shaking'); void link.offsetWidth; link.classList.add('is-shaking');
      checkbox.focus({preventScroll:true}); noticeTimer = setTimeout(hideNotice,5000);
    },
  });
})();
