import { createMechanicsScene } from '@physicsos/physics-scene'
import { MechanicsEngine } from '@physicsos/engine-mechanics'
const scene = createMechanicsScene({ sceneId:'s', model:'simple_pendulum', mass:0.1, pendulumLength:1.0, gravity:{x:0,y:-10,z:0}, position:{x:0,y:0,z:0}, velocity:{x:0,y:0,z:0} })
const engine = new MechanicsEngine()
const sol = engine.solve(scene, { targets:['period'], durationSec: 10 })
console.log(JSON.stringify(sol, null, 1).slice(0, 600))
