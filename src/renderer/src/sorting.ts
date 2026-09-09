import type { DynamoItem, DynamoValue } from '../../shared/types'

export type SortDirection = 'ascending' | 'descending'

export function sortDynamoItems(
  items: DynamoItem[],
  column: string,
  direction: SortDirection,
): DynamoItem[] {
  if (!column) return items
  const values = items.map((item) => item[column]).filter((value): value is DynamoValue => Boolean(value))
  const compareAsDates = values.length > 0 && values.every((value) => value.type === 'string' && isIsoDate(value.value))
  const multiplier = direction === 'ascending' ? 1 : -1

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftValue = left.item[column]
      const rightValue = right.item[column]
      if (!leftValue || leftValue.type === 'null') return !rightValue || rightValue.type === 'null' ? left.index - right.index : 1
      if (!rightValue || rightValue.type === 'null') return -1
      const comparison = compareDynamoValues(leftValue, rightValue, compareAsDates)
      return comparison === 0 ? left.index - right.index : comparison * multiplier
    })
    .map(({ item }) => item)
}

export function compareDecimalStrings(left: string, right: string): number {
  const a = normalizeDecimal(left)
  const b = normalizeDecimal(right)
  if (!a || !b) return left.localeCompare(right, 'es', { numeric: true })
  if (a.sign !== b.sign) return a.sign < b.sign ? -1 : 1
  if (a.sign === 0) return 0

  const highestA = a.digits.length + a.exponent
  const highestB = b.digits.length + b.exponent
  let magnitude = highestA === highestB ? 0 : highestA < highestB ? -1 : 1
  if (magnitude === 0) {
    const width = Math.max(a.digits.length, b.digits.length)
    const paddedA = a.digits.padEnd(width, '0')
    const paddedB = b.digits.padEnd(width, '0')
    magnitude = paddedA === paddedB ? 0 : paddedA < paddedB ? -1 : 1
  }
  return a.sign < 0 ? -magnitude : magnitude
}

function compareDynamoValues(left: DynamoValue, right: DynamoValue, compareAsDates: boolean): number {
  if (left.type === 'number' && right.type === 'number') return compareDecimalStrings(left.value, right.value)
  if (left.type === 'string' && right.type === 'string') {
    if (compareAsDates) return Date.parse(left.value) - Date.parse(right.value)
    return left.value.localeCompare(right.value, 'es', { numeric: true, sensitivity: 'base' })
  }
  if (left.type === 'boolean' && right.type === 'boolean') return Number(left.value) - Number(right.value)
  if (left.type === 'binary' && right.type === 'binary') return left.value.localeCompare(right.value)
  if (left.type !== right.type) return left.type.localeCompare(right.type)
  return JSON.stringify(left).localeCompare(JSON.stringify(right), 'es', { numeric: true, sensitivity: 'base' })
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(value) && Number.isFinite(Date.parse(value))
}

function normalizeDecimal(value: string): { sign: -1 | 0 | 1; digits: string; exponent: number } | undefined {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim())
  if (!match) return undefined
  const fraction = match[3] ?? ''
  let digits = `${match[2]}${fraction}`.replace(/^0+/, '')
  if (!digits) return { sign: 0, digits: '0', exponent: 0 }

  let exponent = Number(match[4] ?? 0) - fraction.length
  while (digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    exponent += 1
  }
  return { sign: match[1] === '-' ? -1 : 1, digits, exponent }
}
