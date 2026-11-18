/** SQL keyset/lexical query compiler. All user text, owner keys, filters and cursors are parameters. */
import type { VisualMaterialActor, VisualMaterialSearchPlan } from './visual-material-contracts.ts'
import { VISUAL_MATERIAL_EXACT_WEIGHTS } from './visual-material-domain.ts'
import { visualMaterialTableNames } from './visual-material-schema.ts'

export const VISUAL_MATERIAL_SELECT_COLUMNS = [
  'id', 'owner_key', 'school_id', 'operation_id', 'revision', 'sha256', 'byte_length', 'media_type',
  'width', 'height', 'kind', 'theme', 'purpose', 'style', 'tags', 'model', 'theme_key', 'purpose_key',
  'style_key', 'tag_keys', 'terms', 'private_prompt', 'source_job_id', 'lifecycle', 'visibility',
  'created_at', 'updated_at', 'blob_durable', 'publication_pending', 'retention_charged',
  'generation_channel_id', 'generation_config_revision', 'generation_usage',
] as const
export const visualMaterialSelectColumns = (alias = 'm', includePrivate = true): string => VISUAL_MATERIAL_SELECT_COLUMNS
  .filter(name => includePrivate || !(name === 'private_prompt' || name === 'source_job_id' || name === 'generation_channel_id'
    || name === 'generation_config_revision' || name === 'generation_usage'))
  .map(name => `${alias}."${name}"`).join(', ')

export function compileVisualMaterialSearch(schema: string, actor: VisualMaterialActor, plan: VisualMaterialSearchPlan): {
  readonly text: string
  readonly values: readonly unknown[]
} {
  const t = visualMaterialTableNames(schema), values: unknown[] = []
  const bind = (value: unknown): string => { values.push(value); return `$${values.length}` }
  const owner = bind(actor.userKey), school = plan.mode === 'search' ? bind(actor.schoolId) : undefined, asOf = bind(plan.asOf)
  const where: string[] = [
    plan.mode === 'owned' ? `m."owner_key" = ${owner}` : `(m."owner_key" = ${owner} OR (m."visibility" = 'school' AND ${school}::text <> '' AND EXISTS (
      SELECT 1 FROM ${t.ref} AS sr WHERE sr."material_id" = m."id" AND sr."owner_key" = m."owner_key" AND sr."school_id" = ${school}
    )))`,
    `m."created_at" <= ${asOf}::bigint`, `m."updated_at" <= ${asOf}::bigint`,
  ]
  if (plan.mode === 'search') where.push(`m."lifecycle" = 'ready'`)
  else if (plan.lifecycle !== undefined && plan.lifecycle !== 'all') where.push(`m."lifecycle" = ${bind(plan.lifecycle)}`)
  if (plan.themeKey !== undefined) where.push(`m."theme_key" = ${bind(plan.themeKey)}`)
  if (plan.purposeKey !== undefined) where.push(`m."purpose_key" = ${bind(plan.purposeKey)}`)
  if (plan.styleKey !== undefined) where.push(`m."style_key" = ${bind(plan.styleKey)}`)
  if (plan.kind !== undefined) where.push(`m."kind" = ${bind(plan.kind)}`)
  if (plan.tagKeys.length) where.push(`m."tag_keys" @> ${bind([...plan.tagKeys])}::text[]`)
  if (plan.minWidth !== undefined) where.push(`m."width" >= ${bind(plan.minWidth)}::integer`)
  if (plan.minHeight !== undefined) where.push(`m."height" >= ${bind(plan.minHeight)}::integer`)

  let join = '', matchedTerms = `ARRAY[]::text[]`, contributions = ['0', '0', '0', '0', '0']
  const fields = ['theme', 'purpose', 'tags', 'style', 'kind'] as const
  if (plan.queryTerms.length) {
    const terms = bind([...plan.queryTerms]), queryKey = bind(plan.queryKey)
    where.push(`m."terms" && ${terms}::text[]`) // built-in GIN candidate predicate before ranking
    matchedTerms = `lex."matched_terms"`
    join = `CROSS JOIN LATERAL (
      SELECT COALESCE(array_agg(DISTINCT mt."term" ORDER BY mt."term"), ARRAY[]::text[]) AS "matched_terms",
        ${fields.map(field => `COALESCE(SUM(mt."weight") FILTER (WHERE mt."field" = '${field}'), 0)::integer AS "${field}_score"`).join(',\n        ')}
      FROM ${t.term} AS mt WHERE mt."material_id" = m."id" AND mt."term" = ANY(${terms}::text[])
    ) AS lex`
    const exact: Record<typeof fields[number], string> = {
      theme: `m."theme_key" = ${queryKey}`, purpose: `m."purpose_key" = ${queryKey}`,
      tags: `${queryKey} = ANY(m."tag_keys")`, style: `m."style_key" = ${queryKey}`, kind: `m."kind" = ${queryKey}`,
    }
    contributions = fields.map(field => `(lex."${field}_score" + CASE WHEN ${exact[field]} THEN ${VISUAL_MATERIAL_EXACT_WEIGHTS[field]} ELSE 0 END)`)
  }
  const scores = contributions.map((value, at) => `${value}::integer AS "${fields[at]}_score"`).join(',\n      ')
  const score = contributions.join(' + ')
  let after = ''
  if (plan.after !== undefined) {
    const afterScore = bind(plan.after.score), afterTime = bind(plan.after.createdAt), afterId = bind(plan.after.id)
    after = `WHERE (ranked."score", ranked."created_at", ranked."id") < (${afterScore}::integer, ${afterTime}::bigint, ${afterId}::text)`
  }
  const limit = bind(plan.limit + 1)
  return {
    text: `WITH ranked AS (
      SELECT ${visualMaterialSelectColumns('m', false)}, ${matchedTerms} AS "matched_terms",
        (${score})::integer AS "score", ${scores},
        (SELECT sr."school_id" FROM ${t.ref} AS sr WHERE sr."material_id" = m."id") AS "share_school_id"
      FROM ${t.material} AS m ${join}
      WHERE ${where.join(' AND ')}
    ) SELECT * FROM ranked ${after}
      ORDER BY ranked."score" DESC, ranked."created_at" DESC, ranked."id" DESC
      LIMIT ${limit}::integer`,
    values,
  }
}
