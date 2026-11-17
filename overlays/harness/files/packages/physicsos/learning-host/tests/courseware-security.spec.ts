import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type DefaultTreeAdapterTypes } from 'parse5'
import { describe, expect, it } from 'vitest'
import { prepareCourseware } from '../src/courseware-security.ts'
import { coursewareWrapper } from '../src/courseware-embed.ts'
const source = (body: string, head = ''): Uint8Array => Buffer.from(`<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`)
function scripts(html: string): string[] {
  const out: string[] = []; const pending: DefaultTreeAdapterTypes.Node[] = [parse(html)]
  while (pending.length) { const node = pending.pop()!; if ('tagName' in node && node.tagName === 'script' && !node.attrs.some(a => a.name === 'type' && a.value === 'application/json')) out.push(node.childNodes.map(n => 'value' in n ? n.value : '').join('')); if ('childNodes' in node) pending.push(...node.childNodes) }
  return out
}
describe('courseware static import, independent from experiment ZIP security', () => {
  it('never executes admitted scripts and hashes the exact bytes which are served', () => {
    const marker = '__courseware_must_not_execute__'
    const bytes = source(`<h1>HTML</h1><script>globalThis.${marker}=true;document.body.dataset.executed='true'</script>`)
    const before = bytes.slice(); const prepared = prepareCourseware(bytes)
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined(); expect(bytes).toEqual(before)
    for (const text of scripts(Buffer.from(prepared.bytes).toString('utf8'))) expect(prepared.csp).toContain(`'sha256-${createHash('sha256').update(text).digest('base64')}'`)
    expect(prepared.csp).not.toContain('unsafe-eval'); expect(prepared.csp).not.toContain("script-src 'unsafe-inline'")
    expect(prepared.presentation).toMatchObject({ mode: 'document', slideIds: ['document'], width: 1920, height: 1080 })
  })
  it.each([
    ['remote script', '<script src="https://outside.invalid/x.js"></script>'],
    ['module import', '<script type="module">import "https://outside.invalid/x.js"</script>'],
    ['dynamic import', '<script>import("./x.js")</script>'],
    ['eval', '<script>eval("1")</script>'],
    ['constructor', '<script>(()=>{})["constructor"]("return 1")()</script>'],
    ['network', '<script>fetch("https://outside.invalid/secret")</script>'],
    ['beacon', '<script>navigator.sendBeacon("https://outside.invalid/", "x")</script>'],
    ['worker', '<script>new Worker("data:text/javascript,postMessage(1)")</script>'],
    ['cookie', '<script>document.cookie</script>'],
    ['storage', '<script>localStorage.setItem("x","y")</script>'],
    ['string timer', '<script>setTimeout("alert(1)",0)</script>'],
    ['external link', '<a href="https://outside.invalid/" target="_blank">外链</a>'],
    ['javascript URL', '<a href="java&#x73;cript:alert(1)">x</a>'],
    ['event attribute', '<svg onload="alert(1)"></svg>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://outside.invalid">'],
    ['iframe', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'],
    ['form', '<form action="https://outside.invalid"><button>submit</button></form>'],
    ['missing asset', '<img src="./missing.png" alt="x">'],
    ['protocol-relative resource', '<img src="//outside.invalid/img.png" alt="x">'],
    ['source set', '<img srcset="https://outside.invalid/x 1x" alt="x">'],
    ['embed', '<object data="data:text/html,x"></object>'],
    ['template execution', '<template><script>alert(1)</script></template>'],
    ['base URL', '<base href="https://outside.invalid/">'],
    ['svg reference', '<svg><use xlink:href="https://outside.invalid/a.svg#x"></use></svg>'],
    ['svg animated navigation', '<svg><a id="a" href="#ok">x</a><set href="#a" attributeName="href" to="https://outside.invalid/" /></svg>'],
    ['data HTML', '<img src="data:text/html;base64,PHNjcmlwdD4=">'],
  ])('rejects %s without fetching or executing it', (_label, body) => { expect(() => prepareCourseware(source(body))).toThrow() })
  it.each([
    '@import "https://outside.invalid/a.css";',
    'body{background:u\\72l(https://outside.invalid/x)}',
    'body{background:image-set("https://outside.invalid/x" 1x)}',
    'body{behavior:url(https://outside.invalid/a.htc)}',
    'body{width:expression(alert(1))}',
  ])('rejects unsafe CSS %s', head => { expect(() => prepareCourseware(source('<h1>x</h1>', `<style>${head}</style>`))).toThrow() })
  it('allows bounded embedded raster/font resources and exact inline programs, not SVG programs', () => {
    const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    expect(prepareCourseware(source(`<img src="${image}" alt="图"><script>document.body.dataset.ready='yes'</script>`, '<style>@font-face{font-family:test;src:url(data:font/woff2;base64,d09GMgABAAAA)}body{font-family:test}</style>')).csp).toContain('font-src data:')
    expect(() => prepareCourseware(source('<img src="data:image/svg+xml;base64,PHN2Zz4=">'))).toThrow()
  })
  it('preserves the 31-page real lesson through its explicit allowlisted adapter', () => {
    let root = dirname(fileURLToPath(import.meta.url))
    while (!existsSync(join(root, 'examples', 'courseware', 'sound-properties'))) { const parent = dirname(root); if (parent === root) throw new Error('Real courseware example directory is missing'); root = parent }
    const original = readFileSync(join(root, 'examples', 'courseware', 'sound-properties', 'sound-properties-guizhou-c.original.html'))
    const prepared = prepareCourseware(original)
    expect(prepared.presentation).toMatchObject({ mode: 'slides', adapterVersion: 'sound-guizhou-c-v1', width: 1920, height: 1080 })
    expect(prepared.presentation.slideIds).toHaveLength(31)
    const text = Buffer.from(prepared.bytes).toString('utf8')
    expect(text).toContain('function playAudio('); expect(text).toContain('reportStage()'); expect(text).toContain('AudioContext')
    expect(text).not.toContain('<script type="module">')
    for (const script of scripts(text)) expect(prepared.csp).toContain(`'sha256-${createHash('sha256').update(script).digest('base64')}'`)
  })
  it('recognizes the exact preadapted artifact without injecting a competing single-document handshake', () => {
    let root = dirname(fileURLToPath(import.meta.url))
    while (!existsSync(join(root, 'examples', 'courseware', 'sound-properties'))) { const parent = dirname(root); if (parent === root) throw new Error('Real courseware example directory is missing'); root = parent }
    const artifact = readFileSync(join(root, 'examples', 'courseware', 'sound-properties', 'sound-properties-guizhou-c.adapted.html'))
    const prepared = prepareCourseware(artifact)
    expect(prepared.presentation).toMatchObject({ mode: 'slides', adapterVersion: 'sound-guizhou-c-v1' }); expect(prepared.presentation.slideIds).toHaveLength(31)
    expect(Buffer.from(prepared.bytes).toString('utf8')).not.toContain('id="physicsos-courseware-document"')
  })
  it('uses an explicit author manifest, never inferred DOM/hash pages, and rejects incomplete competing bridges', () => {
    const manifest = { protocol: 1, adapterVersion: 'author-v1', stage: { width: 1920, height: 1080 }, slides: [{ id: 'first', title: '第一页' }, { id: 'second', title: '第二页' }] }
    const html = source(`<section id="first">一</section><section id="second">二</section><script type="application/json" id="physicsos-courseware-manifest">${JSON.stringify(manifest)}</script><script>const ready='courseware/ready';document.body.dataset.bridge=ready</script>`)
    const prepared = prepareCourseware(html)
    expect(prepared.presentation).toEqual({ mode: 'slides', adapterVersion: 'author-v1', slideIds: ['first', 'second'], width: 1920, height: 1080 })
    expect(Buffer.from(prepared.bytes).toString('utf8')).not.toContain('id="physicsos-courseware-document"')
    expect(prepareCourseware(source('<section class="slide">一</section><section class="slide">二</section>')).presentation.mode).toBe('document')
    expect(() => prepareCourseware(source('<script>const bridge="courseware/ready"</script>'))).toThrow()
    expect(() => prepareCourseware(source(`<script type="application/json" id="physicsos-courseware-manifest">${JSON.stringify({ ...manifest, slides: [manifest.slides[0], manifest.slides[0]] })}</script>`))).toThrow()
  })
  it('bounds bytes, invalid UTF-8, malformed and duplicate attribute input', () => {
    expect(() => prepareCourseware(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow()
    expect(() => prepareCourseware(new Uint8Array([255, 254]))).toThrow()
    expect(() => prepareCourseware(source('<img src="data:image/png;base64,AAAA" src="https://outside.invalid">'))).toThrow()
  })
  it('uses a trusted wrapper with an exact fixed frame path and an opaque scripts-only child', () => {
    const rendered = coursewareWrapper({ origin: 'https://physics.test', contentPath: `/physicsos/courseware/content/${'a'.repeat(43)}`, nonce: 'b'.repeat(32) })
    const html = Buffer.from(rendered.bytes).toString('utf8')
    expect(rendered.csp).toContain(`frame-src https://physics.test/physicsos/courseware/content/${'a'.repeat(43)}`)
    expect(html).toContain('sandbox="allow-scripts"'); expect(html).not.toContain('sandbox="allow-scripts allow-same-origin"')
    for (const capability of ['allow-top-navigation', 'allow-popups', 'allow-downloads', 'allow-forms']) expect(html).not.toContain(capability)
    expect(html).toContain("e.source!==parent||e.origin!==location.origin")
    expect(html).toContain("e.source===child.contentWindow&&e.origin==='null'")
    expect(rendered.csp).toContain("connect-src 'none'")
  })
})
