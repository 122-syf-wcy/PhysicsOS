/** Server Docker gate: real MagneticWorkspaceRuntime, native pixels and unmodified V3 SDK. */
import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { MAGNETIC_VALIDATION_PROFILE, requiredValidationChecks } from '../../../packages/shared/src/index.ts'
import { validationHostPage } from '../src/page.ts'
import { validationWrapper } from '../src/wrapper.ts'
import { validateCandidate } from '../src/driver.ts'
import { evaluateCandidate } from '../src/server.ts'
import { evaluateObservation } from '../src/verdict.ts'
import { planScene } from '../src/planner.ts'
import { realMagneticPlan, magneticRuntime } from './magnetic-fixture.ts'

const enabled = process.env.PHYSICSOS_VALIDATION_E2E === '1' || process.env.PHYSICSOS_CHAT_CODE_SERVER_DOCKER === '1'
const suite = enabled ? describe : describe.skip
const { scene, plan } = realMagneticPlan()
const identity = { candidateSha256: 'a'.repeat(64), expectedSceneSha256: 'b'.repeat(64), candidateSceneSha256: 'b'.repeat(64), expectedSceneRevision: 3, candidateSceneRevision: 3 }
const modes = ['good', 'static', 'reverse', 'offset', 'only-text', 'covered', 'stale-edit', 'SI', 'pixel-space', 'translate-particle', 'replace-canvas'] as const

/** Presentation only. Coordinates, clock and parameter values are native snapshot facts. */
const renderer = (mode: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head><body><canvas width="360" height="240"></canvas><script type="module">
import {connectExperiment} from './protocol.js';
const mode=${JSON.stringify(mode)};
let canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
let initial,quarter,revision;
connectExperiment(snapshot=>{
  if(mode==='replace-canvas') {
    const next=canvas.cloneNode();canvas.replaceWith(next);canvas=next;ctx=canvas.getContext('2d');
  }
  if(revision===undefined)revision=snapshot.revision;
  if(snapshot.revision===revision&&snapshot.clock.time===snapshot.clock.total/4)quarter=snapshot;
  if(mode==='stale-edit'&&snapshot.revision!==revision&&quarter)snapshot=quarter;
  const v=snapshot.view;let p={...v.particles[0].at};initial??={...p};
  ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#f3eee5';ctx.fillRect(0,0,360,240);
  // B texture does not vary with v0 or time. These marks have no subject coordinates.
  ctx.fillStyle='#8c9da6';for(let y=18;y<240;y+=28)for(let x=16;x<360;x+=28){ctx.fillRect(x,y,2,2);}
  ctx.fillStyle='#354957';ctx.font='13px sans-serif';ctx.fillText('B '+v.field.direction+' t='+snapshot.clock.time+' v0='+snapshot.inspector.flatMap(s=>s.parameters||[]).find(p=>p.id==='v0').value,10,18);
  if(mode==='static')p=initial;
  if(mode==='reverse')p.x=v.extent.width-p.x;
  if(mode==='offset')p.x+=0.4;
  if(mode==='SI'){p.x/=100;p.y/=100;}
  // One stable equal-unit, nonsingular camera across all ordinary/changed frames.
  ctx.setTransform(12,0,0,-12,36,210);ctx.fillStyle='#a33f2e';
  if(mode==='pixel-space'){p={x:36+p.x*12,y:210-p.y*12};ctx.setTransform(1,0,0,1,0,0);}
  if(mode==='translate-particle'){ctx.translate(p.x,p.y);p={x:0,y:0};}
  ctx.beginPath();ctx.arc(p.x,p.y,mode==='pixel-space'?6:0.5,0,Math.PI*2);
  if(mode!=='only-text')ctx.fill();
  if(mode==='covered'){ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#f3eee5';ctx.fillRect(0,40,360,200);}
});
</script></body></html>`

suite('magnetic uniform circular native paint (Docker only)', () => {
  let browser: Browser | undefined, server: Server | undefined, origin: string
  const token = 'magnetic-validation-channel'
  const assets = (mode: string) => ({ hostUrl: `${origin}/${mode}/host.html`, wrapperUrl: `${origin}/${mode}/wrapper.html`, entryUrl: `${origin}/${mode}/index.html` })
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true })
    const files = new Map<string, string>()
    for (const name of ['protocol.js', 'universal-contract.js']) files.set(name, await readFile(new URL(`../../../developer-kit/universal-experiment-template/src/${name}`, import.meta.url), 'utf8'))
    server = createServer((req, res) => {
      const parts = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.split('/'), mode = parts[1]!, file = parts[2]!
      if (!(modes as readonly string[]).includes(mode)) { res.writeHead(404); res.end(); return }
      if (file === 'host.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(validationHostPage({ token, wrapperPath: assets(mode).wrapperUrl, frames: plan.frames, changedFrame: plan.changedFrame })); return }
      if (file === 'wrapper.html') { const wrapped = validationWrapper(new URL(assets(mode).entryUrl)); res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': wrapped.csp }); res.end(wrapped.bytes); return }
      if (file === 'index.html') { res.writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': '*' }); res.end(renderer(mode)); return }
      const script = file === 'target.js' ? "export const experimentId='magnetic-circular'" : files.get(file)
      if (script !== undefined) { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }); res.end(script); return }
      res.writeHead(404); res.end()
    })
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture listener unavailable')
    origin = `http://127.0.0.1:${address.port}`
  }, 120_000)
  afterAll(async () => {
    try { await browser?.close() } finally {
      if (server?.listening) await new Promise<void>((resolve, reject) => { server!.close(error => error ? reject(error) : resolve()) })
    }
  }, 120_000)

  it('passes real quarter-period motion and the exact v0 edit without ground or raw SI conversion', async () => {
    const { result } = await validateCandidate({ browser: browser!, assets: assets('good'), validationProfile: MAGNETIC_VALIDATION_PROFILE,
      frames: plan.frames, changedFrame: plan.changedFrame!, parameter: plan.parameter })
    expect(result.frames).toHaveLength(4)
    expect(result.frames.every(frame => frame.engineGround === undefined && frame.engineBody !== undefined && (frame.drawnBodies?.length ?? 0) > 0)).toBe(true)
    expect(result.changedFrame?.revision).toBe(4)
    const verdict = evaluateObservation({ ...result, ...identity, validationProfile: MAGNETIC_VALIDATION_PROFILE, parameter: plan.parameter })
    expect(verdict.checks.filter(check => !check.passed)).toEqual([])
    expect(verdict.checks.map(check => check.name)).toEqual(requiredValidationChecks(MAGNETIC_VALIDATION_PROFILE))
    expect(verdict.passed).toBe(true)
  }, 120_000)

  it.each(modes.filter(mode => mode !== 'good'))('rejects %s despite an acknowledged nonblank SDK frame', async mode => {
    const { result } = await validateCandidate({ browser: browser!, assets: assets(mode), validationProfile: MAGNETIC_VALIDATION_PROFILE,
      frames: plan.frames, changedFrame: plan.changedFrame!, parameter: plan.parameter })
    expect(result.firstFrameAcknowledged).toBe(true)
    const verdict = evaluateObservation({ ...result, ...identity, validationProfile: MAGNETIC_VALIDATION_PROFILE, parameter: plan.parameter })
    expect(verdict.passed).toBe(false)
    expect(verdict.checks).toContainEqual(expect.objectContaining({ name: mode === 'stale-edit' ? 'parameter-change' : 'geometry-follows-engine', passed: false }))
  }, 120_000)

  it('replans independently through the canonical scene even when the caller supplies pinned frames', async () => {
    const seen: Record<string, unknown>[] = []
    const report = await evaluateCandidate(browser!, { ...assets('good'), token, validationProfile: MAGNETIC_VALIDATION_PROFILE,
      scene: { ...scene }, experimentId: 'magnetic-circular',
      frames: [{ frameId: 'forged0', snapshot: {} }, { frameId: 'forged1', snapshot: {} }], changedFrame: { frameId: 'forged-edit', snapshot: {} },
      expected: { candidateSha256: identity.candidateSha256, sceneSha256: identity.expectedSceneSha256, sceneRevision: 3 } }, undefined,
    (value, id) => { seen.push(value); return planScene(value, magneticRuntime, id) })
    expect(seen).toEqual([scene])
    expect(report.validationProfile).toEqual(MAGNETIC_VALIDATION_PROFILE)
    expect(report.result.frames.map(frame => frame.time)).toEqual(plan.frames.map(frame => (frame.snapshot.clock as { time: number }).time))
    expect(report.checks.filter(check => !check.passed)).toEqual([])
    expect(report.passed).toBe(true)
  }, 120_000)
})
