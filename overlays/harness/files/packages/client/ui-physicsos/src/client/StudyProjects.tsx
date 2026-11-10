import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionSummary, WorkspaceId } from './runtime-compat.ts'
import css from './StudyProjects.module.css'

export interface ProjectBoard { id: string; title: string; projectId?: string }
export interface StudyProjectsInjected {
 createProject(name: string): Promise<{id:string;name:string}>
 renameProject(id: string, name: string): Promise<void>
 openConversation(id: SessionId): void
 newConversation(id: WorkspaceId): Promise<void>
 renameConversation(id: SessionId, name: string): Promise<void>
 addConversation(project: WorkspaceId, session: SessionId): Promise<void>
 listBoards(): Promise<readonly ProjectBoard[]>
 assignBoard(id: string, projectId: string): Promise<void>
 newBoard(projectId: string, title: string): Promise<void>
 openBoard(id: string): void
}
type Props = PropsRuntime<'main'> & PropsLocale<'physicsos'> & InjectFace<StudyProjectsInjected>

/** Chapter folders use the host's existing account workspace and durable session records. */
export function StudyProjects({t,useWorkspaces,useSessions,createProject,renameProject,openConversation,newConversation,renameConversation,addConversation,listBoards,assignBoard,newBoard,openBoard}: Props) {
 const registry=useWorkspaces(s=>s)
 const sessions=useSessions(s=>s)
 const [selected,setSelected]=useState<string>()
 const [search,setSearch]=useState('')
 const [tab,setTab]=useState<'chats'|'boards'>('chats')
 const [boards,setBoards]=useState<readonly ProjectBoard[]>([])
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState<string>()
 const [dialog,setDialog]=useState<{kind:'project'|'rename-project'|'rename-chat'|'add-chat'|'add-board';id?:string}>()
 const [name,setName]=useState('')
 const [item,setItem]=useState('')
 const projects=registry.items.filter(p=>p.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
 const current=registry.items.find(p=>p.workspaceId===selected) ?? projects[0]
 const archived=new Set(registry.archivedSessionIds)
 const available=useMemo(()=>sessions.ids.map(id=>sessions.byId[id]).filter((s): s is SessionSummary=>s!==undefined&&!s.blank&&s.origin!=='subagent'&&!archived.has(s.id)),[sessions,registry.archivedSessionIds])
 const members=available.filter(s=>current?.sessionIds.includes(s.id)).sort((a,b)=>b.updatedAt-a.updatedAt)
 useEffect(()=>{if(tab!=='boards')return;let stale=false;void listBoards().then(items=>{if(!stale)setBoards(items)}).catch(()=>{if(!stale)setError(t('projects.error'))});return()=>{stale=true}},[tab,listBoards,t,selected])
 const run=async(job:()=>Promise<unknown>):Promise<void>=>{setBusy(true);setError(undefined);try{await job()}catch{setError(t('projects.error'))}finally{setBusy(false)}}
 const begin=(next:NonNullable<typeof dialog>)=>{setDialog(next);setItem('');setName(next.kind==='rename-project'?current?.title??'':next.kind==='rename-chat'?sessions.byId[next.id as SessionId]?.displayTitle??'':'')}
 const confirm=()=>{if(dialog===undefined)return;const target=dialog;void run(async()=>{
  if(target.kind==='project'){const p=await createProject(name.trim());setSelected(p.id)}
  else if(target.kind==='rename-project')await renameProject(target.id!,name.trim())
  else if(target.kind==='rename-chat')await renameConversation(target.id as SessionId,name.trim())
  else if(target.kind==='add-chat')await addConversation(current!.workspaceId,item as SessionId)
  else {await assignBoard(item,current!.workspaceId);setBoards(await listBoards())}
  setDialog(undefined)
 })}
 return <main className={css.root} data-physicsos-projects="true">
  <header className={css.header}><div><h1>{t('projects.title')}</h1><p>{t('projects.hint')}</p></div><button onClick={()=>begin({kind:'project'})}>{t('projects.new')}</button></header>
  {error&&<p role="alert" className={css.error}>{error}</p>}
  <div className={css.layout}><aside className={css.folders}>
   <input aria-label={t('projects.search')} placeholder={t('projects.search')} value={search} onChange={e=>setSearch(e.target.value)} />
   {projects.map(p=><button key={p.workspaceId} aria-pressed={current?.workspaceId===p.workspaceId} className={css.folder} onClick={()=>{setSelected(p.workspaceId);setError(undefined)}}>
    <span aria-hidden="true">▤</span><span>{p.title}<small>{p.sessionIds.filter(id=>available.some(s=>s.id===id)).length} {t('projects.conversations')}</small></span></button>)}
   {projects.length===0&&<p>{t('projects.empty')}</p>}
  </aside><section className={css.content}>
   {current===undefined?<div className={css.empty}><h2>{t('projects.empty')}</h2><p>{t('projects.example')}</p></div>:<>
    <div className={css.projectHeader}><div><h2>{current.title}</h2><p>{t('projects.chapterHint')}</p></div><button onClick={()=>begin({kind:'rename-project',id:current.workspaceId})}>{t('projects.rename')}</button></div>
    <div className={css.tabs}><button aria-pressed={tab==='chats'} onClick={()=>setTab('chats')}>{t('projects.conversations')}</button><button aria-pressed={tab==='boards'} onClick={()=>setTab('boards')}>{t('projects.boards')}</button></div>
    {tab==='chats'?<>
     <div className={css.actions}><button disabled={busy} onClick={()=>{void run(()=>newConversation(current.workspaceId))}}>{t('projects.newConversation')}</button><button onClick={()=>begin({kind:'add-chat'})}>{t('projects.addConversation')}</button></div>
     {members.length===0?<p className={css.empty}>{t('projects.noConversations')}</p>:<ul className={css.list}>{members.map(s=><li key={s.id}><button className={css.open} onClick={()=>openConversation(s.id)}>{s.displayTitle}<small>{new Date(s.updatedAt).toLocaleDateString()}</small></button><button aria-label={`${t('projects.rename')} · ${s.displayTitle}`} onClick={()=>begin({kind:'rename-chat',id:s.id})}>{t('projects.rename')}</button></li>)}</ul>}
    </>:<>
     <div className={css.actions}><button disabled={busy} onClick={()=>{void run(()=>newBoard(current.workspaceId,`${current.title} · ${t('projects.board')}`))}}>{t('projects.newBoard')}</button><button onClick={()=>begin({kind:'add-board'})}>{t('projects.addBoard')}</button></div>
     <p>{t('projects.canvasHint')}</p><ul className={css.list}>{boards.filter(b=>b.projectId===current.workspaceId).map(b=><li key={b.id}><button className={css.open} onClick={()=>openBoard(b.id)}>{b.title}</button></li>)}</ul>
    </>}
   </>}
  </section></div>
  {dialog&&<div className={css.backdrop}><form role="dialog" aria-modal="true" aria-label={t(dialog.kind==='project'?'projects.new':dialog.kind.startsWith('rename')?'projects.rename':dialog.kind==='add-chat'?'projects.addConversation':'projects.addBoard')} className={css.dialog} onSubmit={e=>{e.preventDefault();confirm()}}>
   <h2>{t(dialog.kind==='project'?'projects.new':dialog.kind.startsWith('rename')?'projects.rename':dialog.kind==='add-chat'?'projects.addConversation':'projects.addBoard')}</h2>
   {dialog.kind==='add-chat'||dialog.kind==='add-board'?<select aria-label={t('projects.choose')} value={item} onChange={e=>setItem(e.target.value)}><option value="">{t('projects.choose')}</option>{dialog.kind==='add-chat'?available.filter(s=>!current?.sessionIds.includes(s.id)).map(s=><option key={s.id} value={s.id}>{s.displayTitle}</option>):boards.filter(b=>b.projectId!==current?.workspaceId).map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select>:<input autoFocus maxLength={80} aria-label={t('projects.name')} placeholder={t('projects.example')} value={name} onChange={e=>setName(e.target.value)} />}
   <div className={css.actions}><button type="button" disabled={busy} onClick={()=>setDialog(undefined)}>{t('projects.cancel')}</button><button type="submit" disabled={busy||((dialog.kind==='add-chat'||dialog.kind==='add-board')?item==='':name.trim()==='')}>{t('projects.save')}</button></div>
  </form></div>}
 </main>
}
