import { describe, expect, it } from 'vitest'
import { assertA4WordGeometryXml, patchReferenceA4Xml } from '../src/reference-layout.ts'

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
