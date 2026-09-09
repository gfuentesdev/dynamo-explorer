import { describe, expect, it } from 'vitest'
import { parseIniSections } from './profiles'

describe('AWS profile parser', () => {
  it('parses sections without exposing or interpreting values', () => {
    const sections = parseIniSections(`
      [default]
      region = us-east-1

      [profile development]
      sso_session = company
      region=us-west-2
    `)

    expect(sections).toEqual([
      { name: 'default', values: { region: 'us-east-1' } },
      { name: 'profile development', values: { sso_session: 'company', region: 'us-west-2' } },
    ])
  })
})

