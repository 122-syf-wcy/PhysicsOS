// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SidebarNav } from '../src/client/SidebarNav.tsx'
import { RecentSpaces } from '../src/client/RecentSpaces.tsx'
import { zh } from '../src/client/locales.ts'
const t = (key: string) => ({ 'nav.projects': '项目' }[key] ?? (zh as Record<string,string>)[key] ?? key)
afterEach(() => { cleanup(); localStorage.clear() })
it('offers a chapter project entry beside experiments in student navigation', () => {
 const open = vi.fn()
 const view=render(<SidebarNav {...{wide:true,openSurface:open,t,usePhysicsSurface:(f:any)=>f({surface:'home'}),useAuth:(f:any)=>f({user:{role:'STUDENT'}})} as any} />)
 fireEvent.click(view.getByRole('button',{name:'项目'}))
 expect(open).toHaveBeenCalledWith('projects')
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
