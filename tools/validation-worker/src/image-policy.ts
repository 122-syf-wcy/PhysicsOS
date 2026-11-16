/**
 * Validation-only, credential-free image fetch policy. The candidate bytes and
 * its URLs are untouched: eligible first image loads use standard anonymous
 * CORS, so the asset server must explicitly allow the opaque ('null') origin.
 *
 * This is an instrumented validation environment, not a claim that the same
 * renderer is untainted without the policy. Browser/sandbox security stays on.
 */
export function anonymousImagePolicyScript(entryOrigin: string): string {
  const origin = new URL(entryOrigin)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== entryOrigin) throw new Error('Invalid candidate image origin')
  return String.raw`(() => {
    const allowedOrigin = ${JSON.stringify(entryOrigin)};
    const proto = HTMLImageElement.prototype;
    const src = Object.getOwnPropertyDescriptor(proto, 'src');
    const cors = Object.getOwnPropertyDescriptor(proto, 'crossOrigin');
    if (!src?.set || !cors?.set) return;
    const firstLoads = new WeakSet(), anonymousImages = new WeakSet();
    const prepare = (image, value) => {
      if (firstLoads.has(image)) return;
      firstLoads.add(image);
      let url;
      try { url = new URL(String(value), document.baseURI); } catch { return; }
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== allowedOrigin) return;
      anonymousImages.add(image);
      // new Image() instances also use this HTMLImageElement src setter.
      // Set the fetch mode BEFORE the native setter starts loading; do not
      // change the URL, response, pixels, cookies or engine facts.
      cors.set.call(image, 'anonymous');
    };
    const rejectCredentials = (image, value) => {
      if (anonymousImages.has(image) && String(value).toLowerCase() === 'use-credentials') throw new Error('Credentialed images are unsupported in validation');
    };
    Object.defineProperty(proto, 'src', { ...src, set(value) { prepare(this, value); src.set.call(this, value); } });
    Object.defineProperty(proto, 'crossOrigin', { ...cors, set(value) { rejectCredentials(this, value); cors.set.call(this, value); } });
    const setAttribute = Element.prototype.setAttribute;
    Object.defineProperty(proto, 'setAttribute', { configurable: true, writable: true, value(name, value) {
      const attribute = String(name).toLowerCase();
      if (attribute === 'src') prepare(this, value);
      if (attribute === 'crossorigin') rejectCredentials(this, value);
      return setAttribute.call(this, name, value);
    } });
  })();`
}
