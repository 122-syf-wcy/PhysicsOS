import { describe, expect, it } from 'vitest'
import { questionCodePrompt } from '../src/question-code-prompt.ts'
import type { PhysicsSceneSnapshot } from '../src/types.ts'

const style = {
  experimentId: 'magnetic-circular', styleVersion: 'test', developerPrompt: '', publishedBody: '',
  renderContract: 'snapshot.view.particles[].at is native view geometry; snapshot.clock.time is physical seconds.',
  allowedAssetPaths: [],
}
const snapshot: PhysicsSceneSnapshot = {
  sceneId: 'magnetic-question', revision: 3, domain: 'magnetic', engineId: 'engine-magnetic',
  title: '质子圆周运动', cause: 'solved',
  scene: { id: 'magnetic-question', revision: 3 },
}

describe('magnetic native author contract', () => {
  it('keeps native particle coordinates, transform and platform time explicit without introducing solver defaults', () => {
    const text = questionCodePrompt(style, snapshot, undefined, undefined, [])
    for (const rule of ['view.particles', 'cm视图坐标', '禁止再乘100', 'view.bodies为空',
      'ctx.setTransform(d*s,0,0,-d*s,d*ox,d*oy)', 'ctx.arc(p.at.x,p.at.y',
      'Canvas只创建并挂载一次', '不要每帧replaceChildren或重建', '稳定CTM', '纳秒量级', '禁止按毫秒取整',
      'v0', '保留#parameters', 'resize', '禁止重算圆周运动']) {
      expect(text).toContain(rule)
    }
    expect(text).not.toContain('1.67e-27')
    expect(text).not.toContain('1e6')
    expect(text).not.toContain('0.4 T')
    expect(text).toContain('作者最多2轮')
    expect(text).toContain('10次')
  })

  it('does not apply the uniform magnetic contract to another domain or template', () => {
    for (const [context, scene] of [
      [{ ...style, experimentId: 'velocity-selector' }, snapshot],
      [style, { ...snapshot, domain: 'electric', engineId: 'engine-electric' }],
    ] as const) {
      expect(questionCodePrompt(context, scene, undefined, undefined, [])).not.toContain('匀强磁场圆周绘制：')
    }
  })
})
