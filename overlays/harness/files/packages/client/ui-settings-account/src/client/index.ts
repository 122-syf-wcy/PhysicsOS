/** Keep the desktop account implementation outside the ordinary browser entry. */
import type { Context } from '@deepseek-ai/cordis'

export type {
  AccountSectionInjected, AccountSectionProps, AccountMenuProps, AccountSnapshot, AccountKey,
} from './desktop-account.ts'

declare const __DSH_DESKTOP_ACCOUNT_BUNDLE__: boolean
declare const __DSH_DESKTOP_ACCOUNT_REVISION__: string

/** Retained in the entry so desktop-only edits also invalidate optional-resource URLs. */
export const desktopBuildRevision = typeof __DSH_DESKTOP_ACCOUNT_REVISION__ === 'undefined'
  ? 'source'
  : __DSH_DESKTOP_ACCOUNT_REVISION__

/** Services required by the original desktop account implementation. */
export const inject = ['slots', 'locale', 'remote', 'remote.account', 'remote.session', 'theme', 'configForms']

function importDesktopAccountFactory(): Promise<typeof import('./desktop-account.ts')> {
  const loader = (window as unknown as {
    __ModuleLoader__?: { importChunk?: (pluginId: string, file: string) => Promise<unknown> }
  }).__ModuleLoader__
  if (loader?.importChunk === undefined) {
    return Promise.reject(new Error('Desktop account features require the client module loader.'))
  }
  return loader.importChunk('@deepseek-ai/dsh-client-ui-settings-account', 'optional-desktop-account.js') as Promise<typeof import('./desktop-account.ts')>
}

function loadDesktopAccount(): Promise<typeof import('./desktop-account.ts')> {
  if (typeof __DSH_DESKTOP_ACCOUNT_BUNDLE__ !== 'undefined' && __DSH_DESKTOP_ACCOUNT_BUNDLE__) return importDesktopAccountFactory()
  return import('./desktop-account.ts')
}

/** Preserve the existing desktop guard before requesting any account UI code. */
export function apply(ctx: Context): void | Promise<void> {
  if (!('dshDesktop' in globalThis)) return
  return loadDesktopAccount().then((desktop) => {
    // Cordis marks a disposed fiber immediately, before waiting for this
    // activation promise. Do not install account effects into that old scope.
    if (ctx.fiber.uid === null) return
    desktop.apply(ctx)
  })
}
