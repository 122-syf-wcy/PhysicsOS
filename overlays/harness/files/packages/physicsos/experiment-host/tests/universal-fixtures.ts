import { files, manifest } from './fixtures.ts'
export const parameters = [
  { id: 'object-height', label: '物高', unit: 'cm', min: 1, max: 40, step: 0.5, value: 6 },
  { id: 'object-distance', label: '物距', unit: 'cm', min: 5, max: 150, step: 5, value: 30 },
  { id: 'screen-distance', label: '像距', unit: 'cm', min: 5, max: 150, step: 5, value: 15 },
]
export const choices = [
  {
    id: 'pinhole-layout',
    label: '屏的位置',
    value: 'smaller',
    options: [
      { value: 'smaller', label: 'v < u：缩小的像' },
      { value: 'same', label: 'v = u：等大的像' },
      { value: 'larger', label: 'v > u：放大的像' },
    ],
  },
]
export function universalFiles(overrides: Record<string, string> = {}) {
  return {
    ...files(),
    'experiment.json': JSON.stringify({
      ...manifest,
      schemaVersion: 3,
      protocolVersion: 3,
      experimentId: 'pinhole',
      renderer: 'canvas',
    }),
    'parameters.json': JSON.stringify({
      schemaVersion: 3,
      experimentId: 'pinhole',
      parameters,
      choices,
      readOnlySnapshot: ['domain', 'title', 'view', 'inspector', 'clock'],
    }),
    'teaching.json': JSON.stringify({
      schemaVersion: 3,
      experimentId: 'pinhole',
      title: '小孔成像',
      steps: ['改变物距，观察倒像。'],
      limitations: ['理想几何光学模型。'],
    }),
    'cases.json': JSON.stringify({
      schemaVersion: 3,
      experimentId: 'pinhole',
      source: 'platform-engine',
      cases: [
        {
          id: 'default',
          input: {
            parameters: Object.fromEntries(parameters.map((p) => [p.id, p.value])),
            choices: { 'pinhole-layout': 'smaller' },
          },
        },
      ],
    }),
    ...overrides,
  }
}
