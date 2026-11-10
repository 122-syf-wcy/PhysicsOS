import { chromium } from '@playwright/test'
import { access, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '../../../..')
const input = resolve(root, 'docs/reports/2026-11-08-teacher-trial-invitation.html')
const output = resolve(root, 'docs/reports/PhysicsOS_初高中物理教师试用邀请函_2026-11-08.pdf')

try {
  await access(output)
  throw new Error('The invitation PDF already exists; review it before replacing it.')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ locale: 'zh-CN' })
  await page.emulateMedia({ media: 'print', colorScheme: 'light' })
  await page.goto(pathToFileURL(input).href, { waitUntil: 'load' })
  const layout = await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.images).map(image => image.decode()))
    return Array.from(document.querySelectorAll('.page')).map((page, index) => {
      const main = page.querySelector('main').getBoundingClientRect()
      const footer = page.querySelector('footer').getBoundingClientRect()
      return { page: index + 1, footerGapPx: Number((footer.top - main.bottom).toFixed(1)) }
    })
  })
  if (layout.length !== 4 || layout.some(page => page.footerGapPx < 6)) {
    throw new Error(`Invitation layout overlaps the footer: ${JSON.stringify(layout)}`)
  }
  await page.pdf({
    path: output,
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    tagged: true,
  })
  console.log(JSON.stringify({ output, bytes: (await stat(output)).size, layout }))
} finally {
  await browser.close()
}
