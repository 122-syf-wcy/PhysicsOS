import { describe, expect, it } from 'vitest'
import { assertA4WordGeometryXml, patchReferenceA4Xml, safeReferenceBodyXml, sanitizeReferencePackageXml } from '../src/reference-layout.ts'

const documentXml = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`
const content = '<w:p w:rsidR="1234"><w:r><w:t>仅合成模板示例</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>'
const page = '<w:pgSz w:w="11906" w:h="16838"/>'
const margin = '<w:pgMar w:top="1021" w:right="1021" w:bottom="1021" w:left="1021" w:header="720" w:footer="720" w:gutter="0"/>'

describe('Pandoc stock reference A4 geometry', () => {
  it.each(['<w:sectPr />', '<w:sectPr/>', '<w:sectPr></w:sectPr>'])('expands valid %s and preserves all other stock nodes exactly', (section) => {
    const stock = documentXml(`${content}\n    ${section}\n  `)
    const expected = stock.replace(section, `<w:sectPr>${page}${margin}</w:sectPr>`)
    const result = patchReferenceA4Xml(stock)
    expect(result).toBe(expected)
    expect(result.match(/<w:sectPr\b/g)).toHaveLength(1)
    expect(result.match(/<w:pgSz\b/g)).toHaveLength(1)
    expect(result.match(/<w:pgMar\b/g)).toHaveLength(1)
    expect(() => assertA4WordGeometryXml(result)).not.toThrow()
    expect(patchReferenceA4Xml(result)).toBe(result)
  })

  it('adds the missing final sectPr at body end, without replacing paragraphs or tables', () => {
    const stock = documentXml(content)
    const result = patchReferenceA4Xml(stock)
    expect(result).toBe(stock.replace('</w:body>', `<w:sectPr>${page}${margin}</w:sectPr></w:body>`))
    expect(result).toContain(content)
    expect(() => assertA4WordGeometryXml(result)).not.toThrow()
  })

  it('replaces duplicate/Letter geometry once and preserves section metadata in legal child order', () => {
    const metadata = '<w:headerReference w:type="default" r:id="rId1"/><w:footnotePr><w:numFmt w:val="decimal"/></w:footnotePr>'
    const trailing = '<w:cols w:space="720"/><w:docGrid w:linePitch="360"/>'
    const stock = documentXml(`${content}<w:sectPr w:rsidR="abcd">${metadata}<w:pgSz w:w="12240" w:h="15840"/><w:pgSz w:w="612" w:h="792"/><w:pgMar w:top="1440"/>${trailing}</w:sectPr>`)
    const result = patchReferenceA4Xml(stock)
    expect(result).toContain(`<w:sectPr w:rsidR="abcd">${metadata}${page}${margin}${trailing}</w:sectPr>`)
    expect(result).toContain(content)
    expect(result.match(/<w:pgSz\b/g)).toHaveLength(1)
    expect(() => assertA4WordGeometryXml(result)).not.toThrow()
  })

  it('requires unique final section and does not waive malformed or duplicate output geometry', () => {
    expect(() => patchReferenceA4Xml(documentXml(`${content}<w:sectPr/><w:sectPr/>`))).toThrow('最终 sectPr 必须唯一')
    expect(() => patchReferenceA4Xml(documentXml(`<w:sectPr/>${content}`))).toThrow('body 末尾')
    expect(() => patchReferenceA4Xml('<w:document><w:body><w:sectPr /></w:body></w:document>')).toThrow('命名空间')
    expect(() => patchReferenceA4Xml(documentXml('<w:p>'))).toThrow('标签配对')
    expect(() => assertA4WordGeometryXml(documentXml(`${content}<w:sectPr>${page}${page}${margin}</w:sectPr>`))).toThrow('只能有一个 pgSz')
    expect(() => assertA4WordGeometryXml(documentXml(`${content}<w:sectPr>${margin}${page}</w:sectPr>`))).toThrow('顺序错误')
    expect(() => assertA4WordGeometryXml(documentXml(`${content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>${margin}</w:sectPr>`))).toThrow('不是纵向 A4')
    expect(() => assertA4WordGeometryXml(documentXml(`${content}<w:sectPr>${page}<w:pgMar w:top="1021"/></w:sectPr>`))).toThrow('不是 18mm')
  })
})

const relationshipsXml = (relations: string): string => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}</Relationships>`
const relation = (id: string, type: string, target: string, mode = ''): string => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${mode === '' ? '' : ` TargetMode="${mode}"`}/>`

function stockPackage(): Map<string, string> {
  return new Map([
    ['word/document.xml', documentXml(`${content}<w:p><w:hyperlink r:id="rId30"><w:r><w:t>Stock hyperlink sample</w:t></w:r></w:hyperlink></w:p><w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>`)],
    ['word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Normal"/></w:styles>'],
    ['word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Preserved header</w:t></w:r></w:p></w:hdr>'],
    ['word/footer1.xml', '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Preserved footer</w:t></w:r></w:p></w:ftr>'],
    ['word/_rels/document.xml.rels', relationshipsXml(relation('rId30', 'hyperlink', 'https://synthetic-not-requested.invalid/', 'External') + relation('rIdStyles', 'styles', 'styles.xml') + relation('rIdHeader', 'header', 'header1.xml') + relation('rIdFooter', 'footer', 'footer1.xml'))],
  ])
}

describe('reference-only sample and relationship sanitization', () => {
  it('uses a safe minimal reference body while preserving style/header/footer parts and valid relationships', () => {
    const parts = stockPackage()
    const result = sanitizeReferencePackageXml(parts, [...parts.keys()])
    const document = result.get('word/document.xml')!
    expect(document).not.toContain('Stock hyperlink sample')
    expect(document).not.toContain('仅合成模板示例')
    expect(document).not.toContain('<w:tbl')
    expect(document).toContain('<w:p/><w:sectPr>')
    expect(document).toContain('r:id="rIdHeader"')
    expect(document).toContain('r:id="rIdFooter"')
    expect(result.get('word/_rels/document.xml.rels')).not.toContain('TargetMode="External"')
    expect(result.get('word/_rels/document.xml.rels')).not.toContain('rId30')
    for (const path of ['word/styles.xml', 'word/header1.xml', 'word/footer1.xml']) expect(result.get(path)).toBe(parts.get(path))
    expect(() => assertA4WordGeometryXml(document)).not.toThrow()
    expect(safeReferenceBodyXml(document)).toBe(document)
    expect(sanitizeReferencePackageXml(result, [...parts.keys()])).toEqual(result)
  })

  it('removes a stock header hyperlink reference without corrupting retained internal parts', () => {
    const parts = stockPackage()
    parts.set('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:hyperlink r:id="hLink"><w:r><w:t>Header sample link</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:t>Preserved header</w:t></w:r></w:p></w:hdr>')
    parts.set('word/_rels/header1.xml.rels', relationshipsXml(relation('hLink', 'hyperlink', 'https://synthetic-not-requested.invalid/header', 'External')))
    const result = sanitizeReferencePackageXml(parts, [...parts.keys()])
    expect(result.get('word/header1.xml')).not.toContain('Header sample link')
    expect(result.get('word/header1.xml')).toContain('Preserved header')
    expect(result.get('word/_rels/header1.xml.rels')).not.toContain('External')
  })

  it('rejects external images, missing targets and dangling internal resource references rather than waiving them', () => {
    const external = stockPackage()
    external.set('word/_rels/document.xml.rels', external.get('word/_rels/document.xml.rels')!.replace('relationships/hyperlink', 'relationships/image'))
    expect(() => sanitizeReferencePackageXml(external, [...external.keys()])).toThrow('外部图片')
    const missing = stockPackage()
    missing.delete('word/header1.xml')
    expect(() => sanitizeReferencePackageXml(missing, [...missing.keys()])).toThrow('缺失部件')
    const dangling = stockPackage()
    dangling.set('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:p><w:r r:id="missing-image"/></w:p></w:hdr>')
    expect(() => sanitizeReferencePackageXml(dangling, [...dangling.keys()])).toThrow('XML 引用断裂')
    const falseLink = stockPackage()
    falseLink.set('word/header1.xml', '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:p><w:r><a:blip r:embed="hLink"/></w:r></w:p></w:hdr>')
    falseLink.set('word/_rels/header1.xml.rels', relationshipsXml(relation('hLink', 'hyperlink', 'https://synthetic-not-requested.invalid/img', 'External')))
    expect(() => sanitizeReferencePackageXml(falseLink, [...falseLink.keys()])).toThrow('非 hyperlink 资源引用')
  })
})
