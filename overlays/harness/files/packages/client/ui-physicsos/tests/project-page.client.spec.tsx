// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach,expect,it,vi } from 'vitest'
import { StudyProjects } from '../src/client/StudyProjects.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('organizes chapter conversations, renames them and starts a session in the selected project',async()=>{
 const newConversation=vi.fn(async()=>undefined),renameConversation=vi.fn(async()=>undefined)
 const props={t:(k:keyof typeof zh)=>zh[k],useWorkspaces:(f:any)=>f({items:[{workspaceId:'momentum',title:'动量守恒定律',sessionIds:['q1','blank']},{workspaceId:'energy',title:'机械能',sessionIds:['q2']}],archivedSessionIds:[]}),useSessions:(f:any)=>f({ids:['q1','q2','blank'],byId:{q1:{id:'q1',displayTitle:'完全非弹性碰撞',blank:false,origin:'user',updatedAt:2},q2:{id:'q2',displayTitle:'弹簧做功',blank:false,origin:'user',updatedAt:1},blank:{id:'blank',blank:true,displayTitle:'New',origin:'user',updatedAt:3}}}),createProject:vi.fn(),renameProject:vi.fn(),openConversation:vi.fn(),newConversation,renameConversation,addConversation:vi.fn(),listBoards:vi.fn(async()=>[]),assignBoard:vi.fn(),newBoard:vi.fn(),openBoard:vi.fn()}
 const view=render(<StudyProjects {...props as any}/>)
 expect(view.getByText('完全非弹性碰撞')).toBeTruthy()
 expect(view.queryByText('弹簧做功')).toBeNull()
 fireEvent.click(view.getByRole('button',{name:'新建对话'}));await waitFor(()=>expect(newConversation).toHaveBeenCalledWith('momentum'))
 fireEvent.click(view.getByRole('button',{name:'重命名 · 完全非弹性碰撞'}))
 fireEvent.change(view.getByRole('textbox',{name:'名称'}),{target:{value:'碰撞例题1'}})
 fireEvent.click(view.getByRole('button',{name:'保存'}));await waitFor(()=>expect(renameConversation).toHaveBeenCalledWith('q1','碰撞例题1'))
 fireEvent.click(view.getByRole('button',{name:/机械能/}));expect(view.getByText('弹簧做功')).toBeTruthy()
 expect(view.queryByText('完全非弹性碰撞')).toBeNull()
})
