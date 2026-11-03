/** Development fixture only. Production uses PhysicsOS Engine snapshots. */
const frame = document.querySelector('iframe')
const params = { objectDistanceCm: 30, focalLengthCm: 10, screenDistanceCm: 15, objectHeightCm: 6 }
const visible = { image: true, rays: true }
let preview
let revision = 0
let port
let token
let frameSequence = 0
const readout = document.querySelector('#readout')
function snapshot() {
  const values = preview ?? params
  const u = values.objectDistanceCm
  const f = values.focalLengthCm
  const v = Math.abs(u - f) < 1e-9 ? null : u * f / (u - f)
  // Local fixture geometry only; production forwards the engine's actual ray vertices.
  const top = { x: -u, y: values.objectHeightCm }
  const imageHeight = v === null ? null : -values.objectHeightCm * v / u
  const image = v === null ? undefined : { x: v, y: imageHeight }
  const rays = [{ x: 0, y: values.objectHeightCm }, { x: 0, y: 0 }, { x: 0, y: imageHeight ?? -values.objectHeightCm }].map(hit => {
    const slope = image ? (image.y - hit.y) / image.x : -values.objectHeightCm / u
    const end = image && v > 0 ? image : { x: 60, y: hit.y + 60 * slope }
    return { points: [top, hit, end], ...(image && v < 0 ? { extension: [hit, image] } : {}) }
  })
  return { revision, visible: { ...visible }, rays, source: 'preview-fixture', parameters: { ...values }, result: { imageDistanceCm: v, imageHeightCm: v === null ? null : -values.objectHeightCm * v / u, imageKind: v === null ? 'none' : v < 0 ? 'virtual' : 'real', screenSharp: v !== null && v > 0 && Math.abs(values.screenDistanceCm - v) < 0.5 } }
}
function publish() {
  const data = snapshot()
  port?.postMessage({ type: 'experiment/snapshot', protocolVersion: 2, frameId: `${token}:${++frameSequence}`, snapshot: data })
  readout.textContent = `开发快照 r${revision} · 像距 ${data.result.imageDistanceCm === null ? '∞' : data.result.imageDistanceCm.toFixed(2)} cm · ${data.result.imageKind}`
  document.querySelectorAll('input[type=number]').forEach(input => { input.value = data.parameters[input.name] })
  document.querySelectorAll('input[type=checkbox]').forEach(input => { input.checked = data.visible[input.name] })
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
  if (event.data?.type !== 'experiment/ready' || event.data.protocolVersion !== 2 || event.data.channel !== token) return
  const channel = new MessageChannel()
  port = channel.port1
  port.onmessage = event => { if (event.data?.type === 'experiment/connected' && event.data.protocolVersion === 2) publish(); else receive(event.data) }
  port.start()
  // Opaque sandbox origin needs '*', solely for this port bootstrap to this exact iframe.
  frame.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 2, channel: token }, '*', [channel.port2])
})
function load() {
  port?.close(); port = undefined; preview = undefined
  token = crypto.randomUUID()
  frame.src = `/dist/index.html?hostOrigin=${encodeURIComponent(location.origin)}&channel=${token}`
}
document.querySelectorAll('input[type=number]').forEach(input => input.addEventListener('change', () => {
  if (input.name === 'objectHeightCm') {
    const height = Number(input.value)
    if (Number.isFinite(height) && height >= 1 && height <= 12) { params.objectHeightCm = height; preview = undefined; revision += 1; publish() }
  } else receive({ type: 'parameter/commit', id: input.name, value: Number(input.value) })
}))
document.querySelectorAll('input[type=checkbox]').forEach(input => input.addEventListener('change', () => { visible[input.name] = input.checked; preview = undefined; revision += 1; publish() }))
document.querySelector('#reload').addEventListener('click', load)
load()
publish()
