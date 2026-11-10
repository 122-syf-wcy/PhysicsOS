import type { WhiteboardDocument } from '@physicsos/physics-whiteboard'
import { numeric } from './editor-model.ts'
/** Resolve every original before returning a complete SVG, even when the live preview is still loading. */
export async function completeExportSvg(document: WhiteboardDocument, svg: SVGSVGElement, resolveImage: (id: string) => Promise<string>): Promise<SVGSVGElement> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const imageElements = document.scene.elements.filter(element => element.type === 'image' && !element.isDeleted)
  const sources = await Promise.all(imageElements.map(async element => ({ element, url: await resolveImage(String(element.fileId)) })))
  for (const { element, url } of sources) {
    if (!url.startsWith('data:image/')) throw new Error('Original image is unavailable for export')
    let group = [...clone.querySelectorAll('[data-element-id]')].find(item => item.getAttribute('data-element-id') === element.id)
    if (!group) {
      group = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g')
      group.setAttribute('data-element-id', String(element.id))
      group.setAttribute('transform', `translate(${numeric(element, 'x')} ${numeric(element, 'y')})`)
      ;(clone.querySelector('[data-whiteboard-elements]') ?? clone).append(group)
    }
    let image = group.querySelector('image')
    if (!image) { image = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'image'); group.append(image) }
    image.setAttribute('href', url); image.setAttribute('width', String(numeric(element, 'width'))); image.setAttribute('height', String(numeric(element, 'height'))); image.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  }
  return clone
}
