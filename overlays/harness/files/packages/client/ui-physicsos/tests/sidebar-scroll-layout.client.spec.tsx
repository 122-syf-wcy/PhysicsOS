import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { RecentSpaces } from '../src/client/RecentSpaces.tsx'
import { SidebarNav } from '../src/client/SidebarNav.tsx'
import { SidebarRoot } from '../../ui-sidebar/src/client/SidebarRoot.tsx'
import css from '../src/client/RecentSpaces.module.css'
import navCss from '../src/client/SidebarNav.module.css'
import shellCss from '../../ui-sidebar/src/client/SidebarRoot.module.css'

it('exports the real recent-space component and styles for browser scroll verification', async () => {
  const items = Array.from({ length: 24 }, (_, index) => ({
    sceneId: `layout-scene-${index}`, title: `测试实验 ${index + 1}`, kind: 'experiment',
    updatedAt: new Date().toISOString(),
  }))
  const ids = Array.from({ length: 8 }, (_, index) => `layout-session-${index}`)
  const sessions = { ids, byId: Object.fromEntries(ids.map((id, index) => [id, {
    id, displayTitle: `测试历史 ${index + 1}`, updatedAt: Date.now() - index,
    blank: false, origin: 'user', retainedBy: { mainView: 0 },
  }])) }
  const props = {
    wide: true,
    useRecentExperiments: (select: any) => select({ items }),
    useSessions: (select: any) => select(sessions),
    useWorkspaces: (select: any) => select({ archivedSessionIds: [] }),
    openSurface() {}, removeRecent() {}, openSession() {}, archiveSession() {},
    t: (key: string) => key === 'recent.title' ? '最近空间' : key === 'recent.sessions' ? '历史对话' : key,
  }
  const shellProps = {
    collapsed: false, width: 300, startSession() {}, toggleSidebar() {}, selectPanel() {},
    usePanels: (select: any) => select([]), useShortcuts: (select: any) => select([]),
    usePanelInfo: (select: any) => select({ activePanelId: null }), t: props.t,
    renderSlot: (name: string) => name === 'sidebar.workspaces' ? <RecentSpaces {...props as any} />
      : name === 'sidebar.nav' ? <SidebarNav {...{ wide: true, openSurface() {}, t: props.t,
        usePhysicsSurface: (select: any) => select({ surface: 'home' }),
        useAuth: (select: any) => select({ user: { role: 'SUPER_ADMIN' } }),
      } as any} />
        : name === 'sidebar.brand.name' ? <span>PhysicsOS</span>
          : name === 'sidebar.footer.action' ? <button style={{ height: 36 }}>平台管理员</button>
            : name === 'sidebar.settings' ? <button style={{ height: 36 }}>设置</button> : null,
  }
  const markup = renderToStaticMarkup(<SidebarRoot {...shellProps as any} />)
  let renderedCss = ''
  for (const [url, classes] of [
    [resolve('packages/client/ui-physicsos/src/client/RecentSpaces.module.css'), css],
    [resolve('packages/client/ui-physicsos/src/client/SidebarNav.module.css'), navCss],
    [resolve('packages/client/ui-sidebar/src/client/SidebarRoot.module.css'), shellCss],
  ] as const) {
    const sourceCss = await readFile(url, 'utf8')
    renderedCss += sourceCss.replace(/\.([a-zA-Z][\w-]*)/g, (all, key: string) => {
      const value = (classes as Record<string, string>)[key]
      return value ? `.${value}` : all
    }).replace(/:global\((\[[^)]*\])\)/g, '$1') + '\n'
  }
  expect(markup).toContain('测试历史 8')
  expect(markup).toContain('测试实验 24')
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body {height:100%;margin:0;overflow:hidden;font:14px sans-serif}
    * {box-sizing:border-box}
    .sidebar {height:100vh;width:300px;background:#f4f4ef;overflow:hidden}
    button {font:inherit}
    ${renderedCss}
  </style></head><body><aside class="sidebar">${markup}</aside></body></html>`
  await writeFile(process.env.PHYSICSOS_LAYOUT_FIXTURE_FILE ?? '/tmp/physicsos-sidebar-scroll-fixture.html', html)
})
// @vitest-environment jsdom
