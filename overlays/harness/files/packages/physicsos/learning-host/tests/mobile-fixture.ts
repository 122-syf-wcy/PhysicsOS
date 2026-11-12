/** Real learning facade/service with only checkpoint I/O held in memory for deterministic fault tests. */
import { createHash } from 'node:crypto'
import { defaultCoordinateSystem } from '@physicsos/physics-scene'
import { quantity } from '@physicsos/physics-units'
import { memoryDomain } from '../../mobile-host/tests/fixture.ts'
import { learningDomain } from '../src/domain.ts'
import { CheckpointStore, type CheckpointReference } from '../src/checkpoint-store.ts'
import type { IdentityActor } from '../src/identity.ts'
import { LearningService } from '../src/service.ts'
import { createMobileLearning } from '../src/mobile.ts'

export const at = '2026-11-08T10:00:00.000Z'
export function scene(id = 'scene-one', description = '') {
  return {
    schemaVersion: 'physics-scene/1.0', id, revision: 0, dimension: '2d', coordinateSystem: defaultCoordinateSystem(),
    timeline: { currentTime: quantity(0, 's', 'time'), startTime: quantity(0, 's', 'time'), endTime: quantity(0, 's', 'time'), state: 'idle', playbackRate: 1 },
    bodies: [], particles: [], fields: [], forces: [], regions: [], boundaries: [], constraints: [], circuits: [],
    opticalBenches: [], acousticBenches: [], fluidTanks: [], thermalBenches: [], leverBenches: [],
    measurementDefinitions: [], observableDefinitions: [], annotations: [], metadata: { createdAt: at, updatedAt: at, description },
  }
}
export function checkpoint(id = 'scene-one', historyCount = 1, historyText = '') {
  return {
    version: 1, scene: scene(id), originScene: scene(id), templateId: 'fixture-template',
    playback: { time: 0, duration: 0, rate: 1, running: false },
    history: { past: Array.from({ length: historyCount }, (_, index) => ({ id: `edit-${index}`, label: `Edit ${index}`, before: scene(id, historyText), after: scene(id, historyText) })), future: [] },
    editing: { instanceKey: 'fixture-instance', instanceEditRevision: historyCount, source: { kind: 'import' }, buildMode: 'inspect',
      selectedIds: [], observables: {}, viewport: { x: 0, y: 0, zoom: 1 }, activePanel: 'parameters' },
  }
}
export function sceneBody(id = 'scene-one', value = checkpoint(id), revision = 0) {
  return { sceneId: id, title: 'Saved experiment', domain: 'mechanics', kind: 'experiment', updatedAt: at,
    scene: value.scene, originScene: value.originScene, checkpoint: value, baseRevision: revision }
}
export class MemoryCheckpoints extends CheckpointStore {
  readonly files = new Map<string, string>()
  saves = 0
  reads = 0
  unavailable = false
  constructor() { super('unused-test-checkpoint-root') }
  private key(actor: IdentityActor, digest: string): string { return JSON.stringify([actor.schoolId, actor.userKey, digest]) }
  override async save(actor: IdentityActor, value: Readonly<Record<string, unknown>>): Promise<CheckpointReference> {
    this.saves++
    const text = JSON.stringify(value), digest = createHash('sha256').update(text).digest('hex')
    this.files.set(this.key(actor, digest), text)
    return { digest, bytes: Buffer.byteLength(text) }
  }
  override async read(actor: IdentityActor, reference: CheckpointReference): Promise<Record<string, unknown>> {
    this.reads++
    if (this.unavailable) throw new Error('Injected checkpoint I/O outage')
    const text = this.files.get(this.key(actor, reference.digest))
    if (text === undefined || Buffer.byteLength(text) !== reference.bytes) throw new Error('Missing checkpoint')
    return JSON.parse(text) as Record<string, unknown>
  }
  override async collect(actor: IdentityActor, retained: ReadonlySet<string>): Promise<void> {
    for (const key of this.files.keys()) {
      const [school, user, digest] = JSON.parse(key) as string[]
      if (school === actor.schoolId && user === actor.userKey && !retained.has(digest!)) this.files.delete(key)
    }
  }
  override async erase(actor: IdentityActor): Promise<void> { await this.collect(actor, new Set()) }
}
export function learningFixture() {
  const storage = memoryDomain(learningDomain)
  const files = new MemoryCheckpoints()
  const service = new LearningService(storage.domain, files)
  const unused = async (): Promise<never> => { throw new Error('Canvas operations are outside this scene fixture') }
  const facade = createMobileLearning(service, { exportMetadata: unused, exportObjectIndex: unused, exportObject: unused })
  return { storage, files, service, facade }
}
