(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  document.querySelectorAll("[data-reviews-gallery]").forEach((gallery) => {
    const track = gallery.querySelector("[data-reviews-track]");
    const section = gallery.closest("[data-section-id]");
    const previous = section?.querySelector("[data-reviews-prev]");
    const next = section?.querySelector("[data-reviews-next]");
    if (!track || !previous || !next) return;

    const getScrollStep = () => {
      const slide = track.querySelector(".review-slide");
      if (!slide) return track.clientWidth * 0.8;
      const styles = window.getComputedStyle(track);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "0");
      return slide.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
    };

    const updateControls = () => {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      previous.disabled = track.scrollLeft <= 2;
      next.disabled = track.scrollLeft >= maxScroll - 2;
    };

    previous.addEventListener("click", () => {
      track.scrollBy({ left: -getScrollStep(), behavior: reducedMotion.matches ? "auto" : "smooth" });
    });
    next.addEventListener("click", () => {
      track.scrollBy({ left: getScrollStep(), behavior: reducedMotion.matches ? "auto" : "smooth" });
    });
    track.addEventListener("scroll", updateControls, { passive: true });

    if ("ResizeObserver" in window) new ResizeObserver(updateControls).observe(track);
    else window.addEventListener("resize", updateControls, { passive: true });
    updateControls();
  });
})();
