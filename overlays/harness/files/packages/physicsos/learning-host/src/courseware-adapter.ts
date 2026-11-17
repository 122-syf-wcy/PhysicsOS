/** Exact-byte, backend-only adaptation of one audited, self-contained lesson. */
import { createHash } from 'node:crypto'

/** Changes to the byte allowlist or transformation require a new adapter version. */
export const COURSEWARE_ADAPTER_VERSION = 'sound-guizhou-c-v1'

const ORIGINAL_BYTES = 3_317_789
const ORIGINAL_SHA256 = '9ab882e3643fc669d04138388b590f492151ca48c1022b61dc68627acb92403e'
const ADAPTED_BYTES = 3_328_723
const ADAPTED_SHA256 = '911b5f372a3623557095139cb0c4665b7b15a80c75110dfd81947ca51ff071d1'
const SLIDE_IDS: readonly string[] = Object.freeze([
  'cover',
  'guizhou-question',
  'goals',
  'vibration',
  'pitch-chapter',
  'ruler-prediction',
  'ruler-method',
  'ruler-record',
  'frequency-definition',
  'wave-reading',
  'pitch-lab',
  'hearing-range',
  'pitch-check',
  'loudness-chapter',
  'fork-method',
  'amplitude-definition',
  'amplitude-lab',
  'distance',
  'language',
  'timbre-chapter',
  'timbre-definition',
  'timbre-lab',
  'instrument-transfer',
  'summary',
  'guizhou-answer',
  'compare-waves',
  'calculation',
  'quiz',
  'exit',
  'homework',
  'credits',
])

/** Already-adapted standalone imports need no second bridge. Recognition remains exact-byte only. */
export function inspectKnownSoundCoursewareArtifact(bytes: Uint8Array): { readonly adapterVersion: string; readonly slideIds: readonly string[]; readonly width: 1920; readonly height: 1080 } | undefined {
  if (bytes.byteLength !== ADAPTED_BYTES || createHash('sha256').update(bytes).digest('hex') !== ADAPTED_SHA256) return undefined
  return { adapterVersion: COURSEWARE_ADAPTER_VERSION, slideIds: SLIDE_IDS, width: 1920, height: 1080 }
}

const EMBEDDED_CSS = String.raw`
/* Embedding is not capture mode: keep teaching animations and all controller DOM. */
body[data-courseware-embedded="true"] .chrome,
body[data-courseware-embedded="true"] .deck-controls { display: none !important; }
body[data-courseware-embedded="true"] .deck-viewport { inset: 0 !important; }
.courseware-source-url { overflow-wrap: anywhere; user-select: text; }
#recordsJsonText { display: block; width: 100%; min-height: 320px; resize: vertical; padding: 12px; border: 1px solid #bac9b9; background: #fffdf7; color: inherit; font: 13px/1.6 monospace; }
#recordsJsonDialog .record-tools { flex-wrap: wrap; }
`

const RECORDS_JSON_DIALOG = String.raw`<dialog id="recordsJsonDialog" aria-labelledby="recordsJsonTitle"><header class="dialog-header"><h2 id="recordsJsonTitle">本次课堂记录 JSON</h2><button type="button" data-action="close">关闭</button></header><div class="dialog-body"><p id="recordsJsonHelp">这里是本次真实填写的观察和主动保存的模型记录，不是预设实验结果。沙箱不下载文件，请选中文本后按 ⌘C / Ctrl+C 复制。</p><textarea id="recordsJsonText" readonly spellcheck="false" aria-label="本次课堂记录 JSON 文本" aria-describedby="recordsJsonHelp recordsJsonStatus"></textarea><div class="record-tools"><button type="button" data-action="select-records-json">选中 JSON 文本</button></div><p id="recordsJsonStatus" role="status"></p></div></dialog>`

// This is source text, not a dependency on a browser, a file, or a generated bundle.
const COURSEWARE_BRIDGE = String.raw`
/* The window channel is used only for the nonce-bound, one-time port handoff. */
const courseware = {
  port: null,
  removeConnectListener: null,
  incomingSeq: 0,
  outgoingSeq: 0,
  incomingTimes: [],
  outgoingTimes: [],
  pending: [],
  timer: null,
  stateRequested: false,
  lastState: -Infinity,
}
const COURSEWARE_MAX_PACKET_BYTES = 16384
const COURSEWARE_MAX_PACKETS_PER_SECOND = 90
const COURSEWARE_STATE_INTERVAL = 1000 / 30
const coursewareEncoder = new TextEncoder()
const coursewareSlides = config.slides.map(({ id, title }) => ({ id, title }))

function coursewareObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function coursewarePacketSize(packet) {
  try { return coursewareEncoder.encode(JSON.stringify(packet)).byteLength }
  catch { return Infinity }
}
function pruneCoursewareTimes(times, now) {
  while (times.length && times[0] <= now - 1000) times.shift()
}
function closeCoursewarePort() {
  courseware.removeConnectListener?.()
  courseware.removeConnectListener = null
  if (courseware.timer !== null) clearTimeout(courseware.timer)
  courseware.timer = null
  courseware.pending.length = 0
  courseware.stateRequested = false
  const port = courseware.port
  courseware.port = null
  if (port) {
    port.onmessage = null
    port.onmessageerror = null
    port.close()
  }
}
function scheduleCoursewareFlush(delay = 0) {
  if (!courseware.port || courseware.timer !== null) return
  courseware.timer = setTimeout(flushCourseware, Math.max(0, delay))
}
function queueCoursewarePacket(packet) {
  if (!courseware.port) return
  // Bound memory even if a peer continuously consumes its entire rate allowance.
  if (courseware.pending.length >= 180) { closeCoursewarePort(); return }
  courseware.pending.push(packet)
  scheduleCoursewareFlush()
}
function sendCoursewarePacket(payload) {
  if (!courseware.port) return false
  const seq = courseware.outgoingSeq + 1
  if (!Number.isSafeInteger(seq)) { closeCoursewarePort(); return false }
  const packet = { ...payload, protocol: 1, seq }
  if (coursewarePacketSize(packet) > COURSEWARE_MAX_PACKET_BYTES) {
    closeCoursewarePort()
    return false
  }
  try { courseware.port.postMessage(packet) }
  catch { closeCoursewarePort(); return false }
  courseware.outgoingSeq = seq
  courseware.outgoingTimes.push(performance.now())
  return true
}
function coursewareState() {
  const rect = stage.getBoundingClientRect()
  return {
    type: 'courseware/state',
    slideId: config.slides[state.page].id,
    index: state.page,
    total: config.slides.length,
    slides: coursewareSlides,
    stage: {
      width: 1920,
      height: 1080,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      scale: rect.width / 1920,
    },
    // The parent may overlay annotations only while no teaching dialog is open.
    interactive: !dialogs.some(dialog => dialog.open),
  }
}
function flushCourseware() {
  if (!courseware.port) { courseware.timer = null; return }
  let now = performance.now()
  pruneCoursewareTimes(courseware.outgoingTimes, now)
  // Apply parent commands only when both their ack and a report have a slot.
  // A queued, unacknowledged command must never leak into an earlier state.
  while (courseware.port && courseware.pending.length && courseware.outgoingTimes.length < COURSEWARE_MAX_PACKETS_PER_SECOND - (courseware.stateRequested ? 1 : 0)) {
    const queued = courseware.pending[0]
    if (queued.type === 'courseware/command' && courseware.outgoingTimes.length >= COURSEWARE_MAX_PACKETS_PER_SECOND - 1) break
    courseware.pending.shift()
    const packet = queued.type === 'courseware/command' ? executeCoursewareCommand(queued) : queued
    if (!sendCoursewarePacket(packet)) return
    if (packet.type === 'courseware/ack') courseware.stateRequested = true
  }
  if (!courseware.port) return
  now = performance.now()
  pruneCoursewareTimes(courseware.outgoingTimes, now)
  if (courseware.stateRequested && courseware.outgoingTimes.length < COURSEWARE_MAX_PACKETS_PER_SECOND && now - courseware.lastState >= COURSEWARE_STATE_INTERVAL) {
    if (!sendCoursewarePacket(coursewareState())) return
    courseware.stateRequested = false
    courseware.lastState = performance.now()
  }
  courseware.timer = null
  if (!courseware.pending.length && !courseware.stateRequested) return
  const commandWaitingForSlots = courseware.pending[0]?.type === 'courseware/command' && courseware.outgoingTimes.length >= COURSEWARE_MAX_PACKETS_PER_SECOND - 1
  const rateBlocked = courseware.outgoingTimes.length >= COURSEWARE_MAX_PACKETS_PER_SECOND || (commandWaitingForSlots && !courseware.stateRequested)
  const rateDelay = rateBlocked ? Math.max(1, courseware.outgoingTimes[0] + 1000 - performance.now()) : 0
  const waitingForState = courseware.stateRequested && (!courseware.pending.length || courseware.outgoingTimes.length >= COURSEWARE_MAX_PACKETS_PER_SECOND - 1)
  const stateDelay = waitingForState ? Math.max(0, courseware.lastState + COURSEWARE_STATE_INTERVAL - performance.now()) : 0
  scheduleCoursewareFlush(Math.max(rateDelay, stateDelay))
}
function reportStage() {
  if (!courseware.port) return
  courseware.stateRequested = true
  // Coalesce local changes; the output dispatcher sends command acks first.
  scheduleCoursewareFlush()
}
// Native Escape, close buttons and direct open-attribute changes all report state.
const dialogStateObserver = new MutationObserver(reportStage)
for (const dialog of dialogs) dialogStateObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] })
function executeCoursewareCommand(packet) {
  let error
  try {
    switch (packet.command) {
      case 'next': showPage(state.page + 1); break
      case 'prev': showPage(state.page - 1); break
      case 'goto': {
        const index = config.slides.findIndex(slide => slide.id === packet.slideId)
        if (index === -1) error = 'unknown-slide'
        else showPage(index)
        break
      }
      case 'state': break
      case 'outline': if (!byId('outlineDialog').open) openDialog('outlineDialog'); break
      case 'notes': if (!byId('notesDialog').open) openDialog('notesDialog'); break
      case 'motion': state.motion = !state.motion; applyMotion(); break
      case 'stop-audio': stopAudio('试听已停止。'); break
    }
  } catch { error = 'command-failed' }
  const ack = { type: 'courseware/ack', requestId: packet.requestId, ok: !error }
  if (error) ack.error = error
  return ack
}
function receiveCoursewareCommand(event) {
  if (!courseware.port) return
  if (event.ports.length) {
    for (const port of event.ports) port.close()
    closeCoursewarePort()
    return
  }
  const packet = event.data
  const now = performance.now()
  pruneCoursewareTimes(courseware.incomingTimes, now)
  if (courseware.incomingTimes.length >= COURSEWARE_MAX_PACKETS_PER_SECOND || !coursewareObject(packet) || coursewarePacketSize(packet) > COURSEWARE_MAX_PACKET_BYTES) {
    closeCoursewarePort()
    return
  }
  courseware.incomingTimes.push(now)
  const keys = ['type', 'protocol', 'seq', 'requestId', 'command', 'slideId']
  const commands = ['next', 'prev', 'goto', 'state', 'outline', 'notes', 'motion', 'stop-audio']
  if (Object.keys(packet).some(key => !keys.includes(key)) || packet.type !== 'courseware/command' || packet.protocol !== 1 || !Number.isSafeInteger(packet.seq) || packet.seq <= courseware.incomingSeq || typeof packet.requestId !== 'string' || !commands.includes(packet.command) || (Object.hasOwn(packet, 'slideId') && typeof packet.slideId !== 'string') || (packet.command === 'goto' && typeof packet.slideId !== 'string')) {
    closeCoursewarePort()
    return
  }
  // Check response overhead before any command side effect. Even an error ack
  // with the longest possible sequence must fit; never truncate a requestId.
  const largestAck = { type: 'courseware/ack', protocol: 1, seq: Number.MAX_SAFE_INTEGER, requestId: packet.requestId, ok: false, error: 'command-failed' }
  if (coursewarePacketSize(largestAck) > COURSEWARE_MAX_PACKET_BYTES) {
    closeCoursewarePort()
    return
  }
  courseware.incomingSeq = packet.seq
  queueCoursewarePacket(packet)
}
function connectCourseware() {
  const contentURL = new URL(location.href)
  const query = contentURL.searchParams
  const nonce = query.get('cwNonce') || ''
  const parentOrigin = query.get('parentOrigin') || ''
  if (parent === window || query.getAll('cwNonce').length !== 1 || query.getAll('parentOrigin').length !== 1 || !/^[A-Za-z0-9_-]{32,80}(?![\s\S])/.test(nonce)) return
  let originURL
  try { originURL = new URL(parentOrigin) } catch { return }
  if (!['https:', 'http:'].includes(originURL.protocol) || originURL.origin !== parentOrigin || parentOrigin !== contentURL.origin) return
  document.body.dataset.coursewareEmbedded = 'true'
  const listener = event => {
    if (event.source !== parent || event.origin !== parentOrigin) return
    const packet = event.data
    if (!coursewareObject(packet) || coursewarePacketSize(packet) > COURSEWARE_MAX_PACKET_BYTES || Object.keys(packet).some(key => !['type', 'protocol', 'nonce'].includes(key)) || packet.type !== 'courseware/connect' || packet.protocol !== 1 || packet.nonce !== nonce || event.ports.length !== 1) {
      for (const port of event.ports) port.close()
      return
    }
    window.removeEventListener('message', listener)
    courseware.removeConnectListener = null
    courseware.port = event.ports[0]
    const port = courseware.port
    port.onmessage = receiveCoursewareCommand
    port.onmessageerror = closeCoursewarePort
    port.start()
    reportStage()
  }
  courseware.removeConnectListener = () => window.removeEventListener('message', listener)
  window.addEventListener('message', listener)
  parent.postMessage({ type: 'courseware/ready', protocol: 1, nonce }, parentOrigin)
}
connectCourseware()
`

// Exact anchors are an additional fail-closed guard, not recognition heuristics.
const TEXT_PATCHES: readonly (readonly [string, string])[] = [
  ['</style></head>', `${EMBEDDED_CSS}</style></head>`],
  ['<script type="application/json" id="course-config">', `${RECORDS_JSON_DIALOG}\n<script type="application/json" id="course-config">`],
  ['运行课件不访问外部服务；只有主动点击来源链接才会联网。', '运行课件不访问外部服务；来源 URL 仅以不可导航的纯文本展示，不打开外部页面。'],
  ['导出本次记录 JSON', '查看/复制本次记录 JSON'],
  [String.raw`function exportRecords() {
  const data = { courseId: config.lesson.id, exportedAt: new Date().toISOString(), observations: state.observations, simulatedRecords: state.records, choices: state.answers }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '声音的特性-本次课堂记录.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}`, String.raw`function selectRecordsJSON() {
  const text = byId('recordsJsonText')
  text.focus()
  text.select()
  byId('recordsJsonStatus').textContent = '已选中 JSON；请按 ⌘C / Ctrl+C 复制。'
}
function exportRecords() {
  const data = { courseId: config.lesson.id, exportedAt: new Date().toISOString(), observations: state.observations, simulatedRecords: state.records, choices: state.answers }
  byId('recordsJsonText').value = JSON.stringify(data, null, 2)
  openDialog('recordsJsonDialog')
  selectRecordsJSON()
}`],
  ["    case 'export-records': exportRecords(); break", "    case 'export-records': exportRecords(); break\n    case 'select-records-json': selectRecordsJSON(); break"],
  ["if (new URL(location.href).searchParams.get('capture') === '1') document.body.classList.add('capture')\n", ''],
  ["  return state.motion && !motion.matches && !document.hidden && !document.body.classList.contains('capture')", '  return state.motion && !motion.matches && !document.hidden'],
  ['let scanFrame = null\n', `let scanFrame = null\n${COURSEWARE_BRIDGE}\n`],
  ['  stage.dataset.scale = factor\n}', '  stage.dataset.scale = factor\n  reportStage()\n}'],
  ["window.visualViewport?.addEventListener('resize', sizeStage)", "window.visualViewport?.addEventListener('resize', sizeStage)\nconst stageResizeObserver = new ResizeObserver(sizeStage)\nstageResizeObserver.observe(viewport)"],
  ['function showPage(index, updateHash = true) {', 'function showPage(index) {'],
  ["  if (updateHash && !document.body.classList.contains('capture')) {\n    try { history.replaceState(null, '', `#slide-${next + 1}`) } catch { /* Some local viewers restrict history. */ }\n  }\n}", '  reportStage()\n}'],
  ["  byId(id).showModal()\n}", "  byId(id).showModal()\n  reportStage()\n}"],
  [String.raw`async function fullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch { byId('fullscreen').textContent = '全屏不可用' }
}`, String.raw`function fullscreen() {
  queueCoursewarePacket({ type: 'courseware/fullscreen' })
}`],
  ["window.addEventListener('pagehide', () => { stopAudio(); stopScan(); cancelMotion() })", "window.addEventListener('pagehide', () => { stopAudio(); stopScan(); cancelMotion(); stageResizeObserver.disconnect(); dialogStateObserver.disconnect(); closeCoursewarePort() })"],
  [String.raw`const match = location.hash.match(/^#slide-(\d+)$/)
showPage(match ? Number(match[1]) - 1 : 0, false)`, 'showPage(0)'],
]

function replaceOnce(text: string, before: string, after: string): string | undefined {
  const start = text.indexOf(before)
  if (start < 0 || text.indexOf(before, start + before.length) !== -1) return undefined
  return text.slice(0, start) + after + text.slice(start + before.length)
}

/**
 * Adapt only the exact allowlisted original HTML; unknown or changed bytes are untouched.
 *
 * This function does not persist either document. The service must retain the original
 * bytes separately and pass the returned copy through its own CSP/security policy.
 * No HTML asset is loaded into the JavaScript bundle and no lesson code is executed here.
 *
 * @param bytes - Original upload bytes, not a decoded/re-serialized HTML document.
 * @returns A new standalone HTML byte array and stable metadata, or undefined.
 */
export function adaptKnownSoundCourseware(bytes: Uint8Array): {
  bytes: Uint8Array
  adapterVersion: string
  slideIds: readonly string[]
  width: 1920
  height: 1080
  originalSha256: string
} | undefined {
  if (bytes.byteLength !== ORIGINAL_BYTES) return undefined
  // Hash and decode the same private snapshot, including for shared-buffer views.
  const original = Uint8Array.from(bytes)
  if (original.byteLength !== ORIGINAL_BYTES || createHash('sha256').update(original).digest('hex') !== ORIGINAL_SHA256) return undefined

  let html = new TextDecoder('utf-8', { fatal: true }).decode(original)
  for (const [before, after] of TEXT_PATCHES) {
    const patched = replaceOnce(html, before, after)
    if (patched === undefined) return undefined
    html = patched
  }

  let sourceLinks = 0
  html = html.replace(/<a href="(https:\/\/[^"<>]+)" target="_blank" rel="noopener noreferrer">打开来源<\/a>/g, (_link, url: string) => {
    sourceLinks += 1
    return `<span class="courseware-source-url">${url}</span>`
  })
  if (sourceLinks !== 4) return undefined

  const moduleTag = '<script type="module">'
  const start = html.indexOf(moduleTag)
  if (start < 0 || html.indexOf(moduleTag, start + moduleTag.length) !== -1) return undefined
  const end = html.indexOf('</script>', start)
  if (end < 0) return undefined
  const moduleSource = html.slice(start + moduleTag.length, end)
  // The allowlisted module contains thirteen declarations and no module dependencies.
  if (moduleSource.match(/^export (?=(?:const|function) )/gm)?.length !== 13) return undefined
  const classicSource = moduleSource.replace(/^export (?=(?:const|function) )/gm, '')
  html = html.slice(0, start) + `<script>\n(() => {\n'use strict'\n${classicSource}\n})()\n</script>` + html.slice(end + '</script>'.length)

  return {
    bytes: new TextEncoder().encode(html),
    adapterVersion: COURSEWARE_ADAPTER_VERSION,
    slideIds: SLIDE_IDS,
    width: 1920,
    height: 1080,
    originalSha256: ORIGINAL_SHA256,
  }
}
