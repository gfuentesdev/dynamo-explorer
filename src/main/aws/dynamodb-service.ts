import {
  DeleteItemCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  QueryCommand,
  ScanCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/client-dynamodb'
import { fromIni } from '@aws-sdk/credential-providers'
import type {
  ConnectionContext,
  DeleteRequest,
  DeleteResult,
  DynamoItem,
  ExploreRequest,
  ExploreResult,
  IndexDefinition,
  KeyDefinition,
  TableListResult,
  TableSchema,
} from '../../shared/types'
import { attributeMapToDynamoItem, dynamoItemToAttributeMap } from './attribute-values'
import { buildExploreExpressions } from './expressions'

const clients = new Map<string, DynamoDBClient>()
const schemaCache = new Map<string, TableSchema>()

export async function listTables(connection: ConnectionContext): Promise<TableListResult> {
  validateConnection(connection)
  const client = getClient(connection)
  const tableNames: string[] = []
  let cursor: string | undefined
  let page = 0

  do {
    const response = await client.send(new ListTablesCommand({ ExclusiveStartTableName: cursor, Limit: 100 }))
    tableNames.push(...(response.TableNames ?? []))
    cursor = response.LastEvaluatedTableName
    page += 1
  } while (cursor && page < 10)

  return { tableNames: tableNames.sort((a, b) => a.localeCompare(b)), truncated: Boolean(cursor) }
}

export async function describeTable(
  request: ConnectionContext & { tableName: string },
): Promise<TableSchema> {
  validateConnection(request)
  validateTableName(request.tableName)
  const cacheKey = `${request.profile}\0${request.region}\0${request.tableName}`
  const cached = schemaCache.get(cacheKey)
  if (cached) return cached

  const response = await getClient(request).send(new DescribeTableCommand({ TableName: request.tableName }))
  const table = response.Table
  if (!table?.KeySchema) throw new Error('DynamoDB no devolvió el esquema de la tabla.')
  const attributeTypes = new Map(table.AttributeDefinitions?.map((definition) => [definition.AttributeName, definition.AttributeType]))

  const indexes: IndexDefinition[] = [
    indexDefinition('TABLE', 'Tabla principal', table.KeySchema, attributeTypes),
    ...(table.GlobalSecondaryIndexes ?? []).map((index) =>
      indexDefinition('GSI', index.IndexName ?? '', index.KeySchema ?? [], attributeTypes),
    ),
    ...(table.LocalSecondaryIndexes ?? []).map((index) =>
      indexDefinition('LSI', index.IndexName ?? '', index.KeySchema ?? [], attributeTypes),
    ),
  ]

  const schema: TableSchema = {
    tableName: request.tableName,
    status: table.TableStatus,
    itemCount: table.ItemCount,
    sizeBytes: table.TableSizeBytes,
    billingMode: table.BillingModeSummary?.BillingMode,
    indexes,
  }
  schemaCache.set(cacheKey, schema)
  return schema
}

export async function explore(request: ExploreRequest): Promise<ExploreResult> {
  validateExploreRequest(request)
  const schema = await describeTable(request)
  const index = resolveIndex(schema, request.indexName)
  const expressions = buildExploreExpressions(request, index)
  const exclusiveStartKey = request.cursor ? dynamoItemToAttributeMap(request.cursor) : undefined
  const startedAt = performance.now()

  const common = {
    TableName: request.tableName,
    IndexName: request.indexName,
    Limit: request.limit,
    ExclusiveStartKey: exclusiveStartKey,
    ReturnConsumedCapacity: 'TOTAL' as const,
    ...expressions,
  }
  const client = getClient(request)
  const response =
    request.mode === 'query'
      ? await client.send(new QueryCommand(common satisfies QueryCommandInput))
      : await client.send(new ScanCommand(common satisfies ScanCommandInput))

  return {
    items: (response.Items ?? []).map(attributeMapToDynamoItem),
    lastEvaluatedKey: response.LastEvaluatedKey
      ? attributeMapToDynamoItem(response.LastEvaluatedKey)
      : undefined,
    count: response.Count ?? 0,
    scannedCount: response.ScannedCount ?? 0,
    capacityUnits: response.ConsumedCapacity?.CapacityUnits,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    mode: request.mode,
  }
}

export async function deleteItem(request: DeleteRequest): Promise<DeleteResult> {
  validateConnection(request)
  validateTableName(request.tableName)
  if (!isPlainObject(request.key)) throw new Error('La clave del registro no es válida.')

  const schema = await describeTable(request)
  const tableIndex = schema.indexes.find((index) => index.kind === 'TABLE')
  if (!tableIndex) throw new Error('No se encontró la clave primaria de la tabla.')

  const requiredKeys = [tableIndex.partitionKey, tableIndex.sortKey].filter(Boolean) as KeyDefinition[]
  if (Object.keys(request.key).length !== requiredKeys.length) {
    throw new Error('La eliminación requiere exactamente la partition key y la sort key de la tabla.')
  }
  for (const definition of requiredKeys) {
    const value = request.key[definition.name]
    if (!value) throw new Error(`Falta la clave “${definition.name}”.`)
    const expectedType = definition.type === 'S' ? 'string' : definition.type === 'N' ? 'number' : 'binary'
    if (value.type !== expectedType) throw new Error(`La clave “${definition.name}” tiene un tipo incorrecto.`)
  }

  const response = await getClient(request).send(
    new DeleteItemCommand({
      TableName: request.tableName,
      Key: dynamoItemToAttributeMap(request.key),
      ReturnValues: 'ALL_OLD',
    }),
  )
  return { deleted: Boolean(response.Attributes) }
}

export function extractTableKey(item: DynamoItem, schema: TableSchema): DynamoItem {
  const tableIndex = schema.indexes.find((index) => index.kind === 'TABLE')
  if (!tableIndex) throw new Error('No se encontró la clave primaria de la tabla.')
  const names = [tableIndex.partitionKey.name, tableIndex.sortKey?.name].filter(Boolean) as string[]
  return Object.fromEntries(names.map((name) => [name, item[name]]).filter((entry) => Boolean(entry[1])))
}

function getClient(connection: ConnectionContext): DynamoDBClient {
  validateConnection(connection)
  const key = `${connection.profile}\0${connection.region}`
  let client = clients.get(key)
  if (!client) {
    client = new DynamoDBClient({
      region: connection.region,
      credentials: fromIni({ profile: connection.profile }),
      maxAttempts: 3,
    })
    clients.set(key, client)
  }
  return client
}

function resolveIndex(schema: TableSchema, indexName?: string): IndexDefinition {
  const index = indexName
    ? schema.indexes.find((candidate) => candidate.name === indexName)
    : schema.indexes.find((candidate) => candidate.kind === 'TABLE')
  if (!index) throw new Error('El índice seleccionado ya no existe.')
  return index
}

function indexDefinition(
  kind: IndexDefinition['kind'],
  name: string,
  keySchema: Array<{ AttributeName?: string; KeyType?: string }>,
  attributeTypes: Map<string | undefined, string | undefined>,
): IndexDefinition {
  const partitionName = keySchema.find((key) => key.KeyType === 'HASH')?.AttributeName
  const sortName = keySchema.find((key) => key.KeyType === 'RANGE')?.AttributeName
  if (!partitionName) throw new Error(`El índice “${name}” no tiene partition key.`)

  return {
    name,
    kind,
    partitionKey: keyDefinition(partitionName, attributeTypes),
    sortKey: sortName ? keyDefinition(sortName, attributeTypes) : undefined,
  }
}

function keyDefinition(name: string, attributeTypes: Map<string | undefined, string | undefined>): KeyDefinition {
  const type = attributeTypes.get(name)
  if (type !== 'S' && type !== 'N' && type !== 'B') throw new Error(`Tipo de clave desconocido para “${name}”.`)
  return { name, type }
}

function validateExploreRequest(request: ExploreRequest): void {
  validateConnection(request)
  validateTableName(request.tableName)
  if (request.mode !== 'query' && request.mode !== 'scan') throw new Error('Modo de consulta no válido.')
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 200) {
    throw new Error('El límite debe estar entre 1 y 200.')
  }
  if (!Array.isArray(request.filters) || request.filters.length > 8) throw new Error('Puedes usar hasta 8 filtros.')
}

function validateConnection(connection: ConnectionContext): void {
  if (typeof connection.profile !== 'string' || !connection.profile.trim() || connection.profile.length > 255) {
    throw new Error('Perfil AWS no válido.')
  }
  if (typeof connection.region !== 'string' || !/^[a-z0-9-]{3,64}$/.test(connection.region)) {
    throw new Error('Región AWS no válida.')
  }
}

function validateTableName(tableName: string): void {
  if (typeof tableName !== 'string' || !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName)) {
    throw new Error('Nombre de tabla no válido.')
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
