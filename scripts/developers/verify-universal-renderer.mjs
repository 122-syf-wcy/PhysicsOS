/** Real-browser validation of every selected SDK package using frozen platform-engine snapshots. */
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname } from 'node:path'
import { chromium } from '@playwright/test'

const host = new URL('../../vendor/deepseek-harness/packages/physicsos/experiment-host/src/', import.meta.url)
const data = JSON.parse(await readFile(new URL('universal-template-data.json', host)))
const registry = JSON.parse(await readFile(new URL('experiment-registry.json', host)))
const selectedIds = process.argv.slice(2)
const selected = selectedIds.length ? selectedIds.map(id => { const profile = registry.find(item => item.id === id); if (!profile) throw new Error('Unknown render target: ' + id); return profile }) : registry
const shared = new Map(Object.entries(data.base).map(([name, body]) => [name, Buffer.from(body, 'base64')]))
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain' }
const directory = process.env.PHYSICSOS_RENDERER_CHECK_OUTPUT ?? '/tmp/physicsos-universal-renderer-check'
await mkdir(directory, { recursive: true })
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/preview') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><head><title>SDK check</title></head><body></body></html>'); return }
  const match = /^\/targets\/([a-z0-9-]+)\/dist\/(.+)$/.exec(path)
  if (!match || !Object.hasOwn(data.targets, match[1])) { response.writeHead(404); response.end(); return }
  const name = match[2].startsWith('runtime/') ? 'src/' + match[2].slice(8) : 'public/' + match[2]
  const selected = data.targets[match[1]][name]
  const bytes = selected ? Buffer.from(selected, 'base64') : shared.get(name)
  if (!bytes) { response.writeHead(404); response.end(); return }
  response.setHeader('content-type', mime[extname(name)] ?? 'application/octet-stream'); response.end(bytes)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 850 } })
const errors = [], external = [], failedResources = []
context.on('request', request => { if (!request.url().startsWith(origin + '/')) external.push(request.url()) })
context.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failedResources.push(response.url()) })
const domains = new Set(), results = []
try {
  for (const profile of selected) {
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${profile.id}: ${error.message}`))
    await page.goto(origin + '/preview')
    const fixture = JSON.parse(Buffer.from(data.targets[profile.id]['public/fixture.json'], 'base64'))
    await page.evaluate(({ id, snapshot }) => {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'width:100%;height:790px;border:0'
      document.body.append(iframe)
      const channel = crypto.randomUUID()
      window.sdkResults = []
      addEventListener('message', event => {
        if (event.source !== iframe.contentWindow || event.origin !== location.origin || event.data?.type !== 'experiment/ready' || event.data.protocolVersion !== 3 || event.data.channel !== channel) return
        const pair = new MessageChannel()
        pair.port1.onmessage = event => {
          window.sdkResults.push(event.data)
          if (event.data.type === 'experiment/connected') pair.port1.postMessage({ type: 'experiment/snapshot', protocolVersion: 3, frameId: 'fixture-' + id, snapshot })
        }
        pair.port1.start()
        iframe.contentWindow.postMessage({ type: 'experiment/connect', protocolVersion: 3, channel }, location.origin, [pair.port2])
      })
      iframe.src = `/targets/${id}/dist/index.html?hostOrigin=${encodeURIComponent(location.origin)}&channel=${channel}`
    }, { id: profile.id, snapshot: fixture })
    await page.waitForFunction(() => window.sdkResults.some(message => message.type === 'experiment/rendered' || message.type === 'experiment/error'), { timeout: 20000 })
    const messages = await page.evaluate(() => window.sdkResults)
    assert.ok(!messages.some(message => message.type === 'experiment/error'), `${profile.id}: ${JSON.stringify(messages)}`)
    const ack = messages.find(message => message.type === 'experiment/rendered')
    assert.deepEqual(ack, { type: 'experiment/rendered', protocolVersion: 3, frameId: 'fixture-' + profile.id, revision: fixture.revision })
    const frame = page.frames().find(frame => frame.url().includes(`/targets/${profile.id}/`))
    const visual = await frame.evaluate(() => {
      const svg = document.querySelector('#canvas svg'), box = svg?.getBoundingClientRect()
      return { count: svg?.querySelectorAll('path,line,circle,image,rect,text').length ?? 0, width: box?.width ?? 0, height: box?.height ?? 0, token: getComputedStyle(document.documentElement).getPropertyValue('--physics-trajectory').trim(), images: [...document.querySelectorAll('svg image')].map(image => image.getAttribute('href')) }
    })
    assert.ok(visual.count > 10 && visual.width > 100 && visual.height > 100, `${profile.id}: blank canvas`)
    assert.ok(visual.token, `${profile.id}: semantic tokens missing`)
    assert.ok(visual.images.every(href => href?.startsWith('./assets/')), `${profile.id}: external visual asset`)
    if (!domains.has(profile.domain)) { await page.screenshot({ path: `${directory}/${profile.domain}.png` }); domains.add(profile.domain) }
    results.push({ experimentId: profile.id, domain: profile.domain, shapes: visual.count, revision: fixture.revision })
    if (results.length % 10 === 0) console.log(`Rendered ${results.length}/${selected.length} templates`)
    await page.close()
  }
  assert.equal(domains.size, new Set(selected.map(profile => profile.domain)).size)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  assert.deepEqual(failedResources, [])
  await writeFile(`${directory}/result.json`, JSON.stringify({ templates: results.length, domains: domains.size, externalRequests: external.length, errors, failedResources, results }, null, 2) + '\n')
  console.log(`Rendered ${results.length} templates across ${domains.size} domains; no external requests or browser errors. Evidence: ${directory}`)
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
