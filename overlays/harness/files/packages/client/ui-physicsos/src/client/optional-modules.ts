/** Independent factory artifacts; native imports below are source/test fallbacks only. */
declare const __PHYSICSOS_OPTIONAL_BUNDLES__: boolean
const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-physicsos'

async function importFactory<T>(file: string): Promise<T> {
  const loader = (window as unknown as {
    __ModuleLoader__?: { importChunk?: (id: string, file: string) => Promise<unknown> }
  }).__ModuleLoader__
  if (loader?.importChunk === undefined) throw new Error('当前客户端无法加载可选功能，请刷新页面。')
  return await loader.importChunk(PLUGIN_ID, file) as T
}

export function loadWorkspaceModule(): Promise<typeof import('./optional/workspace.ts')> {
  if (typeof __PHYSICSOS_OPTIONAL_BUNDLES__ !== 'undefined' && __PHYSICSOS_OPTIONAL_BUNDLES__) return importFactory('optional-workspace.js')
  return import('./optional/workspace.ts')
}
export function loadAdminModule(): Promise<typeof import('./optional/admin.ts')> {
  if (typeof __PHYSICSOS_OPTIONAL_BUNDLES__ !== 'undefined' && __PHYSICSOS_OPTIONAL_BUNDLES__) return importFactory('optional-admin.js')
  return import('./optional/admin.ts')
}
export function loadPdfModule(): Promise<typeof import('./optional/pdf.ts')> {
  if (typeof __PHYSICSOS_OPTIONAL_BUNDLES__ !== 'undefined' && __PHYSICSOS_OPTIONAL_BUNDLES__) return importFactory('optional-pdf.js')
  return import('./optional/pdf.ts')
}
