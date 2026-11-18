/** Opt-in Docker browser gate. Uses the REAL optics runtime and standard V3 SDK. */
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { createOpticsWorkspaceRuntime } from '../../../overlays/harness/files/packages/client/ui-physicsos/src/client/physics/optics-workspace-runtime.ts'
import { parsePhysicsScene } from '../../../packages/physics-scene/src/index.ts'
import { requiredValidationChecks, OPTICS_VALIDATION_PROFILE } from '../../../packages/shared/src/index.ts'
import { validationHostPage } from '../src/page.ts'
import { validationWrapper } from '../src/wrapper.ts'
import { validateCandidate } from '../src/driver.ts'
import { evaluateCandidate } from '../src/server.ts'
import { evaluateObservation } from '../src/verdict.ts'
import { planScene } from '../src/planner.ts'
import { realOpticsPlan } from './optics-fixture.ts'

const run = process.env.PHYSICSOS_VALIDATION_E2E === '1' || process.env.PHYSICSOS_CHAT_CODE_SERVER_DOCKER === '1'
const suite = run ? describe : describe.skip
const { scene, plan } = realOpticsPlan()
const identity = { candidateSha256: 'a'.repeat(64), expectedSceneSha256: 'b'.repeat(64), candidateSceneSha256: 'b'.repeat(64), expectedSceneRevision: 3, candidateSceneRevision: 3 }
const modes = ['good', 'wrong-ray', 'wrong-image', 'fake-semantics', 'missing-control', 'wrong-intent', 'no-resize', 'covered', 'svg-only'] as const

/** Test renderer is projection/presentation only; ALL imaging facts come from the native engine. */
const renderer = (mode: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#canvas{position:fixed;inset:0}canvas{display:block;width:100%;height:100%}svg{position:fixed;inset:0;display:block}</style></head><body><div id="canvas"></div><div id="parameters" hidden></div><script type="module">
import { connectExperiment } from './protocol.js';
const mode=${JSON.stringify(mode)}, canvas=document.createElement('canvas');document.getElementById('canvas').append(canvas);
const ctx=canvas.getContext('2d');let last,connection;
const input=document.createElement('input');input.type='number';input.dataset.parameter='object-height';input.min='0.5';input.step='0.5';
const label=document.createElement('label');label.textContent='物高 (cm)';label.append(input);document.getElementById('parameters').append(label);
if(mode==='missing-control')label.remove();
input.addEventListener('change',()=>connection.send({type:'parameter/commit',protocolVersion:3,id:mode==='wrong-intent'?'object-distance':'object-height',value:input.valueAsNumber}));
function paint(snapshot){
  last=snapshot;const v=snapshot.view, h=snapshot.inspector.flatMap(s=>s.parameters||[]).find(p=>p.id==='object-height');input.value=String(h.value);
  canvas.width=innerWidth;canvas.height=innerHeight;ctx.fillStyle='#f5eee4';ctx.fillRect(0,0,canvas.width,canvas.height);
  const scale=Math.min((canvas.width-16)/v.extent.width,4), left=8-v.origin.x*scale, axis=innerHeight>500?290:240;
  const p=a=>({x:left+a.x*scale,y:axis-a.y*scale});
  const line=(a,b,color='#9d4b31')=>{const A=p(a),B=p(b);ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();};
  line({x:v.origin.x,y:0},{x:v.origin.x+v.extent.width,y:0},'#837365');
  // Rays first: the shaft and head remain in front at their shared source/image endpoints.
  for(const r of v.opticalRays)for(let i=1;i<r.points.length;i++){const end={...r.points[i]};if(mode==='wrong-ray'&&r.kind==='central'&&i===2)end.y+=2;line(r.points[i-1],end);}
  for(const e of v.opticalElements)line({x:e.at.x,y:-e.halfAperture},{x:e.at.x,y:e.halfAperture},'#3b7081');
  for(const s of v.opticalScreens)line({x:s.at.x,y:-s.halfHeight},{x:s.at.x,y:s.halfHeight},'#726956');
  const arrow=(a,height,color)=>{const tip=p({x:a.x,y:a.y+height}),foot=p(a),sign=Math.sign(tip.y-foot.y),base=tip.y-sign*4;
    ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(foot.x,foot.y);ctx.lineTo(tip.x,base);ctx.stroke();
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(tip.x,tip.y);ctx.lineTo(tip.x-6,base);ctx.lineTo(tip.x+6,base);ctx.closePath();ctx.fill();};
  arrow(v.opticalObjects[0].at,v.opticalObjects[0].height,'#3d7652');
  arrow(v.opticalImages[0].at,v.opticalImages[0].height+(mode==='wrong-image'?2:0),'#72589a');
  const strings=[v.opticalObjects[0].label,v.opticalElements[0].label,v.opticalImages[0].label,...v.overlay.readout,...v.opticalScreens.map(s=>s.label)];
  ctx.fillStyle='#322b24';ctx.font='13px sans-serif';let y=26;
  for(const text of new Set(strings)){ctx.fillText(mode==='fake-semantics'?'not engine facts':text,16,y);y+=19;}
  if(mode==='covered'){ctx.fillStyle='#f5eee4';ctx.fillRect(0,130,canvas.width,220);}
  if(mode==='svg-only'){canvas.remove();document.getElementById('canvas').innerHTML='<svg width="200" height="160"><line x1="20" y1="20" x2="150" y2="140" stroke="black"/></svg>';}
}
connection=connectExperiment(paint);
addEventListener('resize',()=>{if(last&&mode!=='no-resize')paint(last);});
</script></body></html>`

suite('static thin-lens real native paint (Docker only)', () => {
  let browser: Browser, server: Server, origin: string
  const token = 'optics-validation-channel'
  const assets = (mode: string) => ({ hostUrl: `${origin}/${mode}/host.html`, wrapperUrl: `${origin}/${mode}/wrapper.html`, entryUrl: `${origin}/${mode}/index.html` })
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true })
    const files = new Map<string, string>()
    for (const name of ['protocol.js', 'universal-contract.js']) files.set(name, await readFile(new URL(`../../../developer-kit/universal-experiment-template/src/${name}`, import.meta.url), 'utf8'))
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', origin), parts = url.pathname.split('/'), mode = parts[1]!, file = parts[2]!
      if (!(modes as readonly string[]).includes(mode)) { res.writeHead(404); res.end(); return }
      if (file === 'host.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(validationHostPage({ token, wrapperPath: assets(mode).wrapperUrl, frames: plan.frames, changedFrame: plan.changedFrame })); return }
      if (file === 'wrapper.html') { const wrapped = validationWrapper(new URL(assets(mode).entryUrl)); res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': wrapped.csp }); res.end(wrapped.bytes); return }
      if (file === 'index.html') { res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }); res.end(renderer(mode)); return }
      const script = file === 'target.js' ? "export const experimentId='convex-lens'" : files.get(file)
      if (script !== undefined) { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); res.end(script); return }
      res.writeHead(404); res.end()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  }, 120_000)
  afterAll(async () => {
    await browser?.close()
    if (server !== undefined) await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('passes a real engine static lens with native painted rays/arrowheads/semantics/control and resize', async () => {
    const { result } = await validateCandidate({ browser, assets: assets('good'), validationProfile: OPTICS_VALIDATION_PROFILE,
      frames: plan.frames, changedFrame: plan.changedFrame!, parameter: plan.parameter })
    expect(result.frames.every(frame => frame.time === 0 && frame.optics !== undefined && frame.drawnSegments!.length >= 10 && frame.drawnTriangles!.length === 2)).toBe(true)
    expect(result.parameterControl).toEqual({ id: 'object-height', from: 6, to: 6.5, nativeContract: true, intentMatched: true })
    const verdict = evaluateObservation({ ...result, ...identity, validationProfile: OPTICS_VALIDATION_PROFILE })
    expect(verdict.checks.filter(check => !check.passed)).toEqual([])
    expect(verdict.passed).toBe(true)
  }, 120_000)

  it.each(modes.filter(mode => mode !== 'good'))('rejects %s despite SDK acknowledgement/nonblank screenshot', async mode => {
    const { result } = await validateCandidate({ browser, assets: assets(mode), validationProfile: OPTICS_VALIDATION_PROFILE,
      frames: plan.frames, changedFrame: plan.changedFrame!, parameter: plan.parameter })
    expect(evaluateObservation({ ...result, ...identity, validationProfile: OPTICS_VALIDATION_PROFILE }).passed).toBe(false)
  }, 120_000)

  it('scene-only worker planning binds the same versioned static policy and ignores forged pinned frames', async () => {
    const report = await evaluateCandidate(browser, { ...assets('good'), token, validationProfile: OPTICS_VALIDATION_PROFILE,
      scene: { ...scene }, experimentId: 'convex-lens',
      frames: [{ frameId: 'forged1', snapshot: {} }, { frameId: 'forged2', snapshot: {} }], changedFrame: { frameId: 'forged3', snapshot: {} },
      expected: { candidateSha256: identity.candidateSha256, sceneSha256: identity.expectedSceneSha256, sceneRevision: 3 } }, undefined,
    (value, id) => planScene(value, raw => { const parsed = parsePhysicsScene(raw); return parsed.ok ? createOpticsWorkspaceRuntime(parsed.value) : null }, id))
    expect(report.validationProfile).toEqual(OPTICS_VALIDATION_PROFILE)
    expect(report.checks.map(check => check.name)).toEqual(requiredValidationChecks(OPTICS_VALIDATION_PROFILE))
    expect(report.passed).toBe(true)
  }, 120_000)
})
