import {
  PHYSICS_TOOL_NAMES,
  PHYSICS_TOOL_RENDERERS,
  PhysicsToolRuntime,
  fmt,
  renderCommand,
  renderExperiments,
  renderObserve,
  renderScene,
  renderSimulate,
  renderSolve,
} from '../src/index.ts'

describe('fmt', () => {
  it('keeps four significant figures and switches to exponent form outside the decimal range', () => {
    expect(fmt(0)).toBe('0')
    expect(fmt(null)).toBe('n/a')
    expect(fmt(15.1)).toBe('15.1')
    expect(fmt((1.67e-27 * 2e6) / (1.6e-19 * 0.5))).toBe('0.04175')
    expect(fmt(9.8)).toBe('9.8')
    expect(fmt(-9.8)).toBe('-9.8')
    expect(fmt(2e6)).toBe('2e+6')
    expect(fmt(1.67e-27)).toBe('1.67e-27')
    expect(fmt(123456)).toBe('1.235e+5')
    expect(fmt(0.00099)).toBe('9.9e-4')
  })
})

describe('model-facing renders', () => {
  const runtime = new PhysicsToolRuntime()

  it('lists experiments grouped by domain with stage and description', () => {
    const rendered = renderExperiments(runtime.listExperiments())
    expect(rendered).toContain('共 33 个实验：')
    expect(rendered).toContain('[mechanics]')
    expect(rendered).toContain('- projectile-horizontal（高中）平抛运动：')
    expect(rendered).toContain('[wave]')
  })

  it('describes a scene with its objects, observables and commands', () => {
    const scene = runtime.createExperiment('magnetic-circular')
    const rendered = renderScene(scene)
    expect(rendered).toContain(`场景 ${scene.sceneId} · 修订 0 · 磁场中的带电粒子运动`)
    expect(rendered).toContain('领域 magnetic · 引擎 engine-magnetic')
    expect(rendered).toContain('- field-1 [uniform_magnetic]')
    expect(rendered).toContain('可用命令：')
    expect(rendered).toContain('SetMagneticFieldStrength')
  })

  it('renders a simulation with verification, derived scalars and events', () => {
    const scene = runtime.createExperiment('magnetic-circular')
    const rendered = renderSimulate(runtime.simulate(scene.sceneId))
    expect(rendered).toContain('引擎 engine-magnetic（magnetic）')
    expect(rendered).toContain('校验：passed')
    expect(rendered).toContain('- cyclotron_radius = 0.04175 m')
  })

  it('renders accepted and refused commands distinctly', () => {
    const scene = runtime.createExperiment('magnetic-circular')
    const ok = runtime.applyCommand(scene.sceneId, 'SetMagneticFieldStrength', {
      fieldId: 'field-1',
      strength: { value: 1, unit: 'T' },
    })
    expect(renderCommand(ok)).toContain('现在是修订 1（事件 MagneticFieldStrengthChanged）')

    const standing = runtime.createExperiment('wave-standing')
    const refused = runtime.applyCommand(standing.sceneId, 'SetWaveFrequency', {
      benchId: 'wave-bench-1',
      frequency: { value: 30, unit: 'Hz' },
    })
    const rendered = renderCommand(refused)
    expect(rendered).toContain('已拒绝（WAVE_WRONG_SUBMODEL）')
    expect(rendered).toContain('保持修订 0 不变')
  })

  it('renders an observed state with positions and velocities in units', () => {
    const scene = runtime.createExperiment('projectile-horizontal')
    const rendered = renderObserve(runtime.observe(scene.sceneId, 1))
    expect(rendered).toContain('在 t = 1 s 的状态')
    expect(rendered).toContain('位置 (10, 15.1) m')
    expect(rendered).toContain('速度 (10, -9.8) m/s')
  })

  it('renders a solved question with answers, steps, verification and the live scene', () => {
    const solved = runtime.solveQuestion(
      '一个质子以 2.0×10^6 m/s 的速度，垂直进入磁感应强度为 0.50 T，方向垂直纸面向里的匀强磁场。已知：m = 1.67×10^-27 kg，q = +1.60×10^-19 C。求：1. 洛伦兹力大小 2. 轨道半径 3. 运动周期 4. 判断运动方向 5. 显示运动轨迹',
    )
    const rendered = renderSolve(solved)
    expect(rendered).toContain('已求解（magnetic')
    expect(rendered).toContain('题库题 01-proton-basic')
    expect(rendered).toContain('答案：')
    expect(rendered).toContain('轨道半径')
    expect(rendered).toContain('校验：passed')
    expect(rendered).toContain(
      '场景已就绪：sceneId = question-golden-01-proton-basic（修订 0，引擎 engine-magnetic）',
    )
  })

  it('renders a rejected question with reasons and an explicit no-guessing instruction', () => {
    const rejected = runtime.solveQuestion('一个粒子在磁场里运动，求半径。')
    const rendered = renderSolve(rejected)
    expect(rendered).toContain('未能求解')
    expect(rendered).toContain('原因：')
    expect(rendered).toContain('请不要自行估算答案')
    expect(rendered).not.toContain('答案：')
  })

  it('offers one renderer per tool name', () => {
    expect(Object.keys(PHYSICS_TOOL_RENDERERS).sort()).toEqual([...PHYSICS_TOOL_NAMES].sort())
    const listing = runtime.listExperiments()
    expect(PHYSICS_TOOL_RENDERERS.physics_list_experiments(listing)).toBe(
      renderExperiments(listing),
    )
  })
})
