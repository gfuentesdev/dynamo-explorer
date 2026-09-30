// Creates sample tables in DynamoDB Local so the app can be tried without an AWS account.
// Usage: npm run local:seed  (DynamoDB Local must be listening on AWS_ENDPOINT_URL_DYNAMODB or http://localhost:8000)
import {
  BatchWriteItemCommand,
  CreateTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb'

const endpoint = process.env.AWS_ENDPOINT_URL_DYNAMODB || 'http://localhost:8000'
const client = new DynamoDBClient({
  endpoint,
  region: 'us-east-1',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})

const tables = [
  {
    TableName: 'Orders',
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'customerId', AttributeType: 'S' },
      { AttributeName: 'orderId', AttributeType: 'S' },
      { AttributeName: 'status', AttributeType: 'S' },
      { AttributeName: 'createdAt', AttributeType: 'S' },
      { AttributeName: 'total', AttributeType: 'N' },
    ],
    KeySchema: [
      { AttributeName: 'customerId', KeyType: 'HASH' },
      { AttributeName: 'orderId', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'StatusIndex',
        KeySchema: [
          { AttributeName: 'status', KeyType: 'HASH' },
          { AttributeName: 'createdAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    LocalSecondaryIndexes: [
      {
        IndexName: 'TotalIndex',
        KeySchema: [
          { AttributeName: 'customerId', KeyType: 'HASH' },
          { AttributeName: 'total', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: 'Products',
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'productId', AttributeType: 'N' }],
    KeySchema: [{ AttributeName: 'productId', KeyType: 'HASH' }],
  },
]

const products = [
  { id: 1, name: 'Mechanical keyboard', category: 'peripherals', price: '89.90', stock: 42, tags: ['usb-c', 'rgb'] },
  { id: 2, name: 'Wireless mouse', category: 'peripherals', price: '34.50', stock: 0, tags: ['bluetooth'] },
  { id: 3, name: '27" monitor', category: 'displays', price: '259.00', stock: 7, tags: ['4k', 'ips'] },
  { id: 4, name: 'USB-C hub', category: 'accessories', price: '45.00', stock: 120, tags: ['usb-c', 'hdmi'] },
  { id: 5, name: 'Laptop stand', category: 'accessories', price: '51.25', stock: 18, tags: ['aluminum'] },
  { id: 6, name: 'Noise-cancelling headphones', category: 'audio', price: '199.99', stock: 5, tags: ['bluetooth', 'anc'] },
]

const customers = ['CUST#alice', 'CUST#bruno', 'CUST#carmen', 'CUST#diego', 'CUST#elena', 'CUST#farah']
const statuses = ['PENDING', 'SHIPPED', 'DELIVERED', 'CANCELLED']
const cities = ['Monterrey', 'Guadalajara', 'Madrid', 'Bogotá', 'Santiago', 'Lima']

function productItem(product) {
  return {
    productId: { N: String(product.id) },
    name: { S: product.name },
    category: { S: product.category },
    price: { N: product.price },
    stock: { N: String(product.stock) },
    available: { BOOL: product.stock > 0 },
    tags: { SS: product.tags },
  }
}

function orderItem(index) {
  const customerId = customers[index % customers.length]
  const status = statuses[index % statuses.length]
  const lines = products.filter((_, position) => (index + position) % 3 === 0).slice(0, 3)
  const total = lines.reduce((sum, product) => sum + Number(product.price), 0).toFixed(2)
  const createdAt = new Date(Date.UTC(2026, 0, 1 + index * 3, 9 + (index % 8))).toISOString()

  return {
    customerId: { S: customerId },
    orderId: { S: `ORDER#${String(1000 + index)}` },
    status: { S: status },
    createdAt: { S: createdAt },
    total: { N: total },
    itemCount: { N: String(lines.length) },
    gift: { BOOL: index % 5 === 0 },
    notes: index % 4 === 0 ? { NULL: true } : { S: `Order ${index + 1} for ${customerId.slice(5)}` },
    shipping: {
      M: {
        city: { S: cities[index % cities.length] },
        express: { BOOL: index % 2 === 0 },
        address: { M: { line1: { S: `${100 + index} Main St` }, zip: { S: String(64000 + index) } } },
      },
    },
    lines: {
      L: lines.map((product) => ({
        M: { productId: { N: String(product.id) }, name: { S: product.name }, price: { N: product.price } },
      })),
    },
    ratings: { NS: [String(1 + (index % 5)), String(1 + ((index + 2) % 5))] },
  }
}

async function writeAll(tableName, items) {
  for (let start = 0; start < items.length; start += 25) {
    const requests = items.slice(start, start + 25).map((Item) => ({ PutRequest: { Item } }))
    let pending = { [tableName]: requests }
    while (pending && Object.keys(pending).length > 0) {
      const response = await client.send(new BatchWriteItemCommand({ RequestItems: pending }))
      pending = response.UnprocessedItems
    }
  }
}

async function main() {
  let existing
  try {
    existing = new Set((await client.send(new ListTablesCommand({}))).TableNames ?? [])
  } catch (error) {
    console.error(`Could not reach DynamoDB Local at ${endpoint}. Is it running? (npm run local:db)`)
    console.error(error.message || error.code || error.name)
    process.exit(1)
  }

  for (const definition of tables) {
    if (existing.has(definition.TableName)) {
      console.log(`• ${definition.TableName} already exists, refreshing its items`)
      continue
    }
    await client.send(new CreateTableCommand(definition))
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: definition.TableName })
    console.log(`• Created ${definition.TableName}`)
  }

  await writeAll('Products', products.map(productItem))
  await writeAll('Orders', Array.from({ length: 60 }, (_, index) => orderItem(index)))
  console.log(`✓ Seeded ${products.length} products and 60 orders at ${endpoint}`)
}

await main()
