/** Independent normalized catalog schema. No storage-domain JSON snapshots or optional PG extensions. */
import type { PoolClient } from 'pg'
import { VisualMaterialError } from './visual-material-contracts.ts'

export const VISUAL_MATERIAL_SCHEMA_VERSION = 2
export const VISUAL_MATERIAL_TABLES = Object.freeze({
  migration: 'physicsos_visual_material_migrations', material: 'physicsos_visual_materials',
  term: 'physicsos_visual_material_terms', ref: 'physicsos_visual_material_refs',
  operation: 'physicsos_visual_material_operations', quota: 'physicsos_visual_material_quotas',
})
export type VisualMaterialTableNames = Record<keyof typeof VISUAL_MATERIAL_TABLES, string>
export function visualMaterialSqlIdentifier(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value) || Buffer.byteLength(value) > 63) {
    throw new VisualMaterialError(500, 'CONFIG_INVALID', 'Invalid visual material PostgreSQL schema identifier.')
  }
  return `"${value}"`
}
export function visualMaterialTableNames(schema: string): VisualMaterialTableNames {
  const quoted = visualMaterialSqlIdentifier(schema)
  return Object.fromEntries(Object.entries(VISUAL_MATERIAL_TABLES).map(([key, name]) => [key, `${quoted}.${visualMaterialSqlIdentifier(name)}`])) as VisualMaterialTableNames
}
const index = (name: string): string => visualMaterialSqlIdentifier(`physicsos_vm_${name}`)

/** Execute inside the caller's BEGIN/COMMIT and schema-scoped migration advisory transaction lock. */
export async function migrateVisualMaterialSchema(client: PoolClient, schema: string): Promise<void> {
  const t = visualMaterialTableNames(schema)
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${visualMaterialSqlIdentifier(schema)}`)
  await client.query(`CREATE TABLE IF NOT EXISTS ${t.migration} (
    "version" INTEGER PRIMARY KEY CHECK ("version" > 0), "applied_at" BIGINT NOT NULL
  )`)
  const version = await client.query<{ version: number }>(`SELECT COALESCE(MAX("version"), 0)::integer AS "version" FROM ${t.migration}`)
  if ((version.rows[0]?.version ?? 0) > VISUAL_MATERIAL_SCHEMA_VERSION) {
    throw new VisualMaterialError(503, 'SCHEMA_VERSION', 'Visual material database requires a newer host.')
  }
  await client.query(`CREATE TABLE IF NOT EXISTS ${t.material} (
    "id" TEXT COLLATE "C" PRIMARY KEY CHECK ("id" ~ '^vmat_[a-f0-9]{32}$'),
    "owner_key" TEXT NOT NULL CHECK (length("owner_key") BETWEEN 1 AND 200),
    "school_id" TEXT NOT NULL CHECK (length("school_id") <= 200),
    "operation_id" TEXT NOT NULL CHECK (length("operation_id") BETWEEN 1 AND 200),
    "revision" INTEGER NOT NULL CHECK ("revision" >= 1),
    "sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
    "byte_length" BIGINT NOT NULL CHECK ("byte_length" BETWEEN 1 AND 6291456),
    "media_type" TEXT NOT NULL CHECK ("media_type" = 'image/png'),
    "width" INTEGER NOT NULL CHECK ("width" BETWEEN 64 AND 4096),
    "height" INTEGER NOT NULL CHECK ("height" BETWEEN 64 AND 4096),
    "kind" TEXT NOT NULL CHECK ("kind" IN ('environment', 'material')),
    "theme" TEXT NOT NULL CHECK (length("theme") BETWEEN 1 AND 256),
    "purpose" TEXT NOT NULL CHECK (length("purpose") BETWEEN 1 AND 256),
    "style" TEXT CHECK (length("style") BETWEEN 1 AND 128),
    "tags" TEXT[] NOT NULL CHECK (cardinality("tags") <= 32),
    "model" TEXT NOT NULL CHECK (length("model") BETWEEN 1 AND 128),
    "theme_key" TEXT NOT NULL, "purpose_key" TEXT NOT NULL, "style_key" TEXT NOT NULL,
    "tag_keys" TEXT[] NOT NULL, "terms" TEXT[] NOT NULL CHECK (cardinality("terms") <= 512),
    "private_prompt" TEXT CHECK (octet_length("private_prompt") <= 20000),
    "source_job_id" TEXT CHECK (length("source_job_id") BETWEEN 1 AND 200),
    "lifecycle" TEXT NOT NULL CHECK ("lifecycle" IN ('pending', 'ready', 'deleted', 'canceled', 'failed')),
    "visibility" TEXT NOT NULL CHECK ("visibility" IN ('private', 'school')),
    "created_at" BIGINT NOT NULL CHECK ("created_at" >= 0),
    "updated_at" BIGINT NOT NULL CHECK ("updated_at" >= "created_at"),
    "blob_durable" BOOLEAN NOT NULL DEFAULT FALSE,
    "publication_pending" BOOLEAN NOT NULL DEFAULT TRUE,
    "retention_charged" BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE ("owner_key", "operation_id"), UNIQUE ("id", "owner_key"),
    CHECK ("width"::bigint * "height"::bigint <= 8388608),
    CHECK ("lifecycle" NOT IN ('ready', 'deleted') OR "blob_durable"),
    CHECK ("blob_durable" OR "visibility" = 'private')
  )`)
  // v2: bounded private generation provenance, additive on an already deployed v1 catalog.
  await client.query(`ALTER TABLE ${t.material} ADD COLUMN IF NOT EXISTS "generation_channel_id" TEXT
    CHECK (length("generation_channel_id") BETWEEN 1 AND 200)`)
  await client.query(`ALTER TABLE ${t.material} ADD COLUMN IF NOT EXISTS "generation_config_revision" TEXT
    CHECK (length("generation_config_revision") BETWEEN 1 AND 200)`)
  await client.query(`ALTER TABLE ${t.material} ADD COLUMN IF NOT EXISTS "generation_usage" JSONB
    CHECK ("generation_usage" IS NULL OR (
      jsonb_typeof("generation_usage") = 'object' AND octet_length("generation_usage"::text) <= 512
      AND "generation_usage" - ARRAY['inputTokens', 'outputTokens', 'totalTokens', 'textInputTokens', 'imageInputTokens']::text[] = '{}'::jsonb
      ${['inputTokens', 'outputTokens', 'totalTokens', 'textInputTokens', 'imageInputTokens'].map(key => `AND (NOT ("generation_usage" ? '${key}') OR (
        jsonb_typeof("generation_usage" -> '${key}') = 'number'
        AND CASE WHEN ("generation_usage" ->> '${key}') ~ '^[0-9]{1,10}$'
          THEN ("generation_usage" ->> '${key}')::numeric BETWEEN 0 AND 1000000000 ELSE FALSE END
      ))`).join('\n      ')}
    ))`)
  await client.query(`CREATE TABLE IF NOT EXISTS ${t.term} (
    "material_id" TEXT NOT NULL REFERENCES ${t.material}("id") ON DELETE RESTRICT,
    "term" TEXT NOT NULL CHECK (length("term") BETWEEN 1 AND 64),
    "field" TEXT NOT NULL CHECK ("field" IN ('theme', 'purpose', 'tags', 'style', 'kind')),
    "weight" INTEGER NOT NULL CHECK ("weight" BETWEEN 1 AND 8),
    PRIMARY KEY ("material_id", "term", "field")
  )`)
  // Explicit school references, not a public digest or generic sharing capability.
  await client.query(`CREATE TABLE IF NOT EXISTS ${t.ref} (
    "material_id" TEXT PRIMARY KEY, "owner_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" = 'school'),
    "school_id" TEXT NOT NULL CHECK (length("school_id") BETWEEN 1 AND 200),
    "created_at" BIGINT NOT NULL,
    FOREIGN KEY ("material_id", "owner_key") REFERENCES ${t.material}("id", "owner_key") ON DELETE RESTRICT
  )`)
  await client.query(`CREATE TABLE IF NOT EXISTS ${t.operation} (
    "owner_key" TEXT NOT NULL, "operation_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('generated', 'manage')),
    "fingerprint" TEXT CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'),
    "state" TEXT NOT NULL CHECK ("state" IN ('pending', 'applied', 'canceled')),
    "material_id" TEXT REFERENCES ${t.material}("id") ON DELETE RESTRICT,
    "result" JSONB, "last_error_code" TEXT,
    "created_at" BIGINT NOT NULL, "updated_at" BIGINT NOT NULL,
    PRIMARY KEY ("owner_key", "operation_id"),
    CHECK (length("operation_id") BETWEEN 1 AND 200),
    CHECK ("state" <> 'applied' OR ("material_id" IS NOT NULL AND "result" IS NOT NULL))
  )`)
  await client.query(`CREATE TABLE IF NOT EXISTS ${t.quota} (
    "scope" TEXT NOT NULL CHECK ("scope" IN ('global', 'owner')), "subject" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL DEFAULT 0 CHECK ("bytes" >= 0),
    "count" BIGINT NOT NULL DEFAULT 0 CHECK ("count" >= 0),
    "operations" BIGINT NOT NULL DEFAULT 0 CHECK ("operations" >= 0),
    "active_count" BIGINT NOT NULL DEFAULT 0 CHECK ("active_count" >= 0),
    "stage_bytes" BIGINT NOT NULL DEFAULT 0 CHECK ("stage_bytes" >= 0),
    PRIMARY KEY ("scope", "subject"), CHECK ("scope" <> 'global' OR "subject" = '')
  )`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('owner_lifecycle_time')} ON ${t.material} ("owner_key", "lifecycle", "created_at" DESC, "id" DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('owner_time')} ON ${t.material} ("owner_key", "created_at" DESC, "id" DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('lifecycle_time')} ON ${t.material} ("lifecycle", "created_at" DESC, "id" DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('pending_time')} ON ${t.material} ("created_at", "id") WHERE "publication_pending"`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('terms_gin')} ON ${t.material} USING GIN ("terms")`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('tag_keys_gin')} ON ${t.material} USING GIN ("tag_keys")`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('theme_key')} ON ${t.material} ("theme_key", "lifecycle", "created_at" DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('purpose_key')} ON ${t.material} ("purpose_key", "lifecycle", "created_at" DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('kind_style')} ON ${t.material} ("kind", "style_key", "lifecycle", "created_at" DESC)`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('term_lookup')} ON ${t.term} ("term", "material_id", "field")`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('school_ref')} ON ${t.ref} ("school_id", "material_id")`)
  await client.query(`CREATE INDEX IF NOT EXISTS ${index('operation_state_time')} ON ${t.operation} ("owner_key", "state", "created_at")`)
  await client.query(`INSERT INTO ${t.quota} ("scope", "subject") VALUES ('global', '') ON CONFLICT DO NOTHING`)
  await client.query(`INSERT INTO ${t.migration} ("version", "applied_at") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [VISUAL_MATERIAL_SCHEMA_VERSION, Date.now()])
}
