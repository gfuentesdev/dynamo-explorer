import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import type { ExploreRequest, FilterCondition, IndexDefinition, TypedInput } from '../../shared/types'
import { typedInputToAttributeValue } from './attribute-values'

export interface BuiltExpressions {
  KeyConditionExpression?: string
  FilterExpression?: string
  ExpressionAttributeNames?: Record<string, string>
  ExpressionAttributeValues?: Record<string, AttributeValue>
}

class ExpressionBuilder {
  private nameIndex = 0
  private valueIndex = 0
  readonly names: Record<string, string> = {}
  readonly values: Record<string, AttributeValue> = {}

  path(path: string): string {
    const parts = parseDocumentPath(path)
    return parts
      .map(({ name, indexes }) => {
        const alias = `#n${this.nameIndex++}`
        this.names[alias] = name
        return `${alias}${indexes.map((index) => `[${index}]`).join('')}`
      })
      .join('.')
  }

  value(value: TypedInput): string {
    const alias = `:v${this.valueIndex++}`
    this.values[alias] = typedInputToAttributeValue(value)
    return alias
  }
}

export function buildExploreExpressions(request: ExploreRequest, index: IndexDefinition): BuiltExpressions {
  const builder = new ExpressionBuilder()
  let keyExpression: string | undefined

  if (request.mode === 'query') {
    if (!request.partitionKeyValue) throw new Error('Query requiere un valor para la partition key.')
    assertKeyInputType(request.partitionKeyValue, index.partitionKey.type, index.partitionKey.name)

    const partitionPath = builder.path(index.partitionKey.name)
    keyExpression = `${partitionPath} = ${builder.value(request.partitionKeyValue)}`

    if (request.sortKeyCondition) {
      if (!index.sortKey) throw new Error('El índice seleccionado no tiene sort key.')
      assertKeyInputType(request.sortKeyCondition.value, index.sortKey.type, index.sortKey.name)
      const sortPath = builder.path(index.sortKey.name)
      const condition = request.sortKeyCondition
      const firstValue = builder.value(condition.value)

      if (condition.operator === 'between') {
        if (!condition.secondValue) throw new Error('BETWEEN requiere dos valores.')
        assertKeyInputType(condition.secondValue, index.sortKey.type, index.sortKey.name)
        keyExpression += ` AND ${sortPath} BETWEEN ${firstValue} AND ${builder.value(condition.secondValue)}`
      } else if (condition.operator === 'beginsWith') {
        if (index.sortKey.type === 'N') throw new Error('begins_with no es válido para una sort key numérica.')
        keyExpression += ` AND begins_with(${sortPath}, ${firstValue})`
      } else {
        keyExpression += ` AND ${sortPath} ${operatorSymbol(condition.operator)} ${firstValue}`
      }
    }
  }

  const keyNames = new Set([index.partitionKey.name, index.sortKey?.name].filter(Boolean))
  const filterExpressions = request.filters.map((filter) => {
    const rootName = parseDocumentPath(filter.path)[0]?.name
    if (request.mode === 'query' && rootName && keyNames.has(rootName)) {
      throw new Error(`“${rootName}” es una clave del Query; configúrala en las condiciones de clave.`)
    }
    return buildFilterExpression(builder, filter)
  })

  return {
    KeyConditionExpression: keyExpression,
    FilterExpression: filterExpressions.length > 0 ? filterExpressions.join(' AND ') : undefined,
    ExpressionAttributeNames: Object.keys(builder.names).length > 0 ? builder.names : undefined,
    ExpressionAttributeValues: Object.keys(builder.values).length > 0 ? builder.values : undefined,
  }
}

function buildFilterExpression(builder: ExpressionBuilder, filter: FilterCondition): string {
  const path = builder.path(filter.path)
  if (filter.operator === 'exists') return `attribute_exists(${path})`
  if (filter.operator === 'notExists') return `attribute_not_exists(${path})`

  const input: TypedInput = { type: filter.valueType, value: filter.value }
  const firstValue = builder.value(input)

  if (filter.operator === 'between') {
    if (filter.secondValue === undefined) throw new Error('BETWEEN requiere dos valores.')
    const secondValue = builder.value({ type: filter.valueType, value: filter.secondValue })
    return `${path} BETWEEN ${firstValue} AND ${secondValue}`
  }
  if (filter.operator === 'beginsWith') return `begins_with(${path}, ${firstValue})`
  if (filter.operator === 'contains') return `contains(${path}, ${firstValue})`
  return `${path} ${operatorSymbol(filter.operator)} ${firstValue}`
}

function operatorSymbol(operator: string): string {
  const symbols: Record<string, string> = {
    eq: '=',
    ne: '<>',
    lt: '<',
    lte: '<=',
    gt: '>',
    gte: '>=',
  }
  const symbol = symbols[operator]
  if (!symbol) throw new Error(`Operador no soportado: ${operator}`)
  return symbol
}

function assertKeyInputType(input: TypedInput, keyType: 'S' | 'N' | 'B', name: string): void {
  const expected = keyType === 'S' ? 'string' : keyType === 'N' ? 'number' : 'binary'
  if (input.type !== expected) throw new Error(`La clave “${name}” requiere un valor ${expected}.`)
}

export function parseDocumentPath(path: string): Array<{ name: string; indexes: number[] }> {
  const trimmed = path.trim()
  if (trimmed.length === 0 || trimmed.length > 512) throw new Error('Escribe un atributo válido.')

  return trimmed.split('.').map((part) => {
    const match = /^([^\[\]]+)((?:\[\d+\])*)$/.exec(part)
    if (!match) throw new Error(`La ruta “${path}” no es válida.`)
    const indexes = [...match[2].matchAll(/\[(\d+)\]/g)].map((entry) => Number(entry[1]))
    return { name: match[1], indexes }
  })
}

