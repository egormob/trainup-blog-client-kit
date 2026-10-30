(() => {
  'use strict';
  const shell = document.querySelector('#leadmagnet');
  if (!shell) return;
  const mount = shell.querySelector('[data-leadmagnet-mount]');
  const loading = shell.querySelector('[data-leadmagnet-loading]');
  const error = shell.querySelector('[data-leadmagnet-error]');
  const retry = shell.querySelector('[data-leadmagnet-retry]');
  const trigger = shell.querySelector('[data-leadmagnet-start]');
  const placeholder = shell.querySelector('[data-leadmagnet-placeholder]');
  const videoUrl = shell.dataset.videoUrl?.trim();
  const configured = /^https:\/\/kinescope\.io\/embed\/(?:pl\/)?[a-zA-Z0-9-]+$/.test(videoUrl || '');
  // This manually maintained outline is the single source for both selectors.
  const outlineButtons = [...document.querySelectorAll('[data-course-outline] [data-course-video]')];
  const shortcuts = document.querySelector('[data-course-shortcuts]');
  if (shortcuts && outlineButtons.length) {
    outlineButtons.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lesson-shortcut';
      button.dataset.courseVideo = item.dataset.courseVideo;
      button.setAttribute('aria-controls', shell.id);
      const title = item.querySelector('.course-video-title').textContent;
      const duration = item.querySelector('.course-video-duration');
      button.setAttribute('aria-label', `Видео ${index + 1}: ${title}. ${duration.getAttribute('aria-label')}`);
      button.title = `${title} · ${duration.textContent}`;
      const image = document.createElement('img');
      image.src = item.dataset.coursePoster;
      image.alt = '';
      image.width = 320;
      image.height = 180;
      image.decoding = 'async';
      button.append(image);
      shortcuts.append(button);
    });
  }
  const lessonButtons = [...document.querySelectorAll('[data-course-video]')];
  let requestedVideoId = outlineButtons[0]?.dataset.courseVideo;
  let hasPendingSelection = true;
  let selectionPromise;
  let apiPromise;
  let player;
  let bindings = [];
  let attempt = 0;
  let readyTimer;
  let selectionTimer;
  let detachTracking = () => {};
  // The native player can legitimately need over 30s on a cold 400 Kbit/s connection.
  const playerReadyTimeout = 90000;

  function setState(state) {
    shell.dataset.state = state;
    shell.setAttribute('aria-busy', String(state === 'loading'));
    loading.hidden = state !== 'loading';
    error.hidden = state !== 'error';
    retry.disabled = state !== 'error';
    trigger.hidden = state !== 'idle';
    trigger.disabled = state !== 'idle';
    placeholder.hidden = state !== 'unconfigured';
    mount.inert = state !== 'ready';
    mount.setAttribute('aria-hidden', String(state !== 'ready'));
    lessonButtons.forEach(button => { button.disabled = !configured; });
  }

  function destroy(instance) {
    if (instance) Promise.resolve(instance.destroy()).catch(() => {});
  }

  function fail(version, code = 'player_error') {
    if (version !== attempt) return;
    window.TrainUpFunnel?.error(code);
    ++attempt; // Late messages from a failed attempt must not hide the retry screen.
    clearTimeout(readyTimer);
    clearTimeout(selectionTimer);
    const restoreFocus = shell.contains(document.activeElement);
    detachTracking();
    detachTracking = () => {};
    bindings.forEach(([event, handler]) => player.off(event, handler));
    bindings = [];
    destroy(player);
    player = null;
    selectionPromise = null;
    hasPendingSelection = true;
    mount.replaceChildren();
    setState('error');
    if (restoreFocus) retry.focus({ preventScroll: true });
  }

  function syncLesson(id) {
    lessonButtons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.courseVideo === id));
    });
  }

  function switchRequested() {
    if (selectionPromise) return selectionPromise;
    if (!player || !requestedVideoId) return Promise.resolve();
    const version = attempt;
    const instance = player;
    selectionTimer = setTimeout(() => fail(version, 'playlist_selection_timeout'), playerReadyTimeout);
    selectionPromise = (async () => {
      let id;
      do {
        id = requestedVideoId;
        const current = await instance.getPlaylistItem();
        if (version !== attempt) return;
        try {
          if (current?.id === id) {
            await instance.seekTo(0);
            await instance.play();
          } else {
            await instance.switchTo(id, { autoPlay: true, time: 0 });
          }
        } catch (error) {
          // A browser permission refusal leaves native Play available.
          if (error?.name !== 'NotAllowedError' ||
              (await instance.getPlaylistItem())?.id !== id) throw error;
        }
      } while (version === attempt && id !== requestedVideoId);
      if (version !== attempt) return;
      hasPendingSelection = false;
      syncLesson(id);
    })().catch(() => fail(version, 'playlist_selection_error')).finally(() => {
      if (version === attempt) { clearTimeout(selectionTimer); selectionPromise = null; }
    });
    return selectionPromise;
  }

  function chooseVideo(id) {
    if (!configured) return;
    requestedVideoId = id;
    hasPendingSelection = true;
    syncLesson(id);
    shell.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    if (shell.dataset.state === 'ready') switchRequested();
    else start(true);
  }

  function loadApi() {
    if (window.Kinescope?.IframePlayer) return Promise.resolve(window.Kinescope.IframePlayer);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const handlers = window.KinescopeIframeApiReadyHandlers ||= [];
      const cleanup = () => {
        clearTimeout(timer);
        const index = handlers.indexOf(ready);
        if (index !== -1) handlers.splice(index, 1);
        script.remove();
      };
      const ready = () => {
        const factory = window.Kinescope?.IframePlayer;
        if (!factory) return;
        cleanup();
        resolve(factory);
      };
      const failed = () => { cleanup(); reject(new Error('Kinescope API unavailable')); };
      const timer = setTimeout(failed, 20000);
      handlers.push(ready);
      script.src = 'https://player.kinescope.io/latest/iframe.player.js';
      script.async = true;
      script.onload = ready;
      script.onerror = failed;
      document.head.append(script);
    }).catch(error => { apiPromise = null; throw error; });
    return apiPromise;
  }

  async function start(focusPlayer = false) {
    if (!configured) return;
    if (shell.dataset.state === 'loading' || shell.dataset.state === 'ready') return;
    const version = ++attempt;
    hasPendingSelection = true;
    setState('loading');
    window.TrainUpFunnel?.load(version);
    if (focusPlayer) shell.focus({ preventScroll: true });
    try {
      const factory = await loadApi();
      if (version !== attempt) return;
      const target = document.createElement('div');
      target.id = `leadmagnet-player-${version}`;
      mount.replaceChildren(target);
      readyTimer = setTimeout(() => fail(version, 'ready_timeout'), playerReadyTimeout);
      const instance = await factory.create(target.id, {
        url: videoUrl,
        timeout: playerReadyTimeout,
        size: { width: '100%', height: '100%' },
        behavior: {
          preload: 'metadata', autoPlay: !outlineButtons.length, muted: false, loop: false,
          // Reuse PLF's native iOS video fullscreen; the SDK owns the controls.
          keyboard: true, playsInline: true, fullscreenFallback: 'video', textTrack: true,
          playlist: { autoSwitch: true, loop: false },
        },
        ui: { autoSwitchButton: false, language: 'ru', controls: true, mainPlayButton: true },
      });
      if (version !== attempt) { destroy(instance); return; }
      player = instance;
      detachTracking = window.TrainUpLeadmagnetAnalytics?.bindPlayer(instance) || (() => {});
      const iframe = mount.querySelector('iframe');
      iframe.title = `${document.querySelector('[data-section-id="title"]').textContent.trim()} — ${outlineButtons.length ? 'видеосерия' : 'видео'}`;
      iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write');
      iframe.setAttribute('allowfullscreen', '');
      let firstLoaded = false;
      const ready = () => {
        if (version !== attempt) return;
        clearTimeout(readyTimer);
        setState('ready');
        window.TrainUpFunnel?.ready();
        if (focusPlayer && document.activeElement === shell) iframe.focus({ preventScroll: true });
      };
      const loaded = () => {
        if (version !== attempt || firstLoaded) return;
        firstLoaded = true;
        // Metadata may load for E01, but only the requested episode starts playing.
        switchRequested().then(ready);
      };
      const trackChanged = ({ data }) => {
        if (version !== attempt || hasPendingSelection || !data?.item?.id) return;
        requestedVideoId = data.item.id;
        syncLesson(requestedVideoId);
      };
      bindings = [
        [instance.Events.Loaded, loaded],
        [instance.Events.CurrentTrackChanged, trackChanged],
        [instance.Events.Error, () => fail(version)],
      ];
      bindings.forEach(([event, handler]) => instance.on(event, handler));
      // create() and iframe.onload do not mean that the native Play button is ready.
    } catch { fail(version, player ? 'player_error' : 'sdk_or_create_error'); }
  }

  lessonButtons.forEach(button => button.addEventListener('click', () => chooseVideo(button.dataset.courseVideo)));
  syncLesson(requestedVideoId);
  retry.addEventListener('click', () => start(true));
  trigger.addEventListener('click', () => start(true));
  // First-screen media: visibility is not a loading trigger. No SDK/iframe until intent.
  setState(configured ? 'idle' : 'unconfigured');
  const scriptFallback = shell.querySelector('[data-player-fallback]');
  if (scriptFallback) scriptFallback.hidden = true;
})();
