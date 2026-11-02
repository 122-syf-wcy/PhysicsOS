/** Development fixture only. The production host will use PhysicsOS Engine snapshots. */
const frame = document.querySelector('iframe')
const params = { objectDistanceCm: 30, focalLengthCm: 10, screenDistanceCm: 15 }
let preview
let revision = 0
let port
let token
const readout = document.querySelector('#readout')
function snapshot() {
  const values = preview ?? params
  const u = values.objectDistanceCm
  const f = values.focalLengthCm
  const v = Math.abs(u - f) < 1e-9 ? null : u * f / (u - f)
  return { revision, source: 'preview-fixture', parameters: { ...values }, result: { imageDistanceCm: v, imageHeightCm: v === null ? null : -6 * v / u, imageKind: v === null ? 'none' : v < 0 ? 'virtual' : 'real', screenSharp: v !== null && v > 0 && Math.abs(values.screenDistanceCm - v) < 0.5 } }
}
function publish() {
  const data = snapshot()
  port?.postMessage({ type: 'experiment/snapshot', snapshot: data })
  readout.textContent = `开发快照 r${revision} · 像距 ${data.result.imageDistanceCm === null ? '∞' : data.result.imageDistanceCm.toFixed(2)} cm · ${data.result.imageKind}`
  document.querySelectorAll('input').forEach(input => { input.value = data.parameters[input.name] })
}
function validChange(data) {
  if (!data || typeof data !== 'object' || !['parameter/preview', 'parameter/commit'].includes(data.type)) return false
  const ranges = { objectDistanceCm: [5, 60], focalLengthCm: [5, 20], screenDistanceCm: [5, 80] }
  const range = ranges[data.id]
  return range && Number.isFinite(data.value) && data.value >= range[0] && data.value <= range[1]
}
function receive(data) {
  if (data?.type === 'parameter/cancel') { preview = undefined; publish(); return }
  if (!validChange(data)) return
  if (data.type === 'parameter/preview') preview = { ...params, [data.id]: data.value }
  else { params[data.id] = data.value; preview = undefined; revision += 1 }
  publish()
}
addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== 'null' || port) return
  if (event.data?.type !== 'experiment/ready' || event.data.protocolVersion !== 1 || event.data.channel !== token) return
  const channel = new MessageChannel()
  port = channel.port1
  port.onmessage = event => { if (event.data?.type === 'experiment/connected') publish(); else receive(event.data) }
  port.start()
  // Opaque sandbox origin needs '*', solely for this port bootstrap to this exact iframe.
  frame.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 1, channel: token }, '*', [channel.port2])
})
function load() {
  port?.close(); port = undefined; preview = undefined
  token = crypto.randomUUID()
  frame.src = `/dist/index.html?hostOrigin=${encodeURIComponent(location.origin)}&channel=${token}`
}
document.querySelectorAll('input').forEach(input => input.addEventListener('change', () => receive({ type: 'parameter/commit', id: input.name, value: Number(input.value) })))
document.querySelector('#reload').addEventListener('click', load)
load()
publish()
