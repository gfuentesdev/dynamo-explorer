import { describe, expect, it } from 'vitest'
import type { ExploreRequest, IndexDefinition } from '../../shared/types'
import { buildExploreExpressions, parseDocumentPath } from './expressions'

const index: IndexDefinition = {
  name: 'Tabla principal',
  kind: 'TABLE',
  partitionKey: { name: 'PK', type: 'S' },
  sortKey: { name: 'SK', type: 'S' },
}

const request: ExploreRequest = {
  profile: 'default',
  region: 'us-east-1',
  tableName: 'ExampleTable',
  mode: 'query',
  partitionKeyValue: { type: 'string', value: 'USER#1' },
  sortKeyCondition: { operator: 'beginsWith', value: { type: 'string', value: 'ORDER#' } },
  filters: [{ path: 'profile.addresses[0].country', operator: 'eq', valueType: 'string', value: 'MX' }],
  limit: 50,
}

describe('DynamoDB expression builder', () => {
  it('aliases every attribute and value', () => {
    const built = buildExploreExpressions(request, index)

    expect(built.KeyConditionExpression).toBe('#n0 = :v0 AND begins_with(#n1, :v1)')
    expect(built.FilterExpression).toBe('#n2.#n3[0].#n4 = :v2')
    expect(built.ExpressionAttributeNames).toEqual({
      '#n0': 'PK', '#n1': 'SK', '#n2': 'profile', '#n3': 'addresses', '#n4': 'country',
    })
    expect(built.ExpressionAttributeValues).toEqual({
      ':v0': { S: 'USER#1' }, ':v1': { S: 'ORDER#' }, ':v2': { S: 'MX' },
    })
  })

  it('does not allow key attributes in a Query filter', () => {
    expect(() => buildExploreExpressions({ ...request, filters: [{ path: 'PK', operator: 'eq', valueType: 'string', value: 'x' }] }, index)).toThrow(
      'es una clave del Query',
    )
  })

  it('parses document paths without interpolating attribute names', () => {
    expect(parseDocumentPath('orders[12].shipping address.city')).toEqual([
      { name: 'orders', indexes: [12] },
      { name: 'shipping address', indexes: [] },
      { name: 'city', indexes: [] },
    ])
  })
})

