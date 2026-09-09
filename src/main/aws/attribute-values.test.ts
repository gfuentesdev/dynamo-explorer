import { describe, expect, it } from 'vitest'
import { attributeMapToDynamoItem, dynamoItemToAttributeMap, typedInputToAttributeValue } from './attribute-values'

describe('DynamoDB value conversion', () => {
  it('preserves arbitrary precision numbers and nested values', () => {
    const source = {
      id: { S: 'user#1' },
      balance: { N: '900719925474099312345.25' },
      active: { BOOL: true },
      metadata: { M: { tags: { SS: ['admin', 'beta'] }, removedAt: { NULL: true } } },
    }

    const serialized = attributeMapToDynamoItem(source)

    expect(serialized.balance).toEqual({ type: 'number', value: '900719925474099312345.25' })
    expect(dynamoItemToAttributeMap(serialized)).toEqual(source)
  })

  it('rejects malformed numeric input', () => {
    expect(() => typedInputToAttributeValue({ type: 'number', value: '12 dollars' })).toThrow(
      'no es un número válido',
    )
  })
})

