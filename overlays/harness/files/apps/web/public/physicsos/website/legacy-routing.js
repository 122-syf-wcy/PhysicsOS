// Hand established app links on the website to the original system root.
(() => {
  if (location.pathname !== '/') return;
  const hash = location.hash;
  const appRoute = /^#\/(?:experiments|contribute)(?:[/?]|$)/.test(hash);
  if (appRoute || hash.startsWith('#reset_token=')) {
    location.replace(`https://physics.dongsiwei.com/${location.search}${hash}`);
  }
})();
