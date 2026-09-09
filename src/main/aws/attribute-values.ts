import type { AttributeValue } from '@aws-sdk/client-dynamodb'
import type { DynamoItem, DynamoValue, TypedInput } from '../../shared/types'

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

export function attributeValueToDynamoValue(value: AttributeValue): DynamoValue {
  if ('S' in value && value.S !== undefined) return { type: 'string', value: value.S }
  if ('N' in value && value.N !== undefined) return { type: 'number', value: value.N }
  if ('BOOL' in value && value.BOOL !== undefined) return { type: 'boolean', value: value.BOOL }
  if ('NULL' in value && value.NULL) return { type: 'null' }
  if ('B' in value && value.B !== undefined) {
    return { type: 'binary', value: Buffer.from(value.B).toString('base64') }
  }
  if ('SS' in value && value.SS !== undefined) return { type: 'stringSet', value: value.SS }
  if ('NS' in value && value.NS !== undefined) return { type: 'numberSet', value: value.NS }
  if ('BS' in value && value.BS !== undefined) {
    return { type: 'binarySet', value: value.BS.map((entry) => Buffer.from(entry).toString('base64')) }
  }
  if ('L' in value && value.L !== undefined) {
    return { type: 'list', value: value.L.map(attributeValueToDynamoValue) }
  }
  if ('M' in value && value.M !== undefined) {
    return { type: 'map', value: attributeMapToDynamoItem(value.M) }
  }

  throw new Error('El registro contiene un tipo DynamoDB no reconocido.')
}

export function attributeMapToDynamoItem(item: Record<string, AttributeValue>): DynamoItem {
  return Object.fromEntries(
    Object.entries(item).map(([name, value]) => [name, attributeValueToDynamoValue(value)]),
  )
}

export function dynamoValueToAttributeValue(value: DynamoValue): AttributeValue {
  switch (value.type) {
    case 'string':
      return { S: value.value }
    case 'number':
      assertNumber(value.value)
      return { N: value.value }
    case 'boolean':
      return { BOOL: value.value }
    case 'binary':
      return { B: decodeBase64(value.value) }
    case 'null':
      return { NULL: true }
    case 'stringSet':
      return { SS: value.value }
    case 'numberSet':
      value.value.forEach(assertNumber)
      return { NS: value.value }
    case 'binarySet':
      return { BS: value.value.map(decodeBase64) }
    case 'list':
      return { L: value.value.map(dynamoValueToAttributeValue) }
    case 'map':
      return { M: dynamoItemToAttributeMap(value.value) }
  }
}

export function dynamoItemToAttributeMap(item: DynamoItem): Record<string, AttributeValue> {
  return Object.fromEntries(
    Object.entries(item).map(([name, value]) => [name, dynamoValueToAttributeValue(value)]),
  )
}

export function typedInputToAttributeValue(input: TypedInput): AttributeValue {
  switch (input.type) {
    case 'string':
      return { S: assertStringValue(input.value) }
    case 'number': {
      const value = assertStringValue(input.value).trim()
      assertNumber(value)
      return { N: value }
    }
    case 'boolean':
      if (typeof input.value !== 'boolean') throw new Error('El valor booleano no es válido.')
      return { BOOL: input.value }
    case 'binary':
      return { B: decodeBase64(assertStringValue(input.value)) }
    case 'null':
      return { NULL: true }
  }
}

function assertStringValue(value: string | boolean | undefined): string {
  if (typeof value !== 'string') throw new Error('El valor del filtro no es válido.')
  return value
}

function assertNumber(value: string): void {
  if (!NUMBER_PATTERN.test(value)) throw new Error(`“${value}” no es un número válido de DynamoDB.`)
}

function decodeBase64(value: string): Uint8Array {
  const compact = value.trim()
  if (compact.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new Error('El valor binario debe estar codificado en Base64.')
  }
  return Buffer.from(compact, 'base64')
}

