/** Metadata-only PostgreSQL audit queries. These helpers never generate a data mutation. */

const schemaName = (value: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('School audit schema is invalid.')
  return `"${value}"`
}
const recordName = (schema: string, table: string): string => {
  if (!/^u_[a-f0-9]{60}$/.test(table)) throw new Error('School audit table must be a storage-domain record table.')
  return `${schemaName(schema)}."${table}"`
}
const identifier = (value: string): string => {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) throw new Error('School audit identifier is invalid.')
  return `'${value}'`
}

/**
 * Count structured ownership/review references across the complete observed record-table inventory.
 * @param schema - Production schema already obtained from storage metadata.
 * @param tables - Complete physical record tables obtained from information_schema, including Canvas.
 * @param schoolIds - Explicit reviewed candidates, never guesses based on a school's display name.
 * @returns A transaction which is read-only and emits only physical table, school id and row count.
 */
export function schoolReferenceAuditSql(schema: string, tables: readonly string[], schoolIds: readonly string[]): string {
  if (tables.length === 0 || schoolIds.length === 0) throw new Error('School reference audit requires a complete table inventory and explicit candidates.')
  const inventory = [...new Set(tables)]
  const candidates = [...new Set(schoolIds)].map(id => `(${identifier(id)})`).join(',')
  const records = inventory.map(table => `SELECT '${table}' AS physical,value::jsonb AS row FROM ${recordName(schema, table)}`).join(' UNION ALL ')
  const fields = ['schoolId', 'scope', 'affectedSchools', 'sourceSchoolId', 'targetSchoolId', 'mergedInto', 'rosterAliasOf',
    'ownerKey', 'userKey', 'studentKey', 'actorKey', 'addedBy', 'createdBy', 'updatedBy', 'requestedBy', 'decidedBy', 'revokedBy', 'reviewedBy']
  const predicate = fields.map(field => `EXISTS(SELECT 1 FROM jsonb_path_query(r.row,'$.**.${field}') v WHERE v=to_jsonb(s.id) OR (jsonb_typeof(v)='array' AND v @> jsonb_build_array(s.id)) OR (jsonb_typeof(v)='string' AND left(v#>>'{}',length(s.id)+1)=s.id||':'))`).join(' OR ')
  return `BEGIN READ ONLY; WITH records AS (${records}), candidates(id) AS (VALUES ${candidates}) SELECT json_build_object('physical',r.physical,'schoolId',s.id,'references',count(*)) FROM records r CROSS JOIN candidates s WHERE ${predicate} GROUP BY r.physical,s.id ORDER BY s.id,r.physical; COMMIT;`
}

/**
 * Inspect original school names and application links without selecting credentials or applicant details.
 * @param schema - Authoritative database schema.
 * @param tables - Physical auth table names from the deployed storage-domain name derivation.
 * @returns Read-only nonseed roster/counts and duplicate groups; applicant email columns and user rows are excluded.
 */
export function schoolRosterAuditSql(schema: string, tables: { readonly schools: string; readonly users: string; readonly requests: string; readonly registrations: string }): string {
  const schools = recordName(schema, tables.schools), users = recordName(schema, tables.users)
  const requests = recordName(schema, tables.requests), registrations = recordName(schema, tables.registrations)
  return `BEGIN READ ONLY;
WITH schools AS (SELECT value::jsonb AS row FROM ${schools})
SELECT json_build_object('id',row->>'id','name',row->>'name','status',row->>'status','mergedInto',row->>'mergedInto',
'users',(SELECT count(*) FROM ${users} u WHERE u.value::jsonb->>'schoolId'=schools.row->>'id'),
'requests',(SELECT count(*) FROM ${requests} r WHERE r.value::jsonb->>'schoolId'=schools.row->>'id'),
'pendingRegistrations',(SELECT count(*) FROM ${registrations} p WHERE p.value::jsonb->>'schoolId'=schools.row->>'id'))
FROM schools WHERE row->>'id' NOT LIKE 'gz_%' ORDER BY row->>'name';
WITH normalized AS (SELECT value::jsonb AS row,lower(btrim(regexp_replace(normalize(value::jsonb->>'name',NFKC),'\\s+',' ','g'))) AS name_key FROM ${schools})
SELECT json_build_object('normalized',name_key,'schools',json_agg(json_build_object('id',row->>'id','name',row->>'name','status',row->>'status')))
FROM normalized GROUP BY name_key HAVING count(*)>1 ORDER BY name_key; COMMIT;`
}
