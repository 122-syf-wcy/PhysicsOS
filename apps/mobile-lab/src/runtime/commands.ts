import type { WorkbenchInstanceActions } from '@lab/physics/workbench-instance-runtime.ts'
import type { ScenePoint } from '@lab/physics/scene-visual-model.ts'
import { assertJson, fail, finite, object, text } from '../shared/protocol.ts'

type SharedAction = Exclude<keyof WorkbenchInstanceActions, 'applyDraftEdit' | 'getSampleReadout' | 'setRelease' | 'addPart'>
export type ActionArguments = { [K in SharedAction]: Parameters<WorkbenchInstanceActions[K]> } & {
  addPart: [partId: string, at?: ScenePoint]
  reset: []
}
export type ActionName = keyof ActionArguments
export type LabAction<K extends ActionName = ActionName> = K extends ActionName ? { name: K; args: ActionArguments[K] } : never
const signatures = {
  editParameter: ['id', 'number'], previewParameter: ['id', 'number'], commitParameter: ['id', 'number'],
  cancelParameterPreview: [], setChoice: ['id', 'id'], setObservable: ['id', 'boolean'],
  setRunning: ['boolean'], setRate: ['number'], seek: ['number'], step: ['number'], setHighlight: ['ids'],
  previewComponentPlacement: ['id', 'point'], commitComponentPlacement: ['id', 'point'], nudgeComponentPlacement: ['id', 'point'],
  cancelComponentPlacement: [], setSwitchState: ['id', 'switch'],
  previewSliderPosition: ['id', 'number'], commitSliderPosition: ['id', 'number'], cancelSliderPosition: [],
  enterBuilder: [], leaveBuilder: [], editBuilderComponent: ['id', 'edit'], addComponent: ['componentType', 'point?', 'params?'],
  addPart: ['id', 'point?'], removeComponent: ['id'], moveComponent: ['id', 'point'], rotateComponent: ['id'],
  setComponentParams: ['id', 'params'], connectTerminals: ['terminal', 'terminal'], disconnectTerminal: ['terminal'],
  beginWire: ['terminal'], completeWire: ['terminal'], cancelWire: [], undo: [], redo: [], restoreOrigin: [],
  recordObservation: [], removeObservation: ['id'], reset: [],
} as const satisfies Record<ActionName, readonly string[]>
export const PREVIEW_ACTIONS = new Set<ActionName>(['previewParameter', 'previewComponentPlacement', 'previewSliderPosition'])
export const NON_FACT_ACTIONS = new Set<ActionName>([
  ...PREVIEW_ACTIONS, 'cancelParameterPreview', 'cancelComponentPlacement', 'cancelSliderPosition',
  'setRunning', 'setRate', 'seek', 'step', 'setHighlight', 'beginWire', 'cancelWire', 'reset',
])
function valid(value: unknown, kind: string): boolean {
  if (kind.endsWith('?')) return value === undefined || valid(value, kind.slice(0, -1))
  switch (kind) {
    case 'id': return text(value)
    case 'number': return finite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'ids': return Array.isArray(value) && value.length <= 256 && value.every(id => text(id))
    case 'point': return object(value) && Object.keys(value).every(key => key === 'x' || key === 'y') && finite(value.x) && finite(value.y)
    case 'terminal': return object(value) && Object.keys(value).every(key => key === 'componentId' || key === 'terminalKey') && text(value.componentId) && text(value.terminalKey)
    case 'switch': return value === 'open' || value === 'closed'
    case 'edit': return value === 'duplicate' || value === 'remove' || value === 'rotate'
    case 'componentType': return ['voltage_source', 'switch', 'resistor', 'variable_resistor', 'ammeter', 'voltmeter'].includes(String(value))
    case 'params': return object(value) && Object.entries(value).every(([key, item]) =>
      key === 'state' ? valid(item, 'switch') : ['resistance', 'voltage', 'internalResistance', 'totalResistance', 'sliderPosition'].includes(key) && finite(item))
    default: return false
  }
}
export function parseAction(input: unknown): LabAction {
  assertJson(input, 256 * 1024)
  if (!object(input) || typeof input.name !== 'string' || !Object.hasOwn(signatures, input.name)
    || !Array.isArray(input.args) || Object.keys(input).some(key => key !== 'name' && key !== 'args')) fail('INVALID_ACTION', '不支持的实验操作。')
  const signature: readonly string[] = signatures[input.name as ActionName]
  const args = input.args
  if (args.length > signature.length || signature.some((kind, index) => !valid(args[index], kind))) fail('INVALID_ACTION', '实验操作参数无效。')
  return input as LabAction
}
