# @deepseek-ai/dsh-storage-postgres

PostgreSQL backend for the [storage hub](../storage/README.md): registers as
backend `postgres` and serves the `kv` facet through one bounded `pg`
connection pool.

## Storage model

The backend keeps its metadata in two tables inside the configured schema:
`dsh_storage_units` stamps each unit's descriptor version at first open, and
`dsh_storage_globals` holds each unit's global singleton. A unit/table pair
gets its own `u_<digest>` table, where the digest is derived from both
validated names. This keeps physical identifiers inside PostgreSQL's 63-byte
limit and prevents underscore combinations such as (`a_b`, `c`) and (`a`,
`b_c`) from sharing storage.

Records use a JSON text value plus a SHA-256 hash of the JSON-encoded key.
The hash is the primary key, while the full key remains in `key_json`; keys
therefore do not consume PostgreSQL's B-tree entry budget and may contain
NUL, Unicode, or very large strings. Upserts and deletes are single
parameterized SQL statements, so PostgreSQL's statement atomicity and normal
durable commit behavior satisfy the hub's write contract without a
caller-visible transaction.

Unit and table names are validated against the storage hub's `UNIT_NAME_RE`.
The schema name is validated and length-bounded before quoting. Metadata
names are fixed, physical names are digests, and every record value or key
travels as a SQL parameter.

## Configuration (schemastery)

```ts
interface Config {
  connectionString: string
  schema?: string // validated identifier; default 'public'
  maxConnections?: number // integer from 1 to 100; default 10
  ssl?: boolean | 'require' // default false
}
```

`ssl: true` uses the platform's normal certificate verification.
`ssl: 'require'` enables TLS while accepting the server certificate without
additional CA configuration. Invalid configuration fails during plugin
construction rather than at the first query.

## Lifecycle and errors

Opening a missing unit creates its metadata row and record tables
transactionally. A differing version stamp rejects with `version-mismatch`.
An invalid JSON value or key in the medium rejects reads with
`malformed-medium`. A second open of the same unit name rejects, calls after
a unit close reject with `closed`, and both unit and backend close are
idempotent and drain in-flight operations.

## Model Experience

### Stored domain records

#### What the model sees

Nothing. This backend contributes no prompt, tool, or schema; it persists
host-side domain data behind `ctx.storage`.

#### Token effect

Zero live-request tokens.

#### KV Cache effect

None. The backend never touches live request prefixes.

## Known Limitations and Deferred Work

- There is no schema migration framework. The release currently has one
  layout and treats compatibility changes as a future migration task.
- PostgreSQL lock or serialization failures are surfaced directly; this
  backend adds no retry loop.
- The key primary key uses a SHA-256 digest. A digest collision between two
  distinct keys would alias those records; the probability is treated as
  negligible for the current medium.
- TLS modes beyond `true` and `'require'` are deferred until a deployment
  needs custom certificate material or hostname verification controls.
