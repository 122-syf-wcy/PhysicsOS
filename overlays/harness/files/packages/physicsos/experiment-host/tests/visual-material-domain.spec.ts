import { expect, it } from 'vitest'
import {
  visualMaterialDescriptor, visualMaterialLimits, visualMaterialPackageProvenance,
  type VisualMaterialRecord,
} from '../src/visual-material-contracts.ts'
import {
  VisualMaterialCursorCodec, visualMaterialActor, visualMaterialGeneratedMetadata, visualMaterialGenerationUsage, visualMaterialIndex, visualMaterialMatch,
  visualMaterialSearchPlan, visualMaterialTokenize,
} from '../src/visual-material-domain.ts'
import { compileVisualMaterialSearch } from '../src/visual-material-sql.ts'
import { visualMaterialSqlIdentifier } from '../src/visual-material-schema.ts'

const actor = { userKey: 'user-private', schoolId: 'school-one' }
const record = (theme = '牛顿实验室 Newton Lab'): VisualMaterialRecord => {
  const metadata = {
    id: `vmat_${'a'.repeat(32)}`, revision: 2, sha256: 'b'.repeat(64), byteLength: 100,
    mediaType: 'image/png' as const, width: 256, height: 256, kind: 'environment' as const,
    theme, purpose: '力学 mechanics appearance', tags: ['木纹 Wood', '实验室'], style: 'Warm Lab',
    model: 'model-private', lifecycle: 'ready' as const, visibility: 'private' as const,
    createdAt: 100, updatedAt: 100, metadataTrust: 'untrusted' as const,
  }
  return { ...metadata, ownerKey: actor.userKey, schoolId: actor.schoolId, operationId: 'operation-private',
    privatePrompt: 'raw question from private account', sourceJobId: 'job-private',
    generationChannelId: 'channel-private', generationConfigRevision: 'config-private', generationUsage: { totalTokens: 142 },
    index: visualMaterialIndex(metadata),
    blobDurable: true, publicationPending: false, retentionCharged: true }
}

it('normalizes bilingual words and bounded Chinese phrase/ngram terms without an extension', () => {
  const terms = visualMaterialTokenize('ＷＯＯＤ wood 牛顿实验室 实验室 Newton力学')
  expect(terms).toContain('wood')
  expect(terms).toContain('牛顿')
  expect(terms).toContain('实验室')
  expect(terms).toContain('newton')
  expect(terms).toContain('力学')
  expect(terms.filter(term => term === 'wood')).toHaveLength(1)
  expect(visualMaterialTokenize('物理'.repeat(1000))).toHaveLength(4)
  expect(visualMaterialTokenize(Array.from({ length: 1000 }, (_, i) => `词语${i}`).join(' ').slice(0, 4096))).toHaveLength(64)
  const indexed = visualMaterialIndex(record())
  expect(indexed.terms.length).toBeLessThanOrEqual(512)
  expect(indexed.tagKeys).toEqual(['实验室', '木纹 wood'].sort())
  expect(indexed.entries.some(entry => entry.field === 'tags' && entry.term === '实验室' && entry.weight === 8)).toBe(true)
})

it('ranks exact fields transparently and tag evidence above unrelated weaker fields', () => {
  const row = record(), query = visualMaterialSearchPlan({ query: '实验室' }, 200)
  const match = visualMaterialMatch(row, query)
  expect(match.matchedTerms).toEqual(['实验', '实验室', '验室'])
  expect(match.fields.tags).toBe(72)
  expect(match.fields.theme).toBe(18)
  expect(match.score).toBe(Object.values(match.fields).reduce((a, b) => a + b, 0))
  const withoutTag = { ...row, tags: [], index: visualMaterialIndex({ ...row, tags: [] }) }
  expect(visualMaterialMatch(row, query).score).toBeGreaterThan(visualMaterialMatch(withoutTag, query).score)
  expect(visualMaterialMatch(row, visualMaterialSearchPlan({}, 200)).score).toBe(0)
})

it('bounds private generation provenance to identifiers and a numeric usage allowlist', () => {
  const usage = { inputTokens: 42, outputTokens: 100, totalTokens: 142, textInputTokens: 40, imageInputTokens: 2 }
  expect(visualMaterialGenerationUsage(usage)).toEqual(usage)
  const metadata = visualMaterialGeneratedMetadata({
    operationId: 'op', bytes: Buffer.alloc(1), mediaType: 'image/png', width: 256, height: 256,
    model: 'test', theme: 'lab', purpose: 'appearance', kind: 'environment', tags: [],
    generationChannelId: 'channel-private', generationConfigRevision: 'config-private', generationUsage: usage,
  })
  expect(metadata).toMatchObject({ generationChannelId: 'channel-private', generationConfigRevision: 'config-private', generationUsage: usage })
  for (const invalid of [{ inputTokens: -1 }, { inputTokens: 1.5 }, { inputTokens: Infinity }, { inputTokens: 1_000_000_001 },
    { inputTokens: '42' }, { inputTokens: 42, account: 'secret' }, [], null]) {
    expect(() => visualMaterialGenerationUsage(invalid)).toThrow()
  }
  const query = compileVisualMaterialSearch('public', actor, visualMaterialSearchPlan({ query: 'lab' }))
  expect(query.text).not.toMatch(/generation_channel_id|generation_config_revision|generation_usage|private_prompt|source_job_id/)
})

it('rejects oversized/invalid filters, public publication, identities and unsafe SQL identifiers', () => {
  expect(() => visualMaterialSearchPlan({ limit: 101 })).toThrow()
  expect(() => visualMaterialSearchPlan({ query: '\0' })).toThrow()
  expect(() => visualMaterialSearchPlan({ query: '?!' })).toThrow()
  expect(() => visualMaterialSearchPlan({ minWidth: -1 })).toThrow()
  expect(() => visualMaterialSearchPlan({ tags: Array(33).fill('tag') })).toThrow()
  expect(() => visualMaterialActor({ ...actor, userKey: '\0' })).toThrow()
  expect(visualMaterialActor(actor)).toEqual(actor)
  expect(() => visualMaterialLimits({ maxStageBytes: 1 })).toThrow()
  expect(() => visualMaterialLimits({ maxImageBytes: 10 * 1024 * 1024 })).toThrow()
  expect(() => visualMaterialSqlIdentifier('public; DROP TABLE users')).toThrow()
  expect(visualMaterialSqlIdentifier('PhysicsOS_Catalog')).toBe('"PhysicsOS_Catalog"')
})

it('compiles GIN candidate search and deterministic keyset pages with parameterized user metadata', () => {
  const malicious = "wood' OR true; --", plan = { ...visualMaterialSearchPlan({ query: malicious, theme: malicious, kind: 'environment', tags: [malicious], minWidth: 256, limit: 4 }, 1000),
    after: { score: 10, createdAt: 900, id: `vmat_${'c'.repeat(32)}` } }
  const query = compileVisualMaterialSearch('private_catalog', { userKey: malicious, schoolId: malicious }, plan)
  expect(query.text).toContain('m."terms" &&')
  expect(query.text).toContain('m."tag_keys" @>')
  expect(query.text).toContain('CROSS JOIN LATERAL')
  expect(query.text).toContain('(ranked."score", ranked."created_at", ranked."id") <')
  expect(query.text).toContain('"private_catalog"."physicsos_visual_material_terms"')
  expect(query.text).not.toContain(malicious)
  expect(query.text).not.toMatch(/\bOFFSET\b|jsonb_each|CREATE EXTENSION/i)
  expect(query.values).toContain(malicious)
  expect(query.values.at(-1)).toBe(5)
})

it('signs restart-stable owner/school/filter-bound cursors and refuses tampering or reuse elsewhere', () => {
  const codec = new VisualMaterialCursorCodec(Buffer.alloc(32, 1)), plan = visualMaterialSearchPlan({ query: 'wood' }, 1000)
  const cursor = codec.encode(actor, plan, { id: record().id, score: 50, createdAt: 100 })
  expect(new VisualMaterialCursorCodec(Buffer.alloc(32, 1)).apply(actor, visualMaterialSearchPlan({ query: 'WOOD', limit: 4 }, 1200), cursor)).toMatchObject({
    asOf: 1000, after: { score: 50, createdAt: 100, id: record().id },
  })
  expect(() => codec.apply({ ...actor, userKey: 'foreign' }, plan, cursor)).toThrow()
  expect(() => codec.apply({ ...actor, schoolId: 'other' }, plan, cursor)).toThrow()
  expect(() => codec.apply(actor, visualMaterialSearchPlan({ query: 'other' }, 1200), cursor)).toThrow()
  expect(() => codec.apply(actor, plan, `${cursor.slice(0, -2)}AA`)).toThrow()
})

it('catalog projection keeps private provenance server-side and public package provenance contains no untrusted text', () => {
  const row = record('raw private question and account name')
  const descriptor = visualMaterialDescriptor(row), catalog = JSON.stringify(descriptor), provenance = JSON.stringify(visualMaterialPackageProvenance(row))
  expect(catalog).not.toMatch(/user-private|school-one|raw question from|job-private|operation-private|privatePrompt|index|retentionCharged|channel-private|config-private|generationUsage|totalTokens/)
  expect(provenance).not.toMatch(/raw private question|model-private|user-private|school-one|Wood|Warm|vmat_|sourceJobId|operationId|channel-private|config-private|generationUsage|totalTokens/)
  expect(JSON.parse(provenance)).toMatchObject({ sha256: row.sha256, width: 256, source: 'PhysicsOS generated appearance material' })
})
