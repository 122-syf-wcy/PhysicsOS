import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createMagneticScene } from '@physicsos/physics-scene'
import { createManifest, createSceneObject } from '@physicsos/physics-workbench/codec'
import { canonicalStringify } from '@physicsos/physics-workbench/json'
import type { CodeExperimentRef } from '@deepseek-ai/dsh-tool-physicsos/types'
import type { CanvasDocumentState, CanvasController, CanvasInstanceActionName, CanvasInstanceActionArguments, CanvasInstanceActionResult } from '../src/client/canvas/types.ts'
import { createWorkbenchInstanceRuntime } from '../src/client/physics/workbench-instance-runtime.ts'
import { createExperimentSceneRef, findExperimentTemplate } from '../src/client/physics/experiment-templates.ts'
import { canvasCodeRef, createCanvasRendererController, type CanvasRendererController, type CanvasRendererState } from '../src/client/canvas/renderer-controller.ts'

const managers: CanvasRendererController[] = []
const owners: ReturnType<typeof createWorkbenchInstanceRuntime>[] = []
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); for (const owner of owners.splice(0)) owner.dispose() })
const hash = (value: unknown) => createHash('sha256').update(canonicalStringify(value)).digest('hex')
const privateRef: CodeExperimentRef = { status: 'ready', rendererKind: 'independent', artifactId: 'private-artifact', ownerSessionId: 'source-session',
  sceneId: 'source-scene', sceneRevision: 0, sceneSha256: 'a'.repeat(64), experimentId: 'magnetic-circular', sha256: 'b'.repeat(64),
  title: 'Private physics view', childSessionId: 'renderer-session', createdAt: '2026-11-09T00:00:00.000Z' }
const release = { kind: 'community' as const, id: 'approved-view', experimentId: 'magnetic-circular', version: '1.0.0', sha256: 'c'.repeat(64) }
const approved = { ...release, protocolVersion: 3, status: 'approved', entryUrl: '/physicsos/experiment-assets/embed/approved-view/index.html',
  author: { name: 'Contributor' }, createdAt: '2026-11-09T00:00:00.000Z' }
function fixture(fetcher: typeof fetch, kind: 'official' | 'community' | 'question' | 'bundled-template' = 'community') {
  const template = findExperimentTemplate('magnetic-circular')
  if (template === undefined) throw new Error('The shipped magnetic template is missing.')
  const source = kind === 'bundled-template' ? createExperimentSceneRef(template, 'Live physics').scene
    : createMagneticScene({ sceneId: 'independent-source', title: 'Live physics' })
  if (kind !== 'bundled-template') {
    source.metadata.experimentRelease = kind === 'official' ? { kind: 'official', id: 'bundled', experimentId: 'magnetic-circular', version: '1' } : release
  }
  const owner = createWorkbenchInstanceRuntime({ instanceKey: 'instance', sceneId: String(source.id), scene: source, originScene: source,
    ...(kind === 'bundled-template' ? { templateId: template.id } : {}),
    source: kind === 'question' ? { kind: 'question-code', metadata: { questionCodeVisualization: { ...privateRef } } } : { kind: 'template', id: 'magnetic-circular' }, scheduler: null })
  owners.push(owner)
  const sceneObject = createSceneObject(source)
  const digest = hash(sceneObject)
  const manifest = { ...createManifest({ id: 'document', title: 'Renderer check' }), instances: [{ instanceId: 'instance',
    currentScene: { kind: 'scene' as const, digest }, originScene: { kind: 'scene' as const, digest },
    domain: 'magnetic' as const, source: owner.serialize().source, templateId: 'magnetic-circular', buildMode: 'inspect' as const,
    clock: owner.getSnapshot().clock, instanceEditRevision: 0 }], nodes: [] }
  const document = createSnapshotStore<CanvasDocumentState>({ canvasId: 'document', namespace: 'account', manifest, objects: { [digest]: sceneObject },
    loading: false, status: 'saved', localSaved: true, editSequence: 0, acknowledgedSequence: 0, canUndo: false, canRedo: false, conflicts: [] })
  const roster = createSnapshotStore<ReturnType<CanvasController['getSnapshot']>>({ items: [], documents: [], loading: false, namespace: 'account', authScope: 'authenticated' })
  const action = async <K extends CanvasInstanceActionName>(_key: string, name: K, ...args: CanvasInstanceActionArguments<K>): Promise<CanvasInstanceActionResult<K>> => {
    // The key and argument tuple select the corresponding method of the real instance.
    return Reflect.apply(owner.actions[name], owner.actions, args) as CanvasInstanceActionResult<K>
  }
  const manager = createCanvasRendererController({ getSnapshot: roster.getSnapshot, subscribe: roster.subscribe,
    documentSource: () => document, instanceSource: () => owner.summaries, instanceAction: action }, 'http://canvas.test', fetcher)
  managers.push(manager)
  return { manager, owner, roster, document }
}
async function settled(manager: CanvasRendererController): Promise<CanvasRendererState> {
  const source = manager.source('instance')
  if (source.getSnapshot().status !== 'loading') return source.getSnapshot()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('Renderer did not settle')) }, 5000)
    const stop = source.subscribe(() => {
      if (source.getSnapshot().status !== 'loading') { clearTimeout(timer); stop(); resolve(source.getSnapshot()) }
    })
  })
}

describe('account-owned renderer resources and typed physics intents', () => {
  it('keeps a real bundled picker template native before any community release is selected', () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('A bundled template must not request community discovery.') })
    const { manager } = fixture(fetcher, 'bundled-template')
    const source = manager.source('instance')
    manager.attach('document', 'instance', 'instance', 'card')
    manager.attach('document', 'instance', 'instance', 'focus')
    expect(source.getSnapshot()).toMatchObject({ status: 'native', kind: 'native', experimentId: 'magnetic-circular' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('retains a community release pinned on the instance source instead of choosing a later active release', async () => {
    const later = { ...approved, id: 'later-approved-view', version: '2.0.0', sha256: 'd'.repeat(64),
      entryUrl: '/physicsos/experiment-assets/embed/later-approved-view/index.html' }
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ active: later, items: [later, approved] }))
    const { manager, document } = fixture(fetcher, 'bundled-template')
    const saved = document.getSnapshot()
    document.set({ ...saved, manifest: { ...saved.manifest!, instances: saved.manifest!.instances.map(instance => ({
      ...instance, source: { ...instance.source, release },
    })) } })

    manager.attach('document', 'instance', 'instance', 'card')
    const shown = await settled(manager)
    expect(shown).toMatchObject({ status: 'ready', kind: 'community', release,
      entryUrl: 'http://canvas.test/physicsos/experiment-assets/embed/approved-view/index.html' })
  })

  it('keeps a bundled release native without network discovery', () => {
    const fetcher = vi.fn<typeof fetch>()
    const { manager } = fixture(fetcher, 'official')
    const source = manager.source('instance')
    manager.attach('document', 'instance', 'instance', 'card')
    expect(manager.source('instance')).toBe(source)
    expect(source.getSnapshot()).toMatchObject({ status: 'native', release: { kind: 'official' } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('loads the exact approved pinned release and shares resolution across card and focus', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ active: approved, items: [approved] }))
    const { manager } = fixture(fetcher)
    manager.attach('document', 'instance', 'instance', 'card')
    expect(await settled(manager)).toMatchObject({ status: 'ready', kind: 'community', release })
    manager.attach('document', 'instance', 'instance', 'focus')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(manager.source('instance').getSnapshot().entryUrl).toBe('http://canvas.test/physicsos/experiment-assets/embed/approved-view/index.html')
  })
  it('rejects an external wrapper URL instead of sending it platform frames', async () => {
    const { manager } = fixture(async () => Response.json({ active: { ...approved, entryUrl: 'https://other.test/physicsos/experiment-assets/embed/a' },
      items: [{ ...approved, entryUrl: 'https://other.test/physicsos/experiment-assets/embed/a' }] }))
    manager.attach('document', 'instance', 'instance', 'card')
    expect(await settled(manager)).toMatchObject({ status: 'error', code: 'RENDERER_URL_INVALID' })
  })
  it('keeps an unavailable pinned release missing rather than selecting a different active release', async () => {
    const { manager } = fixture(async () => Response.json({ active: { ...approved, id: 'different', sha256: 'd'.repeat(64) }, items: [] }))
    manager.attach('document', 'instance', 'instance', 'card')
    expect(await settled(manager)).toMatchObject({ status: 'error', code: 'RENDERER_RELEASE_MISSING' })
  })
  it('does not publish a late private resource after account scope changes', async () => {
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>(done => { resolve = done })
    const { manager, roster } = fixture(async () => pending)
    manager.attach('document', 'instance', 'instance', 'card')
    roster.set({ items: [], documents: [], loading: false, namespace: 'other-account', authScope: 'authenticated' })
    resolve(Response.json({ active: approved, items: [approved] }))
    await pending; await Promise.resolve(); await Promise.resolve()
    expect(manager.source('instance').getSnapshot().status).toBe('native')
  })
  it('lets the server deny a private artifact and never upgrades a reference to authority', async () => {
    const { manager } = fixture(async () => new Response('', { status: 403 }), 'question')
    manager.attach('document', 'instance', 'instance', 'card')
    expect(await settled(manager)).toMatchObject({ status: 'error', kind: 'question-code', code: 'RENDERER_ACCESS_DENIED' })
    expect(canvasCodeRef({ ...privateRef, sceneRevision: -1 })).toBeUndefined()
    expect(canvasCodeRef({ ...privateRef, rendererKind: 'legacy' })).toBeUndefined()
  })
  it('routes only declared bounded intents to the real independent instance', async () => {
    const { manager, owner } = fixture(async () => Response.json({ active: approved, items: [approved] }))
    manager.attach('document', 'instance', 'instance', 'card')
    await settled(manager)
    const before = owner.getScene()
    expect(await manager.applyIntent('instance', 'not-attached', { type: 'parameter/commit', protocolVersion: 3, id: 'q', value: 2e-6 })).toBe(false)
    expect(await manager.applyIntent('instance', 'card', { type: 'parameter/commit', protocolVersion: 3, id: 'not-a-parameter', value: 2e-6 })).toBe(false)
    expect(owner.getScene()).toEqual(before)
    expect(await manager.applyIntent('instance', 'card', { type: 'parameter/commit', protocolVersion: 3, id: 'q', value: 2e-6 })).toBe(true)
    expect(owner.getScene().revision).toBeGreaterThan(before.revision)
    expect(owner.getScene().particles[0]?.charge?.value).toBe(2e-6)
  })
})
