// Preserve established app links when the root path serves the public website.
(() => {
  if (location.pathname !== '/') return;
  const hash = location.hash;
  const appRoute = /^#\/(?:experiments|contribute)(?:[/?]|$)/.test(hash);
  if (appRoute || hash.startsWith('#reset_token=')) {
    location.replace(`/app${location.search}${hash}`);
  }
})();
