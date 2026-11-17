// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SidebarNav, type SidebarNavProps } from '../src/client/SidebarNav.tsx'
import { RecentSpaces } from '../src/client/RecentSpaces.tsx'
import { zh } from '../src/client/locales.ts'
const translations: Readonly<Record<string, string>> = zh
const t: TranslateNS<'physicsos'> = key => translations[key] ?? key
const unusedRuntimeHook = (): never => { throw new Error('unexpected runtime hook read in sidebar navigation fixture') }
const unusedRuntimeProps = {
 usePanelInfo: unusedRuntimeHook,
 useSessions: unusedRuntimeHook,
 useSessionStatus: unusedRuntimeHook,
 useSessionRetainInfo: unusedRuntimeHook,
 useWorkspaces: unusedRuntimeHook,
 useResource: unusedRuntimeHook,
} satisfies Pick<SidebarNavProps, 'usePanelInfo' | 'useSessions' | 'useSessionStatus' | 'useSessionRetainInfo' | 'useWorkspaces' | 'useResource'>
afterEach(() => { cleanup(); localStorage.clear() })
it('offers a chapter project entry beside experiments in student navigation', () => {
 const open = vi.fn()
 const view=render(<SidebarNav {...{wide:true,openSurface:open,t,usePhysicsSurface:(f:any)=>f({surface:'home'}),useAuth:(f:any)=>f({user:{role:'STUDENT'}})} as any} />)
 fireEvent.click(view.getByRole('button',{name:'项目'}))
 expect(open).toHaveBeenCalledWith('projects')
})
it.each(['STUDENT', 'TEACHER', 'SCHOOL_ADMIN', 'SUPER_ADMIN'] as const)('removes the resource entry from the rail and More menu for %s', role => {
 const openSurface = vi.fn()
 const props = {
  ...unusedRuntimeProps,
  wide: true,
  t,
  openSurface,
  usePhysicsSurface: selector => selector({ surface: 'home' }),
  useAuth: selector => selector({ status: 'authed', user: { id: 'nav-user', schoolId: 'nav-school', schoolName: 'School', username: 'student', displayName: 'Student', role } }),
 } satisfies SidebarNavProps
 const view = render(<SidebarNav {...props} />)
 expect(view.queryByRole('button', { name: '资源库' })).toBeNull()
 expect(view.queryByText('资源库')).toBeNull()
 expect(view.queryByRole('button', { name: zh['nav.paper'] })).toBeNull()
 expect(view.getAllByRole('button')).toHaveLength(6)
 expect(view.getByRole('button', { name: zh['nav.courseware'] })).toBeTruthy()
 fireEvent.click(view.getByRole('button', { name: zh['nav.more'] }))
 expect(view.queryByRole('menuitem', { name: zh['nav.paper'] }) !== null).toBe(role !== 'STUDENT')
 expect(view.getByRole('menuitem', { name: zh['whiteboard.title'] })).toBeTruthy()
 expect(view.queryByRole('menuitem', { name: '资源库' })).toBeNull()
 expect(view.getByRole('menuitem', { name: zh['nav.contribute'] })).toBeTruthy()
 fireEvent.click(view.getByRole('menuitem', { name: zh['nav.notice'] }))
 expect(openSurface).toHaveBeenCalledWith('notice')
 expect(openSurface).not.toHaveBeenCalledWith('library')
})
it('folds recent experiments and history independently and remembers both', () => {
 const props={wide:true,t,useRecentExperiments:(f:any)=>f({items:[{sceneId:'scene1',title:'动量实验',kind:'experiment',updatedAt:new Date().toISOString()}]}),useSessions:(f:any)=>f({ids:['session1'],byId:{session1:{id:'session1',displayTitle:'碰撞题思路',updatedAt:1,blank:false,origin:'user',retainedBy:{mainView:0}}}}),useWorkspaces:(f:any)=>f({archivedSessionIds:[]}),openSurface:vi.fn(),removeRecent:vi.fn(),requestSceneInCanvas:vi.fn(),openSession:vi.fn(),archiveSession:vi.fn()}
 const view=render(<RecentSpaces {...props as any} />)
 fireEvent.click(view.getByRole('button',{name:/收起.*最近/}))
 expect(view.queryByText('动量实验')).toBeNull()
 expect(view.getByText('碰撞题思路')).toBeTruthy()
 fireEvent.click(view.getByRole('button',{name:/收起.*历史对话/}))
 expect(view.queryByText('碰撞题思路')).toBeNull()
 view.unmount()
 const reopened=render(<RecentSpaces {...props as any} />)
 expect(reopened.queryByText('动量实验')).toBeNull()
 expect(reopened.queryByText('碰撞题思路')).toBeNull()
 fireEvent.click(reopened.getByRole('button',{name:/展开.*最近/}))
 expect(reopened.getByText('动量实验')).toBeTruthy()
})
