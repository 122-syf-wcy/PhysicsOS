#!/usr/bin/env node
// UI-only audit of an operator-provisioned synthetic candidate; never touches existing contexts.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const require = createRequire(process.env.UI_REWORK_TOOLCHAIN_ROOT
  ? path.join(path.resolve(process.env.UI_REWORK_TOOLCHAIN_ROOT),'package.json') : import.meta.url);
const { chromium } = require('@playwright/test');
const strict=process.env.UI_REWORK_STRICT==='1';
if(strict&&!process.env.UI_REWORK_IMAGE)throw Error('Strict inspection requires the independently verified candidate image');
const base=process.env.UI_REWORK_BASE||'http://physicsos-validation.invalid:3199';
if(new URL(base).hostname!=='physicsos-validation.invalid')throw Error('Synthetic candidate hostname required');
const evidenceRoot=path.join(root,'docs/ui-redesign/rework-20261116');
const out=path.resolve(process.env.UI_REWORK_OUT||path.join(evidenceRoot,`surfaces-${new Date().toISOString().replace(/[:.]/g,'-')}`));
const relativeOut=path.relative(evidenceRoot,out);
if(relativeOut.startsWith('..')||path.isAbsolute(relativeOut))throw Error('Output outside assigned evidence directory');
if(fs.existsSync(path.join(out,'manifest.json')))throw Error('Evidence already exists; choose a new output directory');
fs.mkdirSync(out,{recursive:true});
const users=JSON.parse(fs.readFileSync(process.env.UI_REWORK_CREDENTIALS||'/tmp/physicsos-ui-admin-credentials.json','utf8'));
const secrets=Object.values(users).flatMap(u=>[u.username,u.password,u.schoolId]).filter(v=>typeof v==='string'&&v.length>2);
const clean=text=>secrets.reduce((s,v)=>s.split(v).join('[redacted]'),String(text));
const matrix=JSON.parse(fs.readFileSync(path.join(root,'docs/ui-redesign/coverage.json'),'utf8')).items;
const readRpc=new Set(['/api/dynamicCordisRunner/inventory','/api/session/modelCatalog','/api/session/list','/api/permissionPresets/catalog','/api/agentPresets/list','/api/llm/listProviders','/api/llm/listConfigurableProviders','/api/credentials/describe']);
const m={schemaVersion:3,phase:process.env.UI_REWORK_PHASE||'inspection',strict,startedAt:new Date().toISOString(),candidate:base,image:{value:process.env.UI_REWORK_IMAGE||'unverified',provenance:'operator supplied; compare with the separate image inspection receipt'},safety:{ownContextsOnly:true,credentialsPersisted:false,productionVisited:false,allowedPostPaths:['/physicsos/auth/login',...readRpc]},policy:'Captured/DOM-observed surfaces are not design acceptance. Blocked requests and transient captures are audit limitations, never product failures.',captures:[],navigation:[],blockedWrites:[],unavailable:[],matrix:matrix.map(i=>({id:i.designId,title:i.title,prototype:i.recommendedDesign,status:'not-seen',observations:[],reason:'Outside focused scope or no safe reachable synthetic fixture'}))};
if(m.phase!=='before')for(const id of [17,22]){const row=m.matrix.find(x=>x.id===id);row.status='retired-standalone-surface';row.reason='User removed the redundant resource page; practice and verified paper reading are embedded in the real experiment center. This is a scope change, not a visual pass.';}
const save=()=>fs.writeFileSync(path.join(out,'manifest.json'),clean(JSON.stringify(m,null,2)));
const b=await chromium.connectOverCDP(process.env.UI_REWORK_CDP||'http://127.0.0.1:9230',{noDefaults:true});
const contexts=[];let serial=1;
const fail=(surface,e)=>{m.unavailable.push({surface,error:clean(e.message).split('\n')[0].slice(0,160)});save();};
const step=async(name,fn)=>{try{await fn();}catch(e){fail(name,e);}};
const visibleButtons=p=>p.locator('button,[role="tab"],[role="menuitem"]').evaluateAll(ns=>ns.filter(n=>n.getBoundingClientRect().width).map(n=>({text:(n.innerText||'').slice(0,55),aria:n.getAttribute('aria-label')})).slice(0,90));
async function ready(p){
 await p.locator('nav[aria-label="PhysicsOS"]').waitFor({state:'visible',timeout:45000});
 await p.locator('[data-physicsos-auth-gate]').waitFor({state:'hidden',timeout:45000});
 const notice=p.locator('[data-physicsos-platform-notice]');await notice.waitFor({state:'visible',timeout:2000}).catch(()=>{});
 if(await notice.isVisible()){await notice.getByRole('button',{name:'继续',exact:true}).click();await p.waitForTimeout(1000);}
 await p.locator('nav[aria-label="PhysicsOS"] button').first().waitFor({state:'visible',timeout:45000});await p.waitForTimeout(1600);
 if(!await p.locator('nav[aria-label="PhysicsOS"] button').first().isVisible())await p.locator('nav[aria-label="PhysicsOS"] button').first().waitFor({state:'visible',timeout:45000});
 await p.getByRole('heading',{name:'今天，想探索什么？'}).waitFor({state:'visible',timeout:30000});
}
async function login(role,scheme='light'){
 const c=await b.newContext({viewport:{width:1360,height:768},colorScheme:scheme});contexts.push(c);
 await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(['GET','HEAD','OPTIONS'].includes(q.method())||(u.origin===new URL(base).origin&&(u.pathname==='/physicsos/auth/login'||readRpc.has(u.pathname))))return r.continue();const entry={method:q.method(),path:u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'[id]')};if(!m.blockedWrites.some(x=>x.method===entry.method&&x.path===entry.path))m.blockedWrites.push(entry);return r.abort('blockedbyclient');});
 const p=await c.newPage();p.setDefaultTimeout(7000);await p.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
 const status=await p.evaluate(async u=>(await fetch('/physicsos/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({schoolId:u.schoolId,username:u.username,password:u.password})})).status,users[role]);if(status!==200)throw Error(`Login failed: ${status}`);
 await p.reload({waitUntil:'domcontentloaded'});await ready(p);return p;
}
async function click(p,names){
 for(let attempt=0;attempt<12;attempt++){
  for(const name of names)for(const role of ['button','menuitem','tab','link']){const l=p.getByRole(role,{name,exact:typeof name==='string'}).last();if(await l.isVisible()){await l.click();await p.waitForTimeout(400);return;}}
  await p.waitForTimeout(400);
 }throw Error('Safe visible control not found: '+names.map(String).join('|'));
}
async function nav(p,names){
 for(const name of names){const l=p.locator('nav[aria-label="PhysicsOS"]').getByRole('button',{name,exact:typeof name==='string'}).first();if(await l.isVisible()){await l.click();await p.waitForTimeout(600);return;}}
 await click(p,['更多功能']);await click(p,names);
}
async function heading(p,re){await p.getByRole('heading',{name:re}).first().waitFor({state:'visible',timeout:20000});}
async function capture(p,name,ids,role,scheme='light'){
 await p.waitForTimeout(800);const file=`${String(serial++).padStart(2,'0')}-${name}.png`;
 const dom=await p.evaluate(()=>{
  const box=n=>{const r=n.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}};
  const visible=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&s.visibility!=='hidden'};
  const headings=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(visible).map(n=>({level:n.tagName,text:(n.textContent||'').trim().slice(0,90),box:box(n)}));
  const headers=[...document.querySelectorAll('header,[role="banner"],nav,[role="tablist"],[role="toolbar"],[role="dialog"]')].filter(visible).map(n=>({tag:n.tagName,role:n.getAttribute('role'),label:n.getAttribute('aria-label'),box:box(n)}));
  const overflow=[...document.querySelectorAll('main,section,header,nav,[role="dialog"],[role="toolbar"],button,input,select')].filter(visible).filter(n=>{const r=n.getBoundingClientRect();return r.left < -2||r.right>innerWidth+2}).slice(0,25).map(n=>({tag:n.tagName,label:n.getAttribute('aria-label')||n.getAttribute('title'),box:box(n)}));
  return{viewport:{width:innerWidth,height:innerHeight},horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,documentWidth:document.documentElement.scrollWidth,headings,headers,overflow,dark:matchMedia('(prefers-color-scheme: dark)').matches};
 });
 await p.screenshot({path:path.join(out,file),mask:secrets.filter(s=>s.length>4).map(s=>p.getByText(s,{exact:true})),animations:'disabled'});
 m.captures.push({name,file,role,scheme,ids,dom,status:'captured-and-dom-observed-not-approved'});
 for(const id of ids){const row=m.matrix.find(x=>x.id===id);row.status=`seen-partial-${m.phase}`;row.observations.push(file);row.reason='Surface observation only; no full interaction/permission/design pass';}
 console.log(JSON.stringify({capture:name,file,headings:dom.headings.map(h=>clean(h.text)),overflow:dom.horizontalOverflow}));save();
}
async function pair(p,name,ids,role,scheme='light'){
 await p.setViewportSize({width:1360,height:768});await capture(p,`${name}-desktop-${scheme}`,ids,role,scheme);
 if(scheme==='light'){await p.setViewportSize({width:390,height:844});await capture(p,`${name}-mobile-light`,ids,role);await p.setViewportSize({width:1360,height:768});}
}
async function synthetic(p,selector){const row=p.locator(selector).filter({hasText:/UI 验收|UI验收|合成|synthetic/i}).first();await row.waitFor({state:'visible',timeout:7000});const open=row.getByRole('button',{name:/打开|查看|编辑|继续|预览/}).first();if(await open.isVisible())await open.click();else await row.getByRole('button').first().click();}
async function settings(p,role,scheme='light'){
 await click(p,['设置']);await click(p,['通用设置']);await p.getByRole('button',{name:'跟随系统',exact:true}).waitFor({state:'visible',timeout:20000});await pair(p,'settings-general',[28],role,scheme);
 m.navigation.push({surface:'settings',buttons:await visibleButtons(p)});
 await click(p,['模型']);await p.waitForTimeout(2500);await pair(p,'settings-models',[29],role,scheme);
 await click(p,['学习模式']);await heading(p,'学习模式');await pair(p,'settings-learning',[30],role,scheme);
 if(m.phase==='before'){await click(p,['Agent 预设']);await p.waitForTimeout(1500);await pair(p,'settings-legacy-presets',[30],role,scheme);}
 else if(await p.getByRole('button',{name:'Agent 预设',exact:true}).isVisible())throw Error('Duplicate legacy preset navigation remains');
 await click(p,['关闭']);
}
try{
 const modes=(process.env.UI_REWORK_MODES||'teacher,editors,admin,dark').split(',');
 if(modes.includes('teacher'))await step('teacher',async()=>{
  const p=await login('teacher');await pair(p,'home',[1],'teacher');
  for(const [name,labels,ids,expect] of [['projects',['项目'],[6],/^项目$/],['canvases',['实验自由画布'],[7],/实验自由画布/],['whiteboards',['教学画板'],[9],/教学画板/],...(m.phase==='before'?[['resources',['物理资源库','资源库',/资源/],[17],/物理资源库|资源库/]]:[]),['feedback',['反馈','意见反馈',/反馈/],[16],/反馈/]])await step(name,async()=>{await nav(p,labels);if(name==='canvases')await p.locator('[data-physicsos-canvas-catalog]').waitFor({state:'visible',timeout:20000});else await heading(p,expect);await pair(p,name,ids,'teacher');if(name==='feedback')await step('feedback history',async()=>{await click(p,['我的反馈',/我的反馈/]);await pair(p,'feedback-history',[59],'teacher');});});
  await step('paper',async()=>{
   await nav(p,['出卷专区']);await heading(p,'出卷工作台');await pair(p,'paper-new',[10],'teacher');
   for(const [name,labels,id] of [['paper-jobs',[/草稿与审核/],11],['paper-final',[/已定稿/],13],['paper-bank',[/^题库/],14],['paper-sources',[/真题资料库/],15]])await step(name,async()=>{await click(p,labels);await p.waitForTimeout(1000);await pair(p,name,[id],'teacher');m.navigation.push({surface:name,buttons:await visibleButtons(p)});
    if(id===11)await step('paper detail',async()=>{await click(p,[/^查看详情$/, /^继续审核$/, /^查看$/]);await p.waitForTimeout(800);await pair(p,'paper-review-detail',[12],'teacher');});
    if(id===13)await step('paper PDF',async()=>{await click(p,['试卷.pdf',/试卷.*pdf/i,/预览/]);await p.locator('iframe').first().waitFor({state:'visible',timeout:12000});await pair(p,'paper-pdf',[21],'teacher');await p.reload({waitUntil:'domcontentloaded'});await p.locator('nav[aria-label="PhysicsOS"] button').first().waitFor({state:'visible',timeout:30000});await nav(p,['出卷专区']);await heading(p,'出卷工作台');});
   });
  });await step('settings',()=>settings(p,'teacher'));await p.context().close();
 });
 if(modes.includes('editors'))await step('editors',async()=>{
  const p=await login('otherTeacher');await step('canvas editor',async()=>{await nav(p,['实验自由画布']);await p.locator('[data-physicsos-canvas-catalog]').waitFor({state:'visible',timeout:20000});await synthetic(p,'[data-canvas-id]');await p.locator('[data-physicsos-canvas-workspace]').waitFor({state:'visible',timeout:20000});await heading(p,/UI 验收|UI验收|合成|synthetic/i);await pair(p,'canvas-editor',[8],'otherTeacher');});
  await step('whiteboard editor',async()=>{await nav(p,['教学画板']);await heading(p,/教学画板/);m.navigation.push({surface:'whiteboard-list',buttons:await visibleButtons(p)});await synthetic(p,'[data-whiteboard-id],article');await p.waitForTimeout(2000);await pair(p,'whiteboard-editor',[20],'otherTeacher');});await p.context().close();
 });
 if(modes.includes('admin'))await step('schoolAdmin',async()=>{
  const p=await login('schoolAdmin');await p.goto(base+'/physicsos/admin',{waitUntil:'domcontentloaded',timeout:30000});await p.getByRole('button',{name:/概览|用户/}).first().waitFor({state:'visible',timeout:30000});await p.waitForTimeout(1500);m.navigation.push({surface:'school-admin-entry',buttons:await visibleButtons(p)});await pair(p,'school-admin-entry',[],'schoolAdmin');
  for(const [name,labels,id] of [['admin-summary',['使用汇总'],33],['admin-operations',['运维'],34],['admin-audit',['审计日志'],35],['admin-users',['用户管理','用户'],36],['admin-resets',['密码重置','密码重置请求'],37],['admin-devices',['设备','设备管理'],38],['admin-feedback',['反馈与公告','反馈','用户反馈'],44],['admin-moderation',['对话审核'],41]])await step(name,async()=>{await click(p,labels);await p.waitForTimeout(900);await pair(p,name,[id],'schoolAdmin');});await p.context().close();
 });
 if(modes.includes('dark'))await step('dark',async()=>{
  const p=await login('teacher','dark');await pair(p,'home',[1],'teacher','dark');await step('dark paper',async()=>{await nav(p,['出卷专区']);await heading(p,'出卷工作台');await pair(p,'paper-new',[10],'teacher','dark');});await step('dark settings',()=>settings(p,'teacher','dark'));await p.context().close();
 });
}finally{for(const c of contexts)await c.close().catch(()=>{});await b.close();m.finishedAt=new Date().toISOString();save();}
const overflow=m.captures.filter(c=>c.dom.horizontalOverflow).map(c=>c.name);
console.log(JSON.stringify({captures:m.captures.length,seen:m.matrix.filter(x=>x.status.startsWith('seen-')).map(x=>x.id),retired:m.matrix.filter(x=>x.status==='retired-standalone-surface').map(x=>x.id),unavailable:m.unavailable,overflow,blockedWrites:m.blockedWrites}));
if(strict&&(m.unavailable.length>0||overflow.length>0||m.captures.length===0))process.exitCode=1;
