(() => {
  'use strict';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('[data-reviews-gallery]').forEach((gallery) => {
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
