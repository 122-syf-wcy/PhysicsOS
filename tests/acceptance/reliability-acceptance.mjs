/** Durable product regression journey: real isolated host, browser and persistence. */
import { expect } from '@playwright/test'
import { stdout } from 'node:process'
import {
  ACCEPTANCE_ADMIN_PASSWORD,
  ACCEPTANCE_ADMIN_USERNAME,
  loginUser,
  openAcceptance,
  startIsolatedServer,
  waitForShell,
} from './support.mjs'

const server = await startIsolatedServer({ port: 3097 })
let acceptance

/** Small valid text-layer PDF; selecting it must stay entirely local. */
const textPdf = () => {
  const stream = 'BT /F1 18 Tf 40 120 Td (Reliability PDF fixture 12345) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

try {
  acceptance = await openAcceptance(import.meta.url, { base: server.base })
  const { page, base, check, dismissOnboarding } = acceptance
  const optionalRequests = []
  const network = []
  page.on('request', (request) => {
    const url = request.url()
    network.push({ method: request.method(), url })
    const name = new URL(url).pathname.split('/').at(-1)
    if (/^optional-[a-z0-9-]+\.js$/.test(name ?? '')) optionalRequests.push(name)
  })
  const requested = name => optionalRequests.includes(`optional-${name}.js`)
  const lab = page.locator('[data-physicsos-surface="lab"]')
  const picker = page.locator('[data-physicsos-state="picker"]')
  const enterPicker = async () => {
    const switcher = lab.getByRole('button', { name: '切换实验', exact: true })
    if (await switcher.isVisible()) await switcher.click()
    else await page.getByRole('button', { name: '物理实验室', exact: true }).click()
    await expect(picker).toBeVisible({ timeout: 20_000 })
  }
  const savedScenes = async () => {
    const response = await page.request.get(`${base}/physicsos/learning/scenes`)
    expect(response.status()).toBe(200)
    return (await response.json()).items
  }
  const assertMass = async () => {
    await expect(lab).toHaveAttribute('data-scene-revision', '1')
    await expect(lab.getByRole('textbox', { name: '质量', exact: true })).toHaveValue('2')
  }
  const resumeAfterReload = async () => {
    await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
    await waitForShell(page)
    await enterPicker()
    await picker.locator('[data-physicsos-continue]').click()
    await expect(lab).toBeVisible()
  }

  stdout.write('\nHome: optional feature payloads stay unloaded\n')
  await page.goto(base, { waitUntil: 'networkidle', timeout: 60_000 })
  await loginUser(page, { username: ACCEPTANCE_ADMIN_USERNAME, password: ACCEPTANCE_ADMIN_PASSWORD })
  // This is a fresh account: wait for its asynchronous notice fetch/render
  // before dismissing it. A visible sidebar does not mean the notice is settled.
  await expect(page.locator('[data-physicsos-platform-notice]')).toBeVisible({ timeout: 15_000 })
  await dismissOnboarding()
  await expect(page.getByRole('navigation', { name: 'PhysicsOS' })).toBeVisible()
  check('authenticated Home has no workspace/admin/pdf requests', optionalRequests.length === 0, optionalRequests.join(', '))

  stdout.write('\nLab: real edits survive picker, remote save and browser reload\n')
  await enterPicker()
  check('entering Lab requests the workspace artifact', requested('workspace'))
  check('entering Lab does not request admin or PDF', !requested('admin') && !requested('pdf'))
  await picker.locator('button[data-template-id="uniform-acceleration"]').first().click()
  await expect(lab).toHaveAttribute('data-physicsos-domain', 'mechanics')
  await expect(lab).toHaveAttribute('data-scene-revision', '0')
  const mass = lab.getByRole('textbox', { name: '质量', exact: true })
  await expect(mass).toHaveValue('1')
  await mass.fill('2')
  await mass.press('Tab')
  await assertMass()
  await expect.poll(async () => {
    const row = (await savedScenes()).find(item => item.scene?.bodies?.[0]?.mass?.value === 2)
    return row?.scene?.revision
  }, { timeout: 10_000 }).toBe(1)
  await enterPicker()
  await expect(picker.getByText('返回当前实验', { exact: true })).toBeVisible()
  await picker.locator('[data-physicsos-continue]').click()
  await assertMass()
  await resumeAfterReload()
  await assertMass()
  check('mass 1→2 and revision 1 survive picker/continue/remote/refresh', true)

  stdout.write('\nModal: keyboard focus stays inside and transport yields\n')
  const guideButton = lab.getByRole('button', { name: '实验指南', exact: true })
  const timeline = lab.getByRole('slider', { name: '时间轴', exact: true })
  const beforeTime = await timeline.inputValue()
  await guideButton.click()
  const guide = page.getByRole('dialog', { name: '实验指南', exact: true })
  await expect(guide).toBeVisible()
  const focusInside = () => guide.evaluate(node => node.contains(document.activeElement))
  expect(await focusInside()).toBe(true)
  for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key)
    expect(await focusInside()).toBe(true)
  }
  await guide.focus()
  for (const key of ['ArrowRight', 'Home', 'Space']) await page.keyboard.press(key)
  expect(await focusInside()).toBe(true)
  await expect(timeline).toHaveValue(beforeTime)
  await expect(lab).toHaveAttribute('data-physicsos-running', 'false')
  await page.keyboard.press('Escape')
  await expect(guide).toBeHidden()
  await expect(guideButton).toBeFocused()
  check('guide traps focus, blocks hidden transport and restores trigger focus', true)

  stdout.write('\nFree build: edited source and authoring mode survive refresh\n')
  await enterPicker()
  await picker.getByRole('button', { name: /自由搭建电路/ }).click()
  await expect(lab).toHaveAttribute('data-physicsos-domain', 'circuit')
  await expect(lab.getByTestId('circuit-builder')).toBeVisible()
  const voltage = lab.getByRole('textbox', { name: '电动势', exact: true })
  await voltage.fill('2')
  await voltage.press('Tab')
  await expect(lab).toHaveAttribute('data-scene-revision', '1')
  await expect.poll(async () => {
    const row = (await savedScenes()).find(item => item.buildMode === true)
    return row?.scene?.circuits?.[0]?.components?.find(component => component.type === 'voltage_source')?.voltage?.value
  }, { timeout: 10_000 }).toBe(2)
  await resumeAfterReload()
  await expect(lab.getByTestId('circuit-builder')).toBeVisible()
  await expect(lab.getByRole('textbox', { name: '电动势', exact: true })).toHaveValue('2')
  await expect(lab).toHaveAttribute('data-scene-revision', '1')
  check('free build source voltage and builder mode survive refresh', true)

  stdout.write('\nAdministration and PDF: download only when requested\n')
  check('admin and PDF remain unloaded before their workflows', !requested('admin') && !requested('pdf'))
  await page.getByRole('button', { name: '账户菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: /管理后台/ }).click()
  await expect(page.locator('[data-physicsos-surface="admin"]')).toBeVisible()
  check('visiting administration requests its independent artifact', requested('admin'))
  check('administration does not request PDF', !requested('pdf'))
  await page.getByRole('button', { name: '出卷专区', exact: true }).click()
  const paper = page.locator('[data-physicsos-surface="paper"]')
  await expect(paper).toBeVisible()
  await paper.getByRole('button', { name: '题库', exact: true }).click()
  await paper.locator('input[type="file"]').setInputFiles({ name: 'reliability.pdf', mimeType: 'application/pdf', buffer: textPdf() })
  await expect(paper.getByText(/已从 PDF 提取文本层/)).toBeVisible({ timeout: 20_000 })
  await expect(paper.locator('textarea').first()).toHaveValue(/Reliability PDF fixture 12345/)
  check('selecting a PDF requests its parser and extracts a real text layer', requested('pdf'))
  check('local text-layer PDF does not submit ingestion/model work', !network.some(item => item.method === 'POST' && /\/bank\/ingest/.test(item.url)))
  check('browser made no external network requests', network.every(item => {
    const url = new URL(item.url)
    return !['http:', 'https:'].includes(url.protocol) || ['127.0.0.1', 'localhost'].includes(url.hostname)
  }))
} catch (error) {
  if (acceptance === undefined) throw error
  acceptance.check('reliability journey completed', false, error instanceof Error ? error.stack : String(error))
} finally {
  try {
    if (acceptance !== undefined) await acceptance.finish()
  } finally {
    if (acceptance !== undefined) await acceptance.browser.close().catch(() => {})
    await server.stop()
  }
}
