// Only images near the scroll viewport receive a URL. Pagination bounds the
// number of cards; this bounds thumbnail requests within each loaded page.
export function observeThumbnails(container, { root = null } = {}) {
  let active = true;
  const images = container.querySelectorAll("img[data-src]");
  const observer = images.length
    ? new IntersectionObserver(
        (entries) => {
          if (!active) return;
          for (const { target: img, isIntersecting } of entries) {
            if (!isIntersecting) continue;
            observer.unobserve(img);
            if (!container.contains(img) || !img.dataset.src) continue;
            img.addEventListener("error", () => img.remove(), { once: true });
            img.src = img.dataset.src;
            delete img.dataset.src;
          }
        },
        { root, rootMargin: "160px 0px" },
      )
    : null;
  images.forEach((img) => observer.observe(img));
  return {
    disconnect() {
      active = false;
      observer?.disconnect();
    },
  };
}
