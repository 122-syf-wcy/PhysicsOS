/** Document-level PhysicsOS chrome: focus ring + thin scrollbar. */

const PHYSICSOS_CHROME_CSS = `
:root {
  --physicsos-focus: var(--dsw-static-blue-500, #3b82f6);
  --physics-workspace-bg: #f3f6fa;
  --physics-glass-fill: rgba(255, 255, 255, 0.68);
  --physics-glass-fill-strong: rgba(255, 255, 255, 0.82);
  --physics-glass-border: rgba(255, 255, 255, 0.84);
  --physics-glass-border-soft: rgba(148, 173, 199, 0.34);
  --physics-glass-shadow: 0 16px 36px rgba(65, 93, 122, 0.1);
}
*:focus {
  outline: none;
}
*:focus-visible {
  outline: 2px solid var(--physicsos-focus);
  outline-offset: 2px;
}
textarea:focus,
input:focus,
button:focus,
[role='button']:focus,
[role='menuitem']:focus {
  outline: none;
}
textarea:focus-visible,
input:focus-visible,
button:focus-visible,
[role='button']:focus-visible,
[role='menuitem']:focus-visible {
  outline: 2px solid var(--physicsos-focus);
  outline-offset: 2px;
}

body {
  --dsh-scrollbar-thumb: rgba(15, 23, 42, 0.16);
  --dsh-scrollbar-thumb-hover: rgba(15, 23, 42, 0.28);
  --dsh-scrollbar-width: 6px;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  border-radius: 999px;
}
`

/** Install PhysicsOS focus / scrollbar overrides for the Web Client lifetime. */
export function mountPhysicsOSChrome(): () => void {
  const previous = document.head.querySelector('style[data-physicsos-chrome]')
  previous?.remove()
  const style = document.createElement('style')
  style.setAttribute('data-physicsos-chrome', '')
  style.textContent = PHYSICSOS_CHROME_CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
