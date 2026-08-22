/**
 * Dialect-aware technical metadata adapters. Every statement is package-owned,
 * read-only, bounded by the shared connection runner, and returns normalized
 * observations rather than CLI text.
 */

import type { DataAgentConnections, DatabaseConnection, DatabaseType } from './connections.ts'
import { createHash } from 'node:crypto'
import { SQLSERVER_COLUMN_SEPARATOR } from './clients.ts'
import {
  catalogAssetId,
  canonicalCatalogIdentity,
  catalogTechnicalFingerprint,
  normalizeCatalogText,
  stableJson,
} from './catalog-identity.ts'
import type {
  CatalogAssetStatus,
  CatalogIdentity,
  CatalogObservation,
  CatalogRelation,
  CatalogScope,
  CatalogTechnicalPayload,
} from './catalog-types.ts'

export interface CatalogAdapterOptions {
  maxTextChars: number
  schemaConcurrency: number
  assetConcurrency: number
}

export interface CatalogAdapterContext {
  connections: DataAgentConnections
  connection: DatabaseConnection
  sessionId: string
  sourceId: string
  runId: string
  scope: CatalogScope
  signal: AbortSignal
  options: CatalogAdapterOptions
  onProgress?(kind: 'schema' | 'relation' | 'field'): void
}

export interface CatalogAdapterResult {
  observations: CatalogObservation[]
  relations: CatalogRelation[]
  coverageComplete: boolean
  unavailableScopes: string[]
}

export interface CatalogAdapter {
  readonly type: DatabaseType
  readonly capabilities: Readonly<Record<string, 'supported' | 'unsupported' | 'unavailable'>>
  scan(context: CatalogAdapterContext): Promise<CatalogAdapterResult>
}

interface RawMetadataRow {
  rowKind: 'relation' | 'column' | 'primary_key' | 'foreign_key' | 'index'
  schema: string
  relation: string
  relationType: string
  relationComment: string
  column: string
  dataType: string
  nullable: string
  columnComment: string
  ordinal: string
}

const ACCESS_DENIED = /access denied|permission denied|not authorized|insufficient privilege|ora-01031|authorizationexception/i

/** Registry contains an explicit adapter entry for every supported dialect. */
export function createCatalogAdapterRegistry(): Readonly<Record<DatabaseType, CatalogAdapter>> {
  return {
    mysql: richAdapter('mysql'),
    doris: richAdapter('doris'),
    postgres: richAdapter('postgres'),
    sqlserver: richAdapter('sqlserver'),
    sqlite: richAdapter('sqlite'),
    oracle: richAdapter('oracle'),
    clickhouse: richAdapter('clickhouse'),
    hive: describeAdapter('hive'),
    impala: describeAdapter('impala'),
  }
}

function richAdapter(type: Exclude<DatabaseType, 'hive' | 'impala'>): CatalogAdapter {
  const keyCapabilities: Record<Exclude<DatabaseType, 'hive' | 'impala'>, {
    primaryKeys: 'supported' | 'unsupported'
    foreignKeys: 'supported' | 'unsupported'
    indexes: 'supported' | 'unsupported'
  }> = {
    mysql: { primaryKeys: 'supported', foreignKeys: 'supported', indexes: 'supported' },
    doris: { primaryKeys: 'unsupported', foreignKeys: 'unsupported', indexes: 'unsupported' },
    postgres: { primaryKeys: 'supported', foreignKeys: 'supported', indexes: 'supported' },
    sqlserver: { primaryKeys: 'supported', foreignKeys: 'supported', indexes: 'supported' },
    sqlite: { primaryKeys: 'supported', foreignKeys: 'supported', indexes: 'supported' },
    oracle: { primaryKeys: 'supported', foreignKeys: 'supported', indexes: 'supported' },
    clickhouse: { primaryKeys: 'supported', foreignKeys: 'unsupported', indexes: 'supported' },
  }
  return {
    type,
    capabilities: {
      schemas: 'supported', tables: 'supported', views: 'supported', columns: 'supported',
      comments: type === 'sqlite' ? 'unsupported' : 'supported',
      ...keyCapabilities[type],
    },
    async scan(context) {
      const schemas = await scopedSchemas(context)
      const scanned = await mapLimit(schemas, context.options.schemaConcurrency, async (schema) => {
        context.signal.throwIfAborted()
        context.onProgress?.('schema')
        try {
          const sql = buildCatalogMetadataSql(type, context.connection.database, schema, tableName(context.scope))
          const result = await context.connections.queryMetadata(context.sessionId, sql, context.signal)
          if (result.truncated) {
            throw new Error('Catalog metadata output exceeded catalogMaxResultChars; narrow the scan scope or increase the Catalog metadata limit')
          }
          const rows = parseCatalogMetadataRows(type, result.stdout)
          const built = observationsFromRows(context, schema, rows)
          return {
            observations: [observationForSchema(context, schema, 'observed'), ...built.observations],
            relations: built.relations,
            unavailableScope: undefined,
          }
        } catch (error) {
          if (!ACCESS_DENIED.test(error instanceof Error ? error.message : String(error))) throw error
          return {
            observations: [observationForSchema(context, schema, 'unavailable')],
            unavailableScope: schema,
          }
        }
      }, context.signal)
      const observations = scanned.flatMap(value => value.observations)
      const relations = scanned.flatMap(value => value.relations ?? [])
      const unavailableScopes = scanned.flatMap(value => value.unavailableScope === undefined ? [] : [value.unavailableScope])
      return {
        observations: dedupeObservations(observations),
        relations: dedupeRelations(relations),
        coverageComplete: unavailableScopes.length === 0,
        unavailableScopes,
      }
    },
  }
}

function describeAdapter(type: 'hive' | 'impala'): CatalogAdapter {
  return {
    type,
    capabilities: {
      schemas: 'supported', tables: 'supported', views: 'unavailable', columns: 'supported',
      comments: 'supported', primaryKeys: 'unsupported', foreignKeys: 'unsupported', indexes: 'unsupported',
    },
    async scan(context) {
      const scanned = await mapLimit(await scopedSchemas(context), context.options.schemaConcurrency, async (schema) => {
        context.signal.throwIfAborted()
        context.onProgress?.('schema')
        let relations: string[]
        try {
          relations = context.scope.kind === 'table'
            ? [context.scope.table]
            : await context.connections.listTables(context.sessionId, schema, context.signal)
        } catch (error) {
          if (!ACCESS_DENIED.test(error instanceof Error ? error.message : String(error))) throw error
          return { observations: [observationForSchema(context, schema, 'unavailable')], unavailableScopes: [schema] }
        }
        const relationDetails = await mapLimit(relations, context.options.assetConcurrency, async (relation) => {
          context.signal.throwIfAborted()
          context.onProgress?.('relation')
          try {
            const columns = await context.connections.describe(context.sessionId, schema, relation, context.signal)
            return {
              observations: [observationForRelation(context, schema, relation, 'table', '', 'observed'), ...columns.map((column, index) => {
                const observation = observationForColumn(
                  context,
                  schema,
                  relation,
                  'table',
                  column.name,
                  column.type,
                  column.nullable,
                  '',
                  index + 1,
                )
                context.onProgress?.('field')
                return observation
              })],
              unavailableScope: undefined,
            }
          } catch (error) {
            if (!ACCESS_DENIED.test(error instanceof Error ? error.message : String(error))) throw error
            return {
              observations: [observationForRelation(context, schema, relation, 'table', '', 'unavailable')],
              unavailableScope: `${schema}.${relation}`,
            }
          }
        }, context.signal)
        const detailUnavailable = relationDetails.flatMap(value => value.unavailableScope === undefined ? [] : [value.unavailableScope])
        return {
          observations: [observationForSchema(context, schema, 'observed'), ...relationDetails.flatMap(value => value.observations)],
          unavailableScopes: detailUnavailable,
        }
      }, context.signal)
      const observations = scanned.flatMap(value => value.observations)
      const unavailableScopes = scanned.flatMap(value => value.unavailableScopes)
      return { observations: dedupeObservations(observations), relations: [], coverageComplete: unavailableScopes.length === 0, unavailableScopes }
    },
  }
}

async function scopedSchemas(context: CatalogAdapterContext): Promise<string[]> {
  if (context.scope.kind !== 'source') return [context.scope.schema]
  return context.connections.listSchemas(context.sessionId, context.signal)
}

function tableName(scope: CatalogScope): string | undefined {
  return scope.kind === 'table' ? scope.table : undefined
}

function catalogDatabase(context: CatalogAdapterContext): string {
  if (context.connection.type !== 'sqlite') return context.connection.database
  return context.connection.database.split(/[\\/]/).filter(Boolean).at(-1) ?? context.connection.database
}

/** Pure SQL constructor used by fixture tests; values are SQL literals, never identifiers. */
export function buildCatalogMetadataSql(
  type: Exclude<DatabaseType, 'hive' | 'impala'>,
  database: string,
  schema: string,
  table?: string,
): string {
  const schemaValue = sqlLiteral(schema)
  const tableFilter = (column: string): string => table === undefined ? '' : ` AND ${column}=${sqlLiteral(table)}`
  switch (type) {
    case 'mysql':
    case 'doris':
      return [
        "SELECT 'relation' AS row_kind, TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, COALESCE(TABLE_COMMENT,''), '', '', '', '', '0'",
        `FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=${schemaValue}${tableFilter('TABLE_NAME')}`,
        'UNION ALL',
        "SELECT 'column', TABLE_SCHEMA, TABLE_NAME, '', '', COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COALESCE(COLUMN_COMMENT,''), CAST(ORDINAL_POSITION AS CHAR)",
        `FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=${schemaValue}${tableFilter('TABLE_NAME')}`,
        ...(type === 'mysql' ? [
          'UNION ALL',
          "SELECT CASE tc.CONSTRAINT_TYPE WHEN 'PRIMARY KEY' THEN 'primary_key' ELSE 'foreign_key' END, k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, COALESCE(k.REFERENCED_TABLE_SCHEMA,''), k.COLUMN_NAME, COALESCE(k.REFERENCED_TABLE_NAME,''), COALESCE(k.REFERENCED_COLUMN_NAME,''), '', CAST(k.ORDINAL_POSITION AS CHAR)",
          'FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND k.TABLE_NAME=tc.TABLE_NAME AND k.CONSTRAINT_NAME=tc.CONSTRAINT_NAME',
          `WHERE k.TABLE_SCHEMA=${schemaValue} AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY','FOREIGN KEY')${tableFilter('k.TABLE_NAME')}`,
          'UNION ALL',
          "SELECT 'index', TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, '', COALESCE(COLUMN_NAME,''), '', '', CASE NON_UNIQUE WHEN 0 THEN 'unique' ELSE '' END, CAST(SEQ_IN_INDEX AS CHAR)",
          `FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=${schemaValue} AND INDEX_NAME <> 'PRIMARY'${tableFilter('TABLE_NAME')}`,
        ] : []),
        'ORDER BY 2,3,1,10;',
      ].join(' ')
    case 'postgres':
      return [
        "SELECT 'relation', n.nspname, c.relname, CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'VIEW' ELSE 'BASE TABLE' END, COALESCE(obj_description(c.oid),'') , '', '', '', '', '0'",
        'FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace',
        `WHERE n.nspname=${schemaValue} AND c.relkind IN ('r','p','v','m')${tableFilter('c.relname')}`,
        'UNION ALL',
        "SELECT 'column', n.nspname, c.relname, '', '', a.attname, pg_catalog.format_type(a.atttypid,a.atttypmod), CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END, COALESCE(col_description(c.oid,a.attnum),''), a.attnum::text",
        'FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace',
        `WHERE n.nspname=${schemaValue} AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped${tableFilter('c.relname')}`,
        'UNION ALL',
        "SELECT CASE con.contype WHEN 'p' THEN 'primary_key' ELSE 'foreign_key' END, n.nspname, c.relname, con.conname, COALESCE(rn.nspname,''), a.attname, COALESCE(rc.relname,''), COALESCE(ra.attname,''), '', ord.n::text",
        'FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN LATERAL unnest(con.conkey) WITH ORDINALITY ord(attnum,n) ON true JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=ord.attnum LEFT JOIN pg_catalog.pg_class rc ON rc.oid=con.confrelid LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid=rc.relnamespace LEFT JOIN pg_catalog.pg_attribute ra ON ra.attrelid=rc.oid AND ra.attnum=con.confkey[ord.n]',
        `WHERE n.nspname=${schemaValue} AND con.contype IN ('p','f')${tableFilter('c.relname')}`,
        'UNION ALL',
        "SELECT 'index', n.nspname, c.relname, i.relname, '', a.attname, '', '', CASE ix.indisunique WHEN true THEN 'unique' ELSE '' END, ord.n::text",
        'FROM pg_catalog.pg_index ix JOIN pg_catalog.pg_class c ON c.oid=ix.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_class i ON i.oid=ix.indexrelid JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY ord(attnum,n) ON true LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=ord.attnum',
        `WHERE n.nspname=${schemaValue} AND NOT ix.indisprimary${tableFilter('c.relname')}`,
        'ORDER BY 2,3,1,10;',
      ].join(' ')
    case 'sqlserver':
      return [
        "SELECT 'relation', s.name, o.name, CASE WHEN o.type='V' THEN 'VIEW' ELSE 'BASE TABLE' END, COALESCE(CAST(ep.value AS nvarchar(4000)),''), '', '', '', '', '0'",
        'FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id LEFT JOIN sys.extended_properties ep ON ep.major_id=o.object_id AND ep.minor_id=0 AND ep.name=\'MS_Description\'',
        `WHERE s.name=${schemaValue} AND o.type IN ('U','V')${tableFilter('o.name')}`,
        'UNION ALL',
        "SELECT 'column', s.name, o.name, '', '', c.name, ty.name, CASE WHEN c.is_nullable=1 THEN 'YES' ELSE 'NO' END, COALESCE(CAST(ep.value AS nvarchar(4000)),''), CAST(c.column_id AS nvarchar(20))",
        'FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id LEFT JOIN sys.extended_properties ep ON ep.major_id=o.object_id AND ep.minor_id=c.column_id AND ep.name=\'MS_Description\'',
        `WHERE s.name=${schemaValue} AND o.type IN ('U','V')${tableFilter('o.name')}`,
        'UNION ALL',
        "SELECT 'primary_key', s.name, o.name, kc.name, '', c.name, '', '', '', CAST(ic.key_ordinal AS nvarchar(20))",
        'FROM sys.key_constraints kc JOIN sys.objects o ON o.object_id=kc.parent_object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.index_columns ic ON ic.object_id=o.object_id AND ic.index_id=kc.unique_index_id JOIN sys.columns c ON c.object_id=o.object_id AND c.column_id=ic.column_id',
        `WHERE s.name=${schemaValue} AND kc.type='PK'${tableFilter('o.name')}`,
        'UNION ALL',
        "SELECT 'foreign_key', s.name, o.name, fk.name, rs.name, c.name, ro.name, rc.name, '', CAST(fkc.constraint_column_id AS nvarchar(20))",
        'FROM sys.foreign_key_columns fkc JOIN sys.foreign_keys fk ON fk.object_id=fkc.constraint_object_id JOIN sys.objects o ON o.object_id=fkc.parent_object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.columns c ON c.object_id=o.object_id AND c.column_id=fkc.parent_column_id JOIN sys.objects ro ON ro.object_id=fkc.referenced_object_id JOIN sys.schemas rs ON rs.schema_id=ro.schema_id JOIN sys.columns rc ON rc.object_id=fkc.referenced_object_id AND rc.column_id=fkc.referenced_column_id',
        `WHERE s.name=${schemaValue}${tableFilter('o.name')}`,
        'UNION ALL',
        "SELECT 'index', s.name, o.name, i.name, '', c.name, '', '', CASE WHEN i.is_unique=1 THEN 'unique' ELSE '' END, CAST(ic.key_ordinal AS nvarchar(20))",
        'FROM sys.indexes i JOIN sys.objects o ON o.object_id=i.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id JOIN sys.columns c ON c.object_id=o.object_id AND c.column_id=ic.column_id',
        `WHERE s.name=${schemaValue} AND o.type='U' AND i.is_primary_key=0 AND i.is_hypothetical=0${tableFilter('o.name')}`,
        'ORDER BY 2,3,1,10;',
      ].join(' ')
    case 'sqlite':
      return [
        "SELECT 'relation', 'main', m.name, CASE m.type WHEN 'view' THEN 'VIEW' ELSE 'BASE TABLE' END, '', '', '', '', '', '0'",
        `FROM sqlite_master m WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'${tableFilter('m.name')}`,
        'UNION ALL',
        "SELECT 'column', 'main', m.name, '', '', p.name, p.type, CASE p.[notnull] WHEN 1 THEN 'NO' ELSE 'YES' END, '', CAST(p.cid + 1 AS TEXT)",
        `FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'${tableFilter('m.name')}`,
        'UNION ALL',
        "SELECT 'primary_key', 'main', m.name, 'PRIMARY', '', p.name, '', '', '', CAST(p.pk AS TEXT)",
        `FROM sqlite_master m JOIN pragma_table_xinfo(m.name) p WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND p.pk>0${tableFilter('m.name')}`,
        'UNION ALL',
        "SELECT 'foreign_key', 'main', m.name, 'fk_' || f.id, 'main', f.[from], f.[table], f.[to], '', CAST(f.seq + 1 AS TEXT)",
        `FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%'${tableFilter('m.name')}`,
        'UNION ALL',
        "SELECT 'index', 'main', m.name, il.name, '', ii.name, '', '', CASE il.[unique] WHEN 1 THEN 'unique' ELSE '' END, CAST(ii.seqno + 1 AS TEXT)",
        `FROM sqlite_master m JOIN pragma_index_list(m.name) il JOIN pragma_index_info(il.name) ii WHERE m.type='table' AND m.name NOT LIKE 'sqlite_%' AND il.origin <> 'pk'${tableFilter('m.name')}`,
        'ORDER BY 2,3,1,10;',
      ].join(' ')
    case 'oracle': {
      const owner = sqlLiteral(schema.toUpperCase())
      return [
        "SELECT 'relation', o.owner, o.object_name, CASE o.object_type WHEN 'VIEW' THEN 'VIEW' ELSE 'BASE TABLE' END, NVL(tc.comments,''), '', '', '', '', '0'",
        'FROM all_objects o LEFT JOIN all_tab_comments tc ON tc.owner=o.owner AND tc.table_name=o.object_name',
        `WHERE o.owner=${owner} AND o.object_type IN ('TABLE','VIEW')${tableFilter('o.object_name')}`,
        'UNION ALL',
        "SELECT 'column', c.owner, c.table_name, '', '', c.column_name, c.data_type, c.nullable, NVL(cc.comments,''), TO_CHAR(c.column_id)",
        'FROM all_tab_columns c LEFT JOIN all_col_comments cc ON cc.owner=c.owner AND cc.table_name=c.table_name AND cc.column_name=c.column_name',
        `WHERE c.owner=${owner}${tableFilter('c.table_name')}`,
        'UNION ALL',
        "SELECT CASE ac.constraint_type WHEN 'P' THEN 'primary_key' ELSE 'foreign_key' END, ac.owner, ac.table_name, ac.constraint_name, NVL(rac.owner,''), acc.column_name, NVL(rac.table_name,''), NVL(racc.column_name,''), '', TO_CHAR(acc.position)",
        'FROM all_constraints ac JOIN all_cons_columns acc ON acc.owner=ac.owner AND acc.constraint_name=ac.constraint_name LEFT JOIN all_constraints rac ON rac.owner=ac.r_owner AND rac.constraint_name=ac.r_constraint_name LEFT JOIN all_cons_columns racc ON racc.owner=rac.owner AND racc.constraint_name=rac.constraint_name AND racc.position=acc.position',
        `WHERE ac.owner=${owner} AND ac.constraint_type IN ('P','R')${tableFilter('ac.table_name')}`,
        'UNION ALL',
        "SELECT 'index', i.table_owner, i.table_name, i.index_name, '', ic.column_name, '', '', CASE i.uniqueness WHEN 'UNIQUE' THEN 'unique' ELSE '' END, TO_CHAR(ic.column_position)",
        'FROM all_indexes i JOIN all_ind_columns ic ON ic.index_owner=i.owner AND ic.index_name=i.index_name',
        `WHERE i.table_owner=${owner} AND NOT EXISTS (SELECT 1 FROM all_constraints c WHERE c.owner=i.table_owner AND c.table_name=i.table_name AND c.index_name=i.index_name AND c.constraint_type='P')${tableFilter('i.table_name')}`,
        'ORDER BY 2,3,1,10;',
      ].join(' ')
    }
    case 'clickhouse':
      return [
        "SELECT 'relation', database, name, CASE WHEN engine='View' OR engine='MaterializedView' THEN 'VIEW' ELSE 'BASE TABLE' END, comment, '', '', '', '', '0'",
        `FROM system.tables WHERE database=${schemaValue}${tableFilter('name')}`,
        'UNION ALL',
        "SELECT 'column', database, table, '', '', name, type, if(startsWith(type,'Nullable('),'YES','NO'), comment, toString(position)",
        `FROM system.columns WHERE database=${schemaValue}${tableFilter('table')}`,
        'UNION ALL',
        "SELECT 'primary_key', database, name, concat('PRIMARY ',substring(primary_key,1,200)), '', '', '', '', '', '0'",
        `FROM system.tables WHERE database=${schemaValue} AND primary_key != ''${tableFilter('name')}`,
        'UNION ALL',
        "SELECT 'index', database, name, concat('ORDER BY ',substring(sorting_key,1,200)), '', '', '', '', '', '0'",
        `FROM system.tables WHERE database=${schemaValue} AND sorting_key != ''${tableFilter('name')}`,
        'ORDER BY 2,3,1,10;',
      ].join(' ')
  }
}

export function parseCatalogMetadataRows(type: DatabaseType, stdout: string): RawMetadataRow[] {
  const delimiter = type === 'sqlserver' ? SQLSERVER_COLUMN_SEPARATOR : type === 'oracle' || type === 'postgres' || type === 'sqlite' ? '|' : '\t'
  const lines = stdout.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim().length > 0)
  const start = type === 'mysql' || type === 'doris' ? 1 : 0
  const rows: RawMetadataRow[] = []
  for (const line of lines.slice(start)) {
    const fields = line.split(delimiter).map(value => value.trim())
    if (fields.length < 10 || !['relation', 'column', 'primary_key', 'foreign_key', 'index'].includes(fields[0]!)) continue
    rows.push({
      rowKind: fields[0] as RawMetadataRow['rowKind'],
      schema: fields[1] ?? '',
      relation: fields[2] ?? '',
      relationType: fields[3] ?? '',
      relationComment: fields[4] ?? '',
      column: fields[5] ?? '',
      dataType: fields[6] ?? '',
      nullable: fields[7] ?? '',
      columnComment: fields[8] ?? '',
      ordinal: fields[9] ?? '',
    })
  }
  return rows
}

function observationsFromRows(
  context: CatalogAdapterContext,
  fallbackSchema: string,
  rows: RawMetadataRow[],
): { observations: CatalogObservation[]; relations: CatalogRelation[] } {
  const observations: CatalogObservation[] = []
  const relationTypes = new Map<string, 'table' | 'view'>()

  // Metadata queries sort by row kind for deterministic output. Since
  // `column` sorts before `relation`, discover every relation type before
  // creating child observations; otherwise columns belonging to views would
  // temporarily fall back to `table` and point at a parent asset that does not
  // exist in the staged snapshot.
  for (const row of rows) {
    if (row.rowKind !== 'relation' || row.relation.length === 0) continue
    const schema = row.schema || fallbackSchema
    relationTypes.set(`${schema}\0${row.relation}`, /view/i.test(row.relationType) ? 'view' : 'table')
  }

  for (const row of rows) {
    const schema = row.schema || fallbackSchema
    if (row.relation.length === 0) continue
    if (row.rowKind === 'relation') {
      const objectType = relationTypes.get(`${schema}\0${row.relation}`) ?? 'table'
      observations.push(observationForRelation(context, schema, row.relation, objectType, row.relationComment, 'observed'))
      context.onProgress?.('relation')
      continue
    }
    if (row.rowKind !== 'column' || row.column.length === 0) continue
    observations.push(observationForColumn(
      context,
      schema,
      row.relation,
      relationTypes.get(`${schema}\0${row.relation}`) ?? 'table',
      row.column,
      row.dataType,
      parseNullable(row.nullable),
      row.columnComment,
      Number.parseInt(row.ordinal, 10) || undefined,
    ))
    context.onProgress?.('field')
  }
  const grouped = new Map<string, RawMetadataRow[]>()
  for (const row of rows) {
    if (row.rowKind === 'relation' || row.rowKind === 'column') continue
    const schema = row.schema || fallbackSchema
    if (row.relation.length === 0 || row.relationType.length === 0) continue
    const key = [row.rowKind, schema, row.relation, row.relationType, row.relationComment, row.dataType].join('\0')
    const values = grouped.get(key) ?? []
    values.push(row)
    grouped.set(key, values)
  }
  const relations = [...grouped.values()].map(group => relationFromRows(context, fallbackSchema, group))
  return { observations, relations }
}

function relationFromRows(
  context: CatalogAdapterContext,
  fallbackSchema: string,
  rows: RawMetadataRow[],
): CatalogRelation {
  const first = rows[0]!
  if (first.rowKind === 'relation' || first.rowKind === 'column') {
    throw new Error('Catalog relation grouping received a non-relation metadata row')
  }
  const schema = first.schema || fallbackSchema
  const fromIdentity: CatalogIdentity = {
    sourceId: context.sourceId,
    database: catalogDatabase(context),
    schema,
    kind: 'table',
    name: first.relation,
  }
  const fromAssetId = catalogAssetId(context.connection.type, fromIdentity)
  const sorted = [...rows].sort((a, b) => (Number.parseInt(a.ordinal, 10) || 0) - (Number.parseInt(b.ordinal, 10) || 0))
  const columnAssetIds = sorted.flatMap(row => row.column.length === 0 ? [] : [catalogAssetId(context.connection.type, {
    ...fromIdentity,
    relation: first.relation,
    kind: 'column',
    name: row.column,
  })])
  const referencedSchema = first.relationComment || schema
  const referencedRelation = first.dataType
  const toAssetId = first.rowKind === 'foreign_key' && referencedRelation.length > 0
      ? catalogAssetId(context.connection.type, {
        sourceId: context.sourceId,
        database: catalogDatabase(context),
        schema: referencedSchema,
        kind: 'table',
        name: referencedRelation,
      })
    : undefined
  const referencedColumnAssetIds = first.rowKind === 'foreign_key' && referencedRelation.length > 0
      ? sorted.flatMap(row => row.nullable.length === 0 ? [] : [catalogAssetId(context.connection.type, {
        sourceId: context.sourceId,
        database: catalogDatabase(context),
        schema: referencedSchema,
        relation: referencedRelation,
        kind: 'column',
        name: row.nullable,
      })])
    : undefined
  const name = normalizeCatalogText(first.relationType, 256).value
  const id = `relation_${createHash('sha256').update(stableJson({
    sourceId: context.sourceId,
    kind: first.rowKind,
    fromAssetId,
    toAssetId,
    name,
  })).digest('hex').slice(0, 32)}`
  return {
    id,
    sourceId: context.sourceId,
    runId: context.runId,
    kind: first.rowKind,
    fromAssetId,
    ...toAssetId !== undefined ? { toAssetId } : {},
    name,
    columnAssetIds,
    ...referencedColumnAssetIds !== undefined ? { referencedColumnAssetIds } : {},
    observedAt: new Date().toISOString(),
  }
}

function observationForSchema(context: CatalogAdapterContext, schema: string, status: CatalogAssetStatus): CatalogObservation {
  return makeObservation(context, {
    sourceId: context.sourceId,
    database: catalogDatabase(context),
    schema,
    kind: 'schema',
    name: schema,
  }, {
    name: schema,
    path: `${catalogDatabase(context)}.${schema}`,
    capabilities: contextCapabilities(context),
  }, status)
}

function observationForRelation(
  context: CatalogAdapterContext,
  schema: string,
  relation: string,
  objectType: 'table' | 'view',
  rawComment: string,
  status: CatalogAssetStatus,
): CatalogObservation {
  const schemaIdentity: CatalogIdentity = {
    sourceId: context.sourceId,
    database: catalogDatabase(context),
    schema,
    kind: 'schema',
    name: schema,
  }
  const comment = normalizeCatalogText(rawComment, context.options.maxTextChars)
  return makeObservation(context, {
    sourceId: context.sourceId,
    database: catalogDatabase(context),
    schema,
    kind: objectType,
    name: relation,
  }, {
    name: relation,
    path: `${catalogDatabase(context)}.${schema}.${relation}`,
    parentId: catalogAssetId(context.connection.type, schemaIdentity),
    objectType,
    ...comment.value.length > 0 ? { comment: comment.value } : {},
    ...comment.truncated ? { truncatedFields: ['comment'] } : {},
    capabilities: contextCapabilities(context),
  }, status)
}

function observationForColumn(
  context: CatalogAdapterContext,
  schema: string,
  relation: string,
  objectType: 'table' | 'view',
  column: string,
  rawType: string,
  nullable: boolean | undefined,
  rawComment: string,
  ordinal: number | undefined,
): CatalogObservation {
  const parentIdentity: CatalogIdentity = {
    sourceId: context.sourceId,
    database: catalogDatabase(context),
    schema,
    kind: objectType,
    name: relation,
  }
  const type = normalizeCatalogText(rawType, 512)
  const comment = normalizeCatalogText(rawComment, context.options.maxTextChars)
  return makeObservation(context, {
    sourceId: context.sourceId,
    database: catalogDatabase(context),
    schema,
    relation,
    kind: 'column',
    name: column,
  }, {
    name: column,
    path: `${catalogDatabase(context)}.${schema}.${relation}.${column}`,
    parentId: catalogAssetId(context.connection.type, parentIdentity),
    ...type.value.length > 0 ? { dataType: type.value } : {},
    ...nullable !== undefined ? { nullable } : {},
    ...ordinal !== undefined ? { ordinal } : {},
    ...comment.value.length > 0 ? { comment: comment.value } : {},
    ...type.truncated || comment.truncated
      ? { truncatedFields: [type.truncated ? 'dataType' : '', comment.truncated ? 'comment' : ''].filter(Boolean) }
      : {},
    capabilities: contextCapabilities(context),
  }, 'observed')
}

function makeObservation(
  context: CatalogAdapterContext,
  rawIdentity: CatalogIdentity,
  values: Omit<CatalogTechnicalPayload, 'identity' | 'provenance'>,
  status: CatalogAssetStatus,
): CatalogObservation {
  const identity = canonicalCatalogIdentity(context.connection.type, rawIdentity)
  const payload: CatalogTechnicalPayload = {
    ...values,
    identity,
    provenance: { source: 'database', dialect: context.connection.type, runId: context.runId },
  }
  return {
    runId: context.runId,
    sourceId: context.sourceId,
    assetId: catalogAssetId(context.connection.type, identity),
    status,
    fingerprint: catalogTechnicalFingerprint(payload, status),
    observedAt: new Date().toISOString(),
    payload,
  }
}

function contextCapabilities(context: CatalogAdapterContext): Record<string, 'supported' | 'unsupported' | 'unavailable'> {
  const adapter = createCatalogAdapterRegistry()[context.connection.type]
  return { ...adapter.capabilities }
}

function parseNullable(value: string): boolean | undefined {
  if (/^(yes|y|true|1)$/i.test(value)) return true
  if (/^(no|n|false|0)$/i.test(value)) return false
  return undefined
}

function sqlLiteral(value: string): string {
  const safe = normalizeCatalogText(value, 256).value
  return `'${safe.replace(/'/g, "''")}'`
}

function dedupeObservations(values: CatalogObservation[]): CatalogObservation[] {
  return [...new Map(values.map(value => [value.assetId, value])).values()]
    .sort((a, b) => a.payload.path.localeCompare(b.payload.path) || a.assetId.localeCompare(b.assetId))
}

function dedupeRelations(values: CatalogRelation[]): CatalogRelation[] {
  return [...new Map(values.map(value => [value.id, value])).values()]
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Deterministic bounded worker pool that stops scheduling after the first failure. */
async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  task: (value: T, index: number) => Promise<R>,
  signal: AbortSignal,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Catalog adapter concurrency must be a positive integer')
  const output = new Array<R>(values.length)
  let cursor = 0
  let failure: unknown
  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      signal.throwIfAborted()
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      try {
        output[index] = await task(values[index]!, index)
      } catch (error) {
        failure ??= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker))
  if (failure !== undefined) throw failure
  return output
}
