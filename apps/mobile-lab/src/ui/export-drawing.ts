import { EXPORT_MIME, LabError, safeFileName, validateExport, type ExportFile } from '../shared/protocol.ts'

const loadImage = (source: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new LabError('DRAWING_EXPORT', '器材图片无法读入，未生成缺少器材的导出。'))
  image.src = source
})
/** Export the actual retained SVG plus dense Canvas layer, not a new approximation of the model. */
export async function exportDrawing(format: 'png' | 'svg', title: string): Promise<ExportFile> {
  const host = document.querySelector<HTMLElement>('[data-testid="physics-scene"]')
  const svg = host?.querySelector('svg')
  const dense = host?.querySelector('canvas')
  if (!svg || !dense) throw new LabError('DRAWING_EXPORT', '实验画布尚未就绪。')
  // Renderer image resources may still be decoding after the first scene frame.
  await Promise.all([...svg.querySelectorAll('image')].map(image => {
    const source = image.getAttribute('href') ?? image.getAttribute('xlink:href')
    return source ? loadImage(source) : Promise.resolve()
  }))
  const clone = svg.cloneNode(true) as SVGSVGElement
  const originals = [svg, ...svg.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')]
  const properties = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'visibility', 'display', 'filter']
  originals.forEach((element, index) => {
    const copy = copies[index]!, computed = getComputedStyle(element)
    for (const name of properties) { const value = computed.getPropertyValue(name); if (value && !value.includes('url(')) (copy as SVGElement).style.setProperty(name, value) }
    // Foreign CSS module references must not become an external dependency of the file.
    copy.removeAttribute('class')
  })
  for (const image of clone.querySelectorAll('image')) {
    const source = image.getAttribute('href') ?? image.getAttribute('xlink:href')
    if (!source || source.startsWith('data:')) continue
    const loaded = await loadImage(source), canvas = document.createElement('canvas')
    canvas.width = loaded.naturalWidth; canvas.height = loaded.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new LabError('DRAWING_EXPORT', '无法创建导出绘制上下文。')
    context.drawImage(loaded, 0, 0); image.setAttribute('href', canvas.toDataURL('image/png')); image.removeAttribute('xlink:href')
  }
  const width = Number(svg.getAttribute('width')), height = Number(svg.getAttribute('height'))
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'image')
  layer.setAttribute('href', dense.toDataURL('image/png')); layer.setAttribute('width', String(width)); layer.setAttribute('height', String(height))
  clone.append(layer)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const content = new XMLSerializer().serializeToString(clone)
  let file: ExportFile
  if (format === 'svg') file = { name: safeFileName(title, 'svg'), mime: EXPORT_MIME.svg, encoding: 'utf8', content }
  else {
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`)
    const canvas = document.createElement('canvas'); canvas.width = width * 2; canvas.height = height * 2
    const context = canvas.getContext('2d')
    if (!context) throw new LabError('DRAWING_EXPORT', '无法创建导出绘制上下文。')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    file = { name: safeFileName(title, 'png'), mime: EXPORT_MIME.png, encoding: 'base64', content: canvas.toDataURL('image/png').split(',')[1]! }
  }
  validateExport(file)
  return file
}
export function download(file: ExportFile): void {
  validateExport(file)
  const bytes = file.encoding === 'utf8' ? file.content : Uint8Array.from(atob(file.content), char => char.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }))
  const link = document.createElement('a'); link.download = file.name; link.href = url; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
