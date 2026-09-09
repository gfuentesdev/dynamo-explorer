export type ScalarInputType = 'string' | 'number' | 'boolean' | 'binary' | 'null'

export type DynamoValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'binary'; value: string }
  | { type: 'null' }
  | { type: 'stringSet'; value: string[] }
  | { type: 'numberSet'; value: string[] }
  | { type: 'binarySet'; value: string[] }
  | { type: 'list'; value: DynamoValue[] }
  | { type: 'map'; value: Record<string, DynamoValue> }

export type DynamoItem = Record<string, DynamoValue>

export interface AwsProfile {
  name: string
  region?: string
  source: 'config' | 'credentials' | 'both'
  isSso: boolean
}

export interface ConnectionContext {
  profile: string
  region: string
}

export interface TableListResult {
  tableNames: string[]
  truncated: boolean
}

export interface KeyDefinition {
  name: string
  type: 'S' | 'N' | 'B'
}

export interface IndexDefinition {
  name: string
  kind: 'TABLE' | 'GSI' | 'LSI'
  partitionKey: KeyDefinition
  sortKey?: KeyDefinition
}

export interface TableSchema {
  tableName: string
  status?: string
  itemCount?: number
  sizeBytes?: number
  billingMode?: string
  indexes: IndexDefinition[]
}

export interface TypedInput {
  type: ScalarInputType
  value?: string | boolean
}

export type FilterOperator =
  | 'eq'
  | 'ne'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between'
  | 'beginsWith'
  | 'contains'
  | 'exists'
  | 'notExists'

export interface FilterCondition {
  path: string
  operator: FilterOperator
  valueType: ScalarInputType
  value?: string | boolean
  secondValue?: string | boolean
}

export type SortKeyOperator = 'eq' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'beginsWith'

export interface SortKeyCondition {
  operator: SortKeyOperator
  value: TypedInput
  secondValue?: TypedInput
}

export interface ExploreRequest extends ConnectionContext {
  tableName: string
  indexName?: string
  mode: 'scan' | 'query'
  partitionKeyValue?: TypedInput
  sortKeyCondition?: SortKeyCondition
  filters: FilterCondition[]
  limit: number
  cursor?: DynamoItem
}

export interface ExploreResult {
  items: DynamoItem[]
  lastEvaluatedKey?: DynamoItem
  count: number
  scannedCount: number
  capacityUnits?: number
  durationMs: number
  mode: 'scan' | 'query'
}

export interface DeleteRequest extends ConnectionContext {
  tableName: string
  key: DynamoItem
}

export interface DeleteResult {
  deleted: boolean
}

export interface DynamoExplorerApi {
  listProfiles: () => Promise<AwsProfile[]>
  listTables: (connection: ConnectionContext) => Promise<TableListResult>
  describeTable: (request: ConnectionContext & { tableName: string }) => Promise<TableSchema>
  explore: (request: ExploreRequest) => Promise<ExploreResult>
  deleteItem: (request: DeleteRequest) => Promise<DeleteResult>
}

