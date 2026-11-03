import { connectExperiment } from './protocol.js'
import { renderFrame } from './renderer.js'

let connection
const controls = new Map()
const root = document.getElementById('parameters')
function parameterInput(parameter) {
  let input = controls.get(parameter.id)
  if (!input) {
    const label = document.createElement('label')
    const text = document.createElement('span')
    text.textContent = `${parameter.label} (${parameter.unit || '无量纲'})`
    input = document.createElement('input')
    input.type = 'number'
    input.dataset.parameter = parameter.id
    if (parameter.min !== undefined) input.min = String(parameter.min)
    if (parameter.max !== undefined) input.max = String(parameter.max)
    input.step = String(parameter.step ?? 'any')
    input.addEventListener('change', () => {
      const value = input.valueAsNumber
      if (Number.isFinite(value) && input.checkValidity()) connection.send({ type: 'parameter/commit', protocolVersion: 3, id: parameter.id, value })
    })
    label.append(text, input)
    root.append(label)
    controls.set(parameter.id, input)
  }
  if (document.activeElement !== input) input.value = String(parameter.value)
}
function choiceInput(choice) {
  let select = controls.get(choice.id)
  if (!select) {
    const label = document.createElement('label')
    const text = document.createElement('span')
    text.textContent = choice.label
    select = document.createElement('select')
    for (const option of choice.options) {
      const element = document.createElement('option')
      element.value = option.value; element.textContent = option.label; select.append(element)
    }
    select.addEventListener('change', () => connection.send({ type: 'choice/set', protocolVersion: 3, id: choice.id, value: select.value }))
    label.append(text, select); root.append(label); controls.set(choice.id, select)
  }
  select.value = choice.value
}
connection = connectExperiment(async snapshot => {
  await renderFrame(snapshot)
  document.getElementById('title').textContent = snapshot.title
  document.getElementById('status').textContent = `平台引擎 · ${snapshot.domain} · revision ${snapshot.revision}`
  for (const section of snapshot.inspector) {
    for (const parameter of section.parameters ?? []) parameterInput(parameter)
    for (const choice of section.choices ?? []) choiceInput(choice)
  }
})
addEventListener('error', () => connection.reportError('RENDER_FAILED'))
addEventListener('unhandledrejection', () => connection.reportError('RENDER_FAILED'))
addEventListener('pagehide', () => connection.dispose(), { once: true })
