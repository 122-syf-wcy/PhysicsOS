/** Pandoc stock references use paired, self-closing or absent section properties. */
import { A4_PAGE_TWIPS } from '@physicsos/question-paper'

interface XmlElement {
  readonly name: string
  readonly start: number
  readonly openEnd: number
  readonly selfClosing: boolean
  closeStart: number
  end: number
  readonly children: XmlElement[]
  readonly parent?: XmlElement
}
const fail = (message: string): never => { throw new Error(`pandoc 参考模板 XML 无效：${message}`) }

/** A bounded lexical tree: no entity expansion, external resources or XML recovery. */
function elements(xml: string): XmlElement[] {
  if (xml.length > 16 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return fail('不允许外部实体或超限 XML')
  const roots: XmlElement[] = []; const stack: XmlElement[] = []
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\/?\s*>/g
  let consumed = 0
  for (const token of xml.matchAll(tokens)) {
    const start = token.index
    if (xml.slice(consumed, start).includes('<')) return fail('标签不完整')
    consumed = start + token[0].length
    const tag = token[0]
    if (tag.startsWith('<?') || tag.startsWith('<!--') || tag.startsWith('<![CDATA[')) continue
    const name = /^<\/?([A-Za-z_][\w:.-]*)/.exec(tag)?.[1]
    if (name === undefined) return fail('标签名缺失')
    if (tag.startsWith('</')) {
      const element = stack.pop()
      if (element === undefined || element.name !== name || !new RegExp(`^</${name.replace(/\./g, '\\.')}\\s*>$`).test(tag)) return fail('标签配对错误')
      element.closeStart = start; element.end = consumed
      continue
    }
    const parent = stack.at(-1)
    const selfClosing = /\/\s*>$/.test(tag)
    const element: XmlElement = { name, start, openEnd: consumed, selfClosing, closeStart: consumed, end: consumed, children: [], ...(parent === undefined ? {} : { parent }) }
    if (parent === undefined) roots.push(element); else parent.children.push(element)
    if (!selfClosing) stack.push(element)
  }
  if (stack.length > 0 || xml.slice(consumed).includes('<') || roots.length !== 1) return fail('文档根或结束标签不完整')
  return roots
}

const SECTION_ORDER = ['headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type', 'pgSz', 'pgMar', 'paperSrc', 'pgBorders', 'lnNumType', 'pgNumType', 'cols', 'formProt', 'vAlign', 'noEndnote', 'titlePg', 'textDirection', 'bidi', 'rtlGutter', 'docGrid', 'printerSettings', 'sectPrChange'] as const

/** Validate live section geometry and uniqueness without repairing output. */
export function assertA4WordGeometryXml(xml: string): void {
  const root = elements(xml)[0]!
  const prefix = root.name.includes(':') ? root.name.slice(0, root.name.indexOf(':')) : ''
  const q = (name: string): string => prefix === '' ? name : `${prefix}:${name}`
  if (root.name !== q('document')) fail('缺少 Word document')
  const bodies = root.children.filter((element) => element.name === q('body'))
  if (bodies.length !== 1) return fail('必须有一个 Word body')
  const body = bodies[0]!
  const sections: XmlElement[] = []
  const visit = (element: XmlElement): void => {
    if (element.name === q('sectPr') && (element.parent === body || element.parent?.name === q('pPr'))) sections.push(element)
    for (const child of element.children) visit(child)
  }
  visit(body)
  const final = sections.filter((section) => section.parent === body)
  if (final.length !== 1 || body.children.at(-1) !== final[0]) return fail('最终 sectPr 必须唯一且位于 body 末尾')
  const attribute = (element: XmlElement, name: string): string | undefined => new RegExp(`(?:^|\\s)${q(name)}\\s*=\\s*(["'])(.*?)\\1`).exec(xml.slice(element.start, element.openEnd))?.[2]
  for (const section of sections) {
    const sizes = section.children.filter((child) => child.name === q('pgSz'))
    const margins = section.children.filter((child) => child.name === q('pgMar'))
    if (sizes.length !== 1 || margins.length !== 1) return fail('每个 sectPr 必须且只能有一个 pgSz 和 pgMar')
    if (attribute(sizes[0]!, 'w') !== String(A4_PAGE_TWIPS.width) || attribute(sizes[0]!, 'h') !== String(A4_PAGE_TWIPS.height)
      || (attribute(sizes[0]!, 'orient') !== undefined && attribute(sizes[0]!, 'orient') !== 'portrait')) return fail('实际页幅不是纵向 A4')
    if (['top', 'right', 'bottom', 'left'].some((side) => attribute(margins[0]!, side) !== String(A4_PAGE_TWIPS.margin))) return fail('实际页边距不是 18mm')
    if (section.children.indexOf(sizes[0]!) >= section.children.indexOf(margins[0]!)) return fail('pgSz/pgMar 顺序错误')
  }
}

/**
 * Install exactly one A4 pgSz/18mm pgMar per live section, in CT_SectPr order.
 * Preserve all body content, section attributes and non-geometry children.
 * A missing final section is created at the end of the actual Word body;
 * valid empty `<w:sectPr/>` is expanded, never mistaken for a missing template.
 */
export function patchReferenceA4Xml(xml: string): string {
  const root = elements(xml)[0]!
  const prefix = root.name.includes(':') ? root.name.slice(0, root.name.indexOf(':')) : ''
  const q = (name: string): string => prefix === '' ? name : `${prefix}:${name}`
  if (root.name !== q('document')) return fail('缺少 Word document')
  const namespaceName = prefix === '' ? 'xmlns' : `xmlns:${prefix}`
  const namespace = new RegExp(`(?:^|\\s)${namespaceName}\\s*=\\s*(["'])(.*?)\\1`).exec(xml.slice(root.start, root.openEnd))?.[2]
  if (namespace !== 'http://schemas.openxmlformats.org/wordprocessingml/2006/main' && namespace !== 'http://purl.oclc.org/ooxml/wordprocessingml/main') return fail('Word 主命名空间不正确')
  const bodies = root.children.filter((element) => element.name === q('body'))
  if (bodies.length !== 1) return fail('必须有一个 Word body')
  const body = bodies[0]!
  const sectionName = q('sectPr')
  const sections: XmlElement[] = []
  const visit = (element: XmlElement): void => {
    if (element.name === sectionName && (element.parent === body || element.parent?.name === q('pPr'))) sections.push(element)
    for (const child of element.children) visit(child)
  }
  visit(body)
  const page = `<${q('pgSz')} ${q('w')}="${A4_PAGE_TWIPS.width}" ${q('h')}="${A4_PAGE_TWIPS.height}"/>`
  const margin = `<${q('pgMar')} ${q('top')}="${A4_PAGE_TWIPS.margin}" ${q('right')}="${A4_PAGE_TWIPS.margin}" ${q('bottom')}="${A4_PAGE_TWIPS.margin}" ${q('left')}="${A4_PAGE_TWIPS.margin}" ${q('header')}="720" ${q('footer')}="720" ${q('gutter')}="0"/>`
  const geometry = page + margin
  const finalSection = sections.find((section) => section.parent === body)
  if (sections.filter((section) => section.parent === body).length > 1 || (finalSection !== undefined && body.children.at(-1) !== finalSection)) return fail('最终 sectPr 必须唯一且位于 body 末尾')
  if (body.selfClosing) {
    const opening = xml.slice(body.start, body.openEnd).replace(/\s*\/\s*>$/, '>')
    const result = xml.slice(0, body.start) + `${opening}<${q('p')}/><${sectionName}>${geometry}</${sectionName}></${q('body')}>` + xml.slice(body.end)
    assertA4WordGeometryXml(result)
    return result
  }
  const patches: { start: number; end: number; replacement: string }[] = sections.map((section) => {
    const opening = xml.slice(section.start, section.openEnd).replace(/\s*\/\s*>$/, '>')
    const children = section.children.filter((child) => child.name !== q('pgSz') && child.name !== q('pgMar'))
    const afterGeometry = children.find((child) => SECTION_ORDER.indexOf(child.name.slice(prefix === '' ? 0 : prefix.length + 1) as typeof SECTION_ORDER[number]) > SECTION_ORDER.indexOf('pgMar'))
    const insertAt = afterGeometry?.start ?? section.closeStart
    let content = ''; let cursor = section.openEnd; let inserted = false
    for (const child of section.children) {
      if (!inserted && child.start >= insertAt) { content += xml.slice(cursor, child.start) + geometry; cursor = child.start; inserted = true }
      if (child.name === q('pgSz') || child.name === q('pgMar')) { content += xml.slice(cursor, child.start); cursor = child.end }
    }
    content += xml.slice(cursor, section.closeStart)
    if (!inserted) content += geometry
    return { start: section.start, end: section.end, replacement: `${opening}${content}</${sectionName}>` }
  })
  if (finalSection === undefined) {
    patches.push({ start: body.closeStart, end: body.closeStart, replacement: `${body.children.length === 0 ? `<${q('p')}/>` : ''}<${sectionName}>${geometry}</${sectionName}>` })
  }
  let result = xml
  for (const patch of patches.sort((a, b) => b.start - a.start)) result = result.slice(0, patch.start) + patch.replacement + result.slice(patch.end)
  /* Reparse the generated shape. The real ZIP/DOCX/PDF validators still run
     after this pure patch; this is not a substitute for those output gates. */
  assertA4WordGeometryXml(result)
  return result
}
