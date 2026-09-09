import { describe, expect, it } from 'vitest'
import type { DynamoItem } from '../../shared/types'
import { compareDecimalStrings, sortDynamoItems } from './sorting'

describe('result sorting', () => {
  it('sorts ISO dates in both directions and leaves missing values last', () => {
    const items: DynamoItem[] = [
      { id: { type: 'string', value: 'missing' } },
      { createdAt: { type: 'string', value: '2026-09-09T12:00:00Z' } },
      { createdAt: { type: 'string', value: '2025-01-01T00:00:00Z' } },
    ]

    expect(sortDynamoItems(items, 'createdAt', 'ascending')[0].createdAt).toEqual({ type: 'string', value: '2025-01-01T00:00:00Z' })
    expect(sortDynamoItems(items, 'createdAt', 'descending')[0].createdAt).toEqual({ type: 'string', value: '2026-09-09T12:00:00Z' })
    expect(sortDynamoItems(items, 'createdAt', 'descending').at(-1)?.createdAt).toBeUndefined()
  })

  it('compares DynamoDB numbers without losing precision', () => {
    expect(compareDecimalStrings('9007199254740993', '9007199254740992')).toBeGreaterThan(0)
    expect(compareDecimalStrings('-1.20', '-1.19')).toBeLessThan(0)
    expect(compareDecimalStrings('1e3', '999.99')).toBeGreaterThan(0)
    expect(compareDecimalStrings('1.200', '1.2')).toBe(0)
  })

  it('sorts ordinary text naturally', () => {
    const items: DynamoItem[] = [
      { name: { type: 'string', value: 'item 10' } },
      { name: { type: 'string', value: 'Item 2' } },
    ]
    expect(sortDynamoItems(items, 'name', 'ascending')[0].name).toEqual({ type: 'string', value: 'Item 2' })
  })
})
