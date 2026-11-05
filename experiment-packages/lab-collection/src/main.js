import { connectExperiment } from './protocol.js'
import { renderFrame, disposeRenderer } from './renderer.js'

const controls = new Map(), root = document.getElementById('parameters')
let connection, current
function send(intent) { connection.send({ ...intent, protocolVersion: 3 }) }
function parameterInput(parameter) {
  let input = controls.get(parameter.id)
  if (!input) {
    const label = document.createElement('label'), text = document.createElement('span')
    text.textContent = `${parameter.label}${parameter.unit ? ` / ${parameter.unit}` : ''}`
    input = document.createElement('input'); input.type = 'number'; input.dataset.parameter = parameter.id
    if (parameter.min !== undefined) input.min = String(parameter.min)
    if (parameter.max !== undefined) input.max = String(parameter.max)
    input.step = String(parameter.step ?? 'any')
    input.addEventListener('change', () => {
      const value = input.valueAsNumber
      // The platform's step is an editing increment, not a lattice anchored at min.
      // Several registered defaults are deliberately not aligned with native step.
      const valid = Number.isFinite(value) && (parameter.min === undefined || value >= parameter.min) && (parameter.max === undefined || value <= parameter.max)
      input.setAttribute('aria-invalid', String(!valid))
      if (valid) send({ type: 'parameter/commit', id: parameter.id, value })
    })
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { input.value = String(current?.inspector.flatMap(s => s.parameters ?? []).find(p => p.id === parameter.id)?.value ?? parameter.value); send({ type: 'parameter/cancel' }); input.blur() } })
    label.append(text, input); root.append(label); controls.set(parameter.id, input)
  }
  if (document.activeElement !== input) input.value = String(parameter.value)
}
function choiceInput(choice) {
  let select = controls.get(choice.id)
  if (!select) {
    const label = document.createElement('label'), text = document.createElement('span'); text.textContent = choice.label
    select = document.createElement('select')
    for (const option of choice.options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; select.append(node) }
    select.addEventListener('change', () => send({ type: 'choice/set', id: choice.id, value: select.value }))
    label.append(text, select); root.append(label); controls.set(choice.id, select)
  }
  select.value = choice.value
}
connection = connectExperiment(async snapshot => {
  current = snapshot
  await renderFrame(snapshot)
  document.getElementById('title').textContent = snapshot.title
  document.title = `${snapshot.title} · PhysicsOS`
  document.getElementById('status').textContent = '调节条件，观察变化'
  for (const section of snapshot.inspector) {
    for (const parameter of section.parameters ?? []) parameterInput(parameter)
    for (const choice of section.choices ?? []) choiceInput(choice)
  }
  document.getElementById('playback').hidden = !(snapshot.clock.total > 0)
  document.getElementById('play').textContent = snapshot.clock.running ? '暂停' : '播放'
  const seek = document.getElementById('seek'); seek.max = String(snapshot.clock.total); seek.value = String(snapshot.clock.time)
  document.getElementById('time').textContent = `${Number(snapshot.clock.time.toPrecision(3))} / ${Number(snapshot.clock.total.toPrecision(3))} s`
})
document.getElementById('play').addEventListener('click', () => send({ type: 'playback/running', running: !current?.clock.running }))
document.getElementById('seek').addEventListener('input', event => send({ type: 'playback/seek', time: Number(event.target.value) }))
const failure = () => { document.getElementById('status').textContent = '三维画面暂时无法显示，请刷新或使用支持 WebGL 的浏览器。'; connection.reportError('RENDER_FAILED') }
addEventListener('error', failure); addEventListener('unhandledrejection', failure); document.addEventListener('lab-render-failed', failure)
addEventListener('pagehide', () => { connection.dispose(); disposeRenderer() }, { once: true })
