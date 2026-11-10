import { questionEngine } from '@physicsos/physics-runtime'
const e = questionEngine('mechanics','one_dimensional_collision')
console.log('engine:', e?.engineId ?? '(none)')
const e2 = questionEngine('mechanics','uniformly_accelerated_motion')
console.log('mechanics:', e2?.engineId ?? '(none)')
