import { createMechanicsScene } from '@physicsos/physics-scene'
import { validateScene } from '@physicsos/physics-core'
const scene = createMechanicsScene({ sceneId:'s', model:'spring_statics', mass:0.2, springConstant:100, gravity:{x:0,y:-10,z:0}, position:{x:0,y:0,z:0}, velocity:{x:0,y:0,z:0} })
const v = validateScene(scene)
console.log('status:', v.status ?? v.valid)
console.log('checks:', JSON.stringify((v.checks??[]).map(c=>`${c.name}:${c.passed??c.status}:${c.detail??''}`)).slice(0,400))
