import { describe, expect, it } from 'vitest'
import { dynamoItemsToCsv } from './csv'

describe('dynamoItemsToCsv', () => {
  it('exports scalar and complex values with RFC-compatible escaping', () => {
    const csv = dynamoItemsToCsv([
      {
        id: { type: 'number', value: '42' },
        name: { type: 'string', value: 'Ada, "Lovelace"' },
        active: { type: 'boolean', value: true },
        metadata: { type: 'map', value: { role: { type: 'string', value: 'admin' } } },
      },
    ], ['id', 'name', 'active', 'metadata'])

    expect(csv).toBe('\uFEFFid,name,active,metadata\r\n42,"Ada, ""Lovelace""",true,"{""role"":""admin""}"')
  })

  it('protects string values that spreadsheet apps could execute as formulas', () => {
    const csv = dynamoItemsToCsv([
      { id: { type: 'string', value: '=HYPERLINK("https://example.test")' } },
    ], ['id'])

    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")"')
  })

  it('preserves negative DynamoDB numbers as numeric values', () => {
    const csv = dynamoItemsToCsv([
      { amount: { type: 'number', value: '-42.5' } },
    ], ['amount'])

    expect(csv).toBe('\uFEFFamount\r\n-42.5')
  })
})
