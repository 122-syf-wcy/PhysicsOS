import { derivedScalar, isScalarQuantity, type SimulationResult } from '@physicsos/physics-core'
import type { PhysicsScene } from '@physicsos/physics-scene'

import { emptyVisualModel, type SceneVisualModel } from './scene-visual-model.ts'
import { formatSignificant } from './number-format.ts'

const fmt = formatSignificant

export const modernSceneVisual = (
  scene: PhysicsScene,
  simulation: SimulationResult,
): SceneVisualModel => {
  const bench = scene.modernPhysicsBenches?.[0]
  if (bench === undefined) {
    return emptyVisualModel('modern')
  }
  const scalar = (key: string): number => {
    try {
      return derivedScalar(simulation.derivedQuantities, key).value
    } catch {
      return Number.NaN
    }
  }
  const emits = scalar('emits_photoelectrons') > 0
  const photons = [0, 1, 2].map(index => ({
    id: `modern-photon-${index}`,
    kind: 'history' as const,
    points: [
      { x: -170, y: -30 + index * 30 },
      { x: -20, y: -30 + index * 30 },
    ],
  }))
  const electrons = emits
    ? [0, 1, 2].map(index => ({
      id: `modern-electron-${index}`,
      kind: 'predicted' as const,
      points: [
        { x: 0, y: -30 + index * 30 },
        { x: 160, y: -50 + index * 40 },
      ],
    }))
    : []
  return emptyVisualModel('modern', {
    extent: { width: 400, height: 220 },
    origin: { x: -200, y: -110 },
    grid: { minor: 20, major: 100 },
    axes: { x: '', y: '' },
    trajectories: [...photons, ...electrons],
    particles: [
      {
        id: 'modern-cathode',
        at: { x: 0, y: 0 },
        sign: 'negative' as const,
        radius: 16,
        symbol: 'M',
      },
      ...(emits
        ? [
          {
            id: 'modern-photoelectron',
            at: { x: 85, y: 0 },
            sign: 'negative' as const,
            radius: 7,
            symbol: 'e⁻',
          },
        ]
        : []),
    ],
    labels: [
      {
        id: 'modern-photon-label',
        at: { x: -90, y: 70 },
        text: '单色光入射',
        anchor: 'middle',
      },
      {
        id: 'modern-cathode-label',
        at: { x: 0, y: -85 },
        text: '金属阴极',
        anchor: 'middle',
      },
      {
        id: 'modern-electron-label',
        at: { x: 95, y: 70 },
        text: emits ? '光电子逸出' : '无光电子逸出',
        anchor: 'middle',
      },
    ],
    overlay: {
      readout: [
        '光电效应 · 装置示意',
        `λ = ${fmt(bench.photonWavelength.value)} m`,
        `光子能量 E = ${fmt(scalar('photon_energy'))} J`,
        `逸出功 W = ${fmt(bench.workFunction.value)} J`,
        `截止频率 f₀ = ${fmt(scalar('threshold_frequency'))} Hz`,
        `Kmax = ${fmt(scalar('max_kinetic_energy'))} J`,
        `遏止电压 Us = ${fmt(scalar('stopping_potential'))} V`,
        `光电流 I = ${fmt(scalar('photocurrent'))} A`,
      ],
      scale: { label: '', length: 0 },
    },
    visible: {
      photonEnergy: scene.observableDefinitions.some(
        definition => definition.type === 'energy' && definition.visible,
      ),
      photocurrent: scene.observableDefinitions.some(
        definition => definition.type === 'current' && definition.visible,
      ),
      stoppingPotential: scene.observableDefinitions.some(
        definition => definition.type === 'voltage' && definition.visible,
      ),
    },
  })
}

export const modernDerivedRows = (simulation: SimulationResult) =>
  simulation.derivedQuantities
    .filter(entry => isScalarQuantity(entry.value))
    .map(entry => ({
      id: entry.key,
      title: entry.key,
      expression: entry.formula?.expression ?? entry.key,
      result: {
        symbol: entry.key,
        value: isScalarQuantity(entry.value) ? fmt(entry.value.value) : '—',
        unit: isScalarQuantity(entry.value) ? entry.value.unit : '',
      },
    }))
