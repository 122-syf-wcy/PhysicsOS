import { EXPERIMENT_TEMPLATES } from '../physics/experiment-templates.ts'
import { zh } from '../locales.ts'
import type { GlassSelectOption } from '../GlassSelect.tsx'

/** Only registered package/physics contracts can accept a contribution. */
export const DEFAULT_CONTRIBUTION_EXPERIMENT = 'convex-lens'
export const contributionTargets: readonly GlassSelectOption[] = [
  { value: DEFAULT_CONTRIBUTION_EXPERIMENT, label: '凸透镜成像规律' },
  ...EXPERIMENT_TEMPLATES.filter(item => item.id !== DEFAULT_CONTRIBUTION_EXPERIMENT).map(item => ({
    value: item.id,
    label: zh[item.label],
    disabled: item.comingSoon === true,
  })),
]

export const canUploadExperiment = (id: string): boolean =>
  contributionTargets.some(item => item.value === id && item.disabled !== true)
