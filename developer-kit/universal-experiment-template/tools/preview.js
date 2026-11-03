const iframe = document.getElementById('experiment')
const channel = crypto.randomUUID()
const snapshot = await (await fetch('/dist/fixture.json')).json()
let connected = false
addEventListener('message', event => {
  if (connected || event.source !== iframe.contentWindow || event.origin !== location.origin || event.data?.type !== 'experiment/ready' || event.data.protocolVersion !== 3 || event.data.channel !== channel) return
  connected = true
  const pair = new MessageChannel()
  pair.port1.onmessage = event => {
    if (event.data?.type === 'experiment/connected') pair.port1.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'local-fixture-1', snapshot })
    else if (event.data?.type === 'experiment/rendered') document.getElementById('status').textContent = `固定平台快照已绘制 · ${snapshot.experimentId} · revision ${event.data.revision}。实时物理测试请打开 PhysicsOS 上传预览。`
    else if (event.data?.type === 'experiment/error') document.getElementById('status').textContent = `绘制失败：${event.data.code}`
    else document.getElementById('status').textContent = '已收到参数意图；固定快照不会重算。请在 PhysicsOS 上传预览中调节真实平台参数。'
  }
  pair.port1.start()
  iframe.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel }, location.origin, [pair.port2])
})
iframe.src = `/dist/index.html?hostOrigin=${encodeURIComponent(location.origin)}&channel=${channel}`
