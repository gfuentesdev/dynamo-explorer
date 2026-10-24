import type { DynamoItem, DynamoValue } from '../../shared/types'

export function dynamoItemsToCsv(items: DynamoItem[], columns: string[]): string {
  const lines = [
    columns.map((column) => csvCell(protectSpreadsheetFormula(column))).join(','),
    ...items.map((item) => columns.map((column) => {
      const value = item[column]
      const serialized = csvValue(value)
      return csvCell(value?.type === 'string' ? protectSpreadsheetFormula(serialized) : serialized)
    }).join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}`
}

function csvValue(value?: DynamoValue): string {
  if (!value) return ''
  switch (value.type) {
    case 'null': return 'null'
    case 'string': return value.value
    case 'number': case 'binary': return value.value
    case 'boolean': return String(value.value)
    case 'stringSet': return JSON.stringify(value.value)
    case 'numberSet': case 'binarySet': return JSON.stringify(value.value)
    case 'list': return JSON.stringify(value.value.map(simpleDynamoValue))
    case 'map': return JSON.stringify(simpleDynamoItem(value.value))
  }
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function protectSpreadsheetFormula(value: string): string {
  return /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value
}

function simpleDynamoItem(item: DynamoItem): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).map(([name, value]) => [name, simpleDynamoValue(value)]))
}

function simpleDynamoValue(value: DynamoValue): unknown {
  switch (value.type) {
    case 'null': return null
    case 'string': return value.value
    case 'number': case 'boolean': case 'binary': return value.value
    case 'stringSet': return value.value
    case 'numberSet': case 'binarySet': return value.value
    case 'list': return value.value.map(simpleDynamoValue)
    case 'map': return simpleDynamoItem(value.value)
  }
}
