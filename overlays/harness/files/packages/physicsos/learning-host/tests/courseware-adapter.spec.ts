import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  adaptKnownSoundCourseware,
  COURSEWARE_ADAPTER_VERSION,
} from '../src/courseware-adapter.ts'

// Both the overlay source tree and its applied vendor tree share these examples.
// Resolve only when this spec runs; do not depend on cwd or either path's depth.
function findExamples(): URL {
  let directory = new URL('.', import.meta.url)
  const files = ['sound-properties-guizhou-c.original.html', 'sound-properties-guizhou-c.adapted.html', 'provenance.json']
  for (;;) {
    const candidate = new URL('examples/courseware/sound-properties/', directory)
    if (files.every(file => existsSync(new URL(file, candidate)))) return candidate
    const parent = new URL('../', directory)
    if (parent.href === directory.href) throw new Error('Standalone sound courseware examples not found in any ancestor directory')
    directory = parent
  }
}

// These are real, standalone HTML files. Never load their scripts or a build script.
const examples = findExamples()
const original = readFileSync(new URL('sound-properties-guizhou-c.original.html', examples))
const adaptedFile = readFileSync(new URL('sound-properties-guizhou-c.adapted.html', examples))
const originalHTML = original.toString('utf8')
const adaptedHTML = adaptedFile.toString('utf8')
const ORIGINAL_SHA256 = '9ab882e3643fc669d04138388b590f492151ca48c1022b61dc68627acb92403e'
const EXPECTED_IDS = [
  'cover', 'guizhou-question', 'goals', 'vibration', 'pitch-chapter',
  'ruler-prediction', 'ruler-method', 'ruler-record', 'frequency-definition',
  'wave-reading', 'pitch-lab', 'hearing-range', 'pitch-check', 'loudness-chapter',
  'fork-method', 'amplitude-definition', 'amplitude-lab', 'distance', 'language',
  'timbre-chapter', 'timbre-definition', 'timbre-lab', 'instrument-transfer',
  'summary', 'guizhou-answer', 'compare-waves', 'calculation', 'quiz', 'exit',
  'homework', 'credits',
]

interface Provenance {
  schemaVersion: number
  adapterVersion: string
  original: { file: string; sha256: string; bytes: number; sourcePath: string }
  adapted: { file: string; sha256: string; bytes: number; executionDuringGeneration: boolean }
  slideIds: string[]
  stage: { width: number; height: number }
  sources: { id: string; url: string }[]
  copyright: {
    fonts: { license: string; notice: string }[]
    fixedStageCSS: { license: string; notice: string }
    rightsCaveat: string
  }
}
const provenance: Provenance = JSON.parse(readFileSync(new URL('provenance.json', examples), 'utf8'))

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}
// Compare every byte natively, without deep-enumerating multi-megabyte typed arrays.
// Respect each view's bounds rather than comparing its entire backing buffer.
function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.byteLength).toBe(expected.byteLength)
  const actualView = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)
  const expectedView = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength)
  expect(actualView.equals(expectedView)).toBe(true)
}
function capture(text: string, pattern: RegExp): string {
  const value = text.match(pattern)?.[1]
  if (value === undefined) throw new Error(`Static fixture section missing: ${pattern.source}`)
  return value
}
function between(text: string, before: string, after: string): string {
  const start = text.indexOf(before)
  const end = text.indexOf(after, start + before.length)
  if (start === -1 || end === -1) throw new Error('Static fixture boundary missing')
  return text.slice(start + before.length, end)
}
function configText(html: string): string {
  return capture(html, /<script type="application\/json" id="course-config">([\s\S]*?)<\/script>/)
}
function slides(html: string): { id: string; title: string; notes: string }[] {
  const config: { slides: { id: string; title: string; notes: string }[] } = JSON.parse(configText(html))
  return config.slides
}
function dialog(html: string, id: string): string {
  return `<dialog id="${id}"` + between(html, `<dialog id="${id}"`, '</dialog>') + '</dialog>'
}
function adapted(bytes: Uint8Array = original) {
  const result = adaptKnownSoundCourseware(bytes)
  if (result === undefined) throw new Error('The exact known original should be recognized')
  return result
}
const executableScripts = [...adaptedHTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter(match => !(match[1] ?? '').includes('application/json'))
  .map(match => match[2] ?? '')
const executable = executableScripts.join('\n')

describe('known sound courseware exact-byte adapter', () => {
  it('pins the real original and both standalone artifact digests in provenance', () => {
    expect(COURSEWARE_ADAPTER_VERSION).toBe('sound-guizhou-c-v1')
    expect(original.byteLength).toBe(3_317_789)
    expect(sha256(original)).toBe(ORIGINAL_SHA256)
    expect(provenance.schemaVersion).toBe(1)
    expect(provenance.adapterVersion).toBe(COURSEWARE_ADAPTER_VERSION)
    expect(provenance.original.file).toBe('sound-properties-guizhou-c.original.html')
    expect(provenance.original.sha256).toBe(ORIGINAL_SHA256)
    expect(provenance.original.bytes).toBe(original.byteLength)
    expect(provenance.original.sourcePath).toBe('/Users/dongsiwei/Desktop/PhysicsOS/demos/knowledge-visualization/sound-properties-guizhou-c.html')
    expect(provenance.adapted.file).toBe('sound-properties-guizhou-c.adapted.html')
    expect(provenance.adapted.sha256).toBe(sha256(adaptedFile))
    expect(provenance.adapted.bytes).toBe(adaptedFile.byteLength)
    expect(provenance.adapted.executionDuringGeneration).toBe(false)
  })

  it('returns a fresh deterministic copy, never changing or aliasing the input', () => {
    const input = new Uint8Array(original)
    const snapshot = input.slice()
    const result = adapted(input)
    expectSameBytes(input, snapshot)
    expect(result.bytes.buffer).not.toBe(input.buffer)
    expectSameBytes(result.bytes, adaptedFile)
    expect(result.originalSha256).toBe(ORIGINAL_SHA256)
    expect(result.adapterVersion).toBe(COURSEWARE_ADAPTER_VERSION)
    expect({ width: result.width, height: result.height }).toEqual({ width: 1920, height: 1080 })
    result.bytes[0] = 0
    const fresh = adapted(input)
    expect(fresh.bytes[0]).toBe(original[0])
    expect(fresh.bytes.buffer).not.toBe(result.bytes.buffer)
    expectSameBytes(fresh.bytes, adaptedFile)
    expectSameBytes(input, snapshot)
    expectSameBytes(readFileSync(new URL(provenance.original.file, examples)), original)
  })

  it('hashes only the supplied Uint8Array view, not its surrounding buffer', () => {
    const surrounding = new Uint8Array(original.byteLength + 16).fill(123)
    surrounding.set(original, 8)
    const snapshot = surrounding.slice()
    const view = surrounding.subarray(8, 8 + original.byteLength)
    const result = adapted(view)
    expectSameBytes(result.bytes, adaptedFile)
    expect(result.bytes.buffer).not.toBe(view.buffer)
    expectSameBytes(surrounding, snapshot)
    expect([...surrounding.subarray(0, 8)]).toEqual(Array(8).fill(123))
    expect([...surrounding.subarray(-8)]).toEqual(Array(8).fill(123))
  })

  it('rejects same-length edits, normalization, changed lengths and unknown HTML', () => {
    const changed = new Uint8Array(original)
    changed[100] = (changed[100] ?? 0) ^ 1
    const candidates = [
      changed,
      original.subarray(1),
      Buffer.concat([original, Buffer.from('\n')]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]),
      Buffer.from(originalHTML.replace(/\n/g, '\r\n')),
      Buffer.from('<!doctype html><html><body>声音的特性</body></html>'),
      adaptedFile,
      new Uint8Array(),
    ]
    for (const bytes of candidates) {
      const snapshot = Uint8Array.from(bytes)
      expect(adaptKnownSoundCourseware(bytes)).toBeUndefined()
      expectSameBytes(bytes, snapshot)
    }
  })

  it('retains all 31 stable authored IDs, titles, notes, models and embedded assets', () => {
    const result = adapted()
    expect(EXPECTED_IDS).toHaveLength(31)
    expect(new Set(EXPECTED_IDS).size).toBe(31)
    expect(result.slideIds).toEqual(EXPECTED_IDS)
    expect(Object.isFrozen(result.slideIds)).toBe(true)
    expect(provenance.slideIds).toEqual(EXPECTED_IDS)
    expect(provenance.stage).toEqual({ width: 1920, height: 1080 })
    expect(slides(originalHTML).map(slide => slide.id)).toEqual(EXPECTED_IDS)
    expect(slides(adaptedHTML)).toEqual(slides(originalHTML))
    expect([...adaptedHTML.matchAll(/<section\b[^>]*\bdata-slide-id="([^"]+)"/g)].map(match => match[1])).toEqual(EXPECTED_IDS)
    // Hash the unmodified JSON block instead of re-serializing multi-megabyte assets.
    expect(sha256(configText(adaptedHTML))).toBe(sha256(configText(originalHTML)))
  })

  it('preserves the actual teaching stage, controls, inputs, notes and license DOM', () => {
    expect(capture(adaptedHTML, /(<main class="deck-stage"[\s\S]*?<\/main>)/))
      .toBe(capture(originalHTML, /(<main class="deck-stage"[\s\S]*?<\/main>)/))
    expect(capture(adaptedHTML, /(<nav class="deck-controls"[\s\S]*?<\/nav>)/))
      .toBe(capture(originalHTML, /(<nav class="deck-controls"[\s\S]*?<\/nav>)/))
    for (const id of ['outlineDialog', 'notesDialog', 'dataDialog']) {
      expect(dialog(adaptedHTML, id)).toBe(dialog(originalHTML, id))
    }
    for (const match of originalHTML.matchAll(/\bid="([^"]+)"/g)) {
      expect(adaptedHTML).toContain(`id="${match[1]}"`)
    }
    const originalLicenses = [...originalHTML.matchAll(/(<details><summary>[\s\S]*?<\/details>)/g)].map(match => match[1])
    const adaptedLicenses = [...adaptedHTML.matchAll(/(<details><summary>[\s\S]*?<\/details>)/g)].map(match => match[1])
    expect(originalLicenses).toHaveLength(3)
    expect(adaptedLicenses).toEqual(originalLicenses)
    const modelStart = 'const WINDOW_MS = 10'
    const modelEnd = '/* === Full C-style lesson controller; no network or student identity storage === */'
    expect(between(executable, modelStart, modelEnd))
      .toBe(between(originalHTML.replace(/^export (?=(?:const|function) )/gm, ''), modelStart, modelEnd))
  })

  it('keeps every navigation path behind showPage and reports its final stage', () => {
    const showPage = between(executable, 'function showPage(index) {', '\nfunction openDialog(')
    expect(showPage.trimEnd()).toMatch(/reportStage\(\)\n}$/)
    expect(showPage).toContain('state.page = next')
    expect(showPage).toContain('stage.dataset.slideId = slide.id')
    expect(executable.match(/\bstate\.page\s*=(?!=)/g)).toHaveLength(1)
    for (const path of [
      "case 'next': showPage(state.page + 1)",
      "case 'prev': showPage(state.page - 1)",
      'else showPage(index)',
      "case 'next': showPage(state.page === pages.length - 1 ? 0 : state.page + 1)",
      "case 'previous': showPage(state.page - 1)",
      "case 'jump': showPage(Number(button.dataset.page))",
      'showPage(0)',
      'showPage(pages.length - 1)',
      'showPage(state.page + (dx < 0 ? 1 : -1))',
      'showPage(state.page + Math.sign(wheelSum))',
    ]) expect(executable).toContain(path)
    expect(executable).toContain('config.slides.findIndex(slide => slide.id === packet.slideId)')
    expect(executable).not.toMatch(/location\.hash|history\.replaceState|hashchange|updateHash/)
  })

  it('reports the measured stage on sizeStage, ResizeObserver and resize', () => {
    expect(between(executable, 'function sizeStage() {', "\nwindow.addEventListener('resize', sizeStage)").trimEnd())
      .toMatch(/reportStage\(\)\n}$/)
    expect(executable).toContain("window.visualViewport?.addEventListener('resize', sizeStage)")
    expect(executable).toContain('new ResizeObserver(sizeStage)')
    expect(executable).toContain('stageResizeObserver.observe(viewport)')
    const report = between(executable, 'function coursewareState() {', '\nfunction flushCourseware()')
    expect(report).toContain('const rect = stage.getBoundingClientRect()')
    expect(report).toContain('slideId: config.slides[state.page].id')
    expect(report).toContain('index: state.page')
    expect(report).toContain('slides: coursewareSlides')
    expect(report).toContain('width: 1920')
    expect(report).toContain('height: 1080')
    expect(report).toContain('rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }')
    expect(report).toContain('scale: rect.width / 1920')
    expect(report).toContain('interactive: !dialogs.some(dialog => dialog.open)')
  })

  it('allows annotations on all pages only while every teaching dialog is closed', () => {
    const report = between(executable, 'function coursewareState() {', '\nfunction flushCourseware()')
    expect(report).toContain('interactive: !dialogs.some(dialog => dialog.open)')
    expect(report).not.toContain('querySelector(')
    const open = between(executable, 'function openDialog(id) {', '\nfunction fullscreen()')
    expect(open).toContain('byId(id).showModal()\n  reportStage()')
    expect(executable).toContain('const dialogStateObserver = new MutationObserver(reportStage)')
    expect(executable).toContain("for (const dialog of dialogs) dialogStateObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] })")
    expect(executable).toContain('dialogStateObserver.disconnect(); closeCoursewarePort()')
    expect(executable).toContain("const dialogs = [...document.querySelectorAll('dialog')]")
    expect(adaptedHTML.indexOf('<dialog id="recordsJsonDialog"')).toBeLessThan(adaptedHTML.indexOf("const dialogs = [...document.querySelectorAll('dialog')]"))
  })

  it('binds ready and a one-time port transfer to the nonce and exact parent origin', () => {
    expect(executable).toContain("query.get('cwNonce')")
    expect(executable).toContain("query.getAll('cwNonce').length !== 1")
    expect(executable).toContain('/^[A-Za-z0-9_-]{32,80}(?![\\s\\S])/.test(nonce)')
    expect(executable).toContain('originURL.origin !== parentOrigin || parentOrigin !== contentURL.origin')
    expect(executable).toContain("parent.postMessage({ type: 'courseware/ready', protocol: 1, nonce }, parentOrigin)")
    expect(executable).toContain('event.source !== parent || event.origin !== parentOrigin')
    expect(executable).toContain("packet.type !== 'courseware/connect' || packet.protocol !== 1 || packet.nonce !== nonce || event.ports.length !== 1")
    const handoff = between(executable, "    window.removeEventListener('message', listener)", '\n    reportStage()')
    expect(handoff).toContain('courseware.port = event.ports[0]')
    expect(handoff).toContain('port.onmessage = receiveCoursewareCommand')
    expect(handoff).toContain('port.start()')
    expect(executable.match(/parent\.postMessage\(/g)).toHaveLength(1)
    expect(executable).not.toContain("postMessage(packet, '*')")
    expect(executable).not.toMatch(/document\.cookie|localStorage|sessionStorage/)
  })

  it('bounds UTF-8 packets, rolling rates and state cadence with fail-closed validation', () => {
    expect(executable).toContain('COURSEWARE_MAX_PACKET_BYTES = 16384')
    expect(executable).toContain('coursewareEncoder.encode(JSON.stringify(packet)).byteLength')
    expect(executable).toContain('COURSEWARE_MAX_PACKETS_PER_SECOND = 90')
    expect(executable).toContain('times[0] <= now - 1000')
    expect(executable).toContain('courseware.incomingTimes.length >= COURSEWARE_MAX_PACKETS_PER_SECOND')
    expect(executable).toContain('courseware.outgoingTimes.length < COURSEWARE_MAX_PACKETS_PER_SECOND')
    expect(executable).toContain('COURSEWARE_STATE_INTERVAL = 1000 / 30')
    expect(executable).toContain('now - courseware.lastState >= COURSEWARE_STATE_INTERVAL')
    expect(executable).toContain('incomingSeq: 0')
    expect(executable).toContain('!Number.isSafeInteger(packet.seq) || packet.seq <= courseware.incomingSeq')
    expect(executable).toContain('const seq = courseware.outgoingSeq + 1')
    expect(executable).toContain('courseware.outgoingTimes.length < COURSEWARE_MAX_PACKETS_PER_SECOND - (courseware.stateRequested ? 1 : 0)')
    expect(executable).toContain("if (packet.type === 'courseware/ack') courseware.stateRequested = true")
    expect(executable).toContain('coursewarePacketSize(largestAck) > COURSEWARE_MAX_PACKET_BYTES')
    expect(executable).toContain("seq: Number.MAX_SAFE_INTEGER, requestId: packet.requestId, ok: false, error: 'command-failed'")
    expect(executable).toContain("const commands = ['next', 'prev', 'goto', 'state', 'outline', 'notes', 'motion', 'stop-audio']")
    expect(executable).toContain('!commands.includes(packet.command)')
    expect(executable).toContain('port.onmessageerror = closeCoursewarePort')
    expect(executable).toContain('port.close()')
    const command = between(executable, 'function receiveCoursewareCommand(event) {', '\nfunction connectCourseware()')
    expect(command).toContain('closeCoursewarePort()\n    return')
    expect(command).toContain('courseware.incomingSeq = packet.seq\n  queueCoursewarePacket(packet)')
    expect(command).not.toContain('showPage(')
    const dispatch = between(executable, 'function executeCoursewareCommand(packet) {', '\nfunction receiveCoursewareCommand(')
    expect(dispatch).toContain("const ack = { type: 'courseware/ack', requestId: packet.requestId, ok: !error }")
    expect(dispatch).toContain('return ack')
    const flush = between(executable, 'function flushCourseware() {', '\nfunction reportStage()')
    expect(flush).toContain("if (queued.type === 'courseware/command' && courseware.outgoingTimes.length >= COURSEWARE_MAX_PACKETS_PER_SECOND - 1) break")
    expect(flush).toContain("const packet = queued.type === 'courseware/command' ? executeCoursewareCommand(queued) : queued")
    expect(flush.indexOf('sendCoursewarePacket(packet)')).toBeLessThan(flush.indexOf('sendCoursewarePacket(coursewareState())'))
    expect(executable).toContain('const packet = { ...payload, protocol: 1, seq }')
  })

  it('uses embedded CSS rather than capture mode and never navigates to sources', () => {
    expect(adaptedHTML).toContain('body[data-courseware-embedded="true"] .chrome,')
    expect(adaptedHTML).toContain('body[data-courseware-embedded="true"] .deck-controls { display: none !important; }')
    expect(adaptedHTML).toContain('body[data-courseware-embedded="true"] .deck-viewport { inset: 0 !important; }')
    expect(executable).toContain("document.body.dataset.coursewareEmbedded = 'true'")
    expect(executable).not.toMatch(/classList\.(?:add|contains)\('capture'\)/)
    expect(executable).toContain('return state.motion && !motion.matches && !document.hidden')
    expect(adaptedHTML).not.toMatch(/<a\b|\btarget="_blank"|\bhref="https?:/)
    for (const source of provenance.sources) {
      expect(adaptedHTML).toContain(`<span class="courseware-source-url">${source.url}</span>`)
    }
  })

  it('retains genuine observations and simulated records with selectable JSON instead of downloads', () => {
    expect(dialog(adaptedHTML, 'recordsDialog'))
      .toBe(dialog(originalHTML, 'recordsDialog').replace('导出本次记录 JSON', '查看/复制本次记录 JSON'))
    expect(dialog(adaptedHTML, 'recordsJsonDialog')).toContain('<textarea id="recordsJsonText" readonly')
    expect(executable).toContain("byId('recordsJsonText').value = JSON.stringify(data, null, 2)")
    expect(executable).toContain('observations: state.observations, simulatedRecords: state.records, choices: state.answers')
    expect(executable).toContain('text.focus()\n  text.select()')
    expect(executable).toContain("speed: '', pitch: ''")
    expect(executable).toContain("dataKind: 'simulated'")
    expect(executable).not.toMatch(/\bBlob\b|createObjectURL|revokeObjectURL|\.download\s*=/)
    expect(executable).toContain("queueCoursewarePacket({ type: 'courseware/fullscreen' })")
    expect(executable).not.toMatch(/\.requestFullscreen\(|\.exitFullscreen\(/)
  })

  it('converts the no-dependency module into one classic IIFE without forbidden capabilities', () => {
    expect(executableScripts).toHaveLength(1)
    expect(adaptedHTML).not.toContain('<script type="module">')
    expect(executable).toMatch(/^\n\(\(\) => \{\n'use strict'\nconst WINDOW_MS = 10/)
    expect(executable.trimEnd()).toMatch(/\}\)\(\)$/)
    expect(executable).toContain('const config = JSON.parse(')
    expect(executable).not.toMatch(/\b(?:eval|Function|import|fetch|XMLHttpRequest|WebSocket|Worker|sendBeacon)\b|document\s*\.\s*write\b|^export\s/m)
    expect(adaptedHTML).not.toMatch(/<(?:iframe|frame)\b|<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=/i)
    for (const match of adaptedHTML.matchAll(/url\(([^)]*)\)/g)) {
      expect((match[1] ?? '').replace(/^['"]|['"]$/g, '')).toMatch(/^data:/)
    }
    expect(provenance.copyright.fonts.map(font => font.license)).toEqual(['SIL Open Font License 1.1', 'SIL Open Font License 1.1'])
    expect(provenance.copyright.fixedStageCSS).toEqual(expect.objectContaining({ license: 'MIT', notice: 'Copyright (c) 2025 Zara Zhang' }))
    expect(provenance.copyright.rightsCaveat).toContain('不等于获得第三方教材、试题、角色上游素材或非遗名称的任意商业许可')
  })
})
