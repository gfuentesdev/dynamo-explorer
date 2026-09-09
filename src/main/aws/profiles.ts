import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AwsProfile } from '../../shared/types'

interface ParsedSection {
  name: string
  values: Record<string, string>
}

export async function listAwsProfiles(): Promise<AwsProfile[]> {
  const configPath = process.env.AWS_CONFIG_FILE || join(homedir(), '.aws', 'config')
  const credentialsPath = process.env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), '.aws', 'credentials')
  const [config, credentials] = await Promise.all([readOptional(configPath), readOptional(credentialsPath)])

  const configProfiles = new Map(
    parseIniSections(config)
      .filter((section) => section.name === 'default' || section.name.startsWith('profile '))
      .map((section) => [section.name.replace(/^profile\s+/, ''), section.values]),
  )
  const credentialProfiles = new Map(
    parseIniSections(credentials).map((section) => [section.name, section.values]),
  )
  const profileNames = [...new Set([...configProfiles.keys(), ...credentialProfiles.keys()])].sort((a, b) =>
    a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b),
  )

  return profileNames.map((name) => {
    const configValues = configProfiles.get(name)
    const inConfig = configProfiles.has(name)
    const inCredentials = credentialProfiles.has(name)
    return {
      name,
      region: configValues?.region,
      source: inConfig && inCredentials ? 'both' : inConfig ? 'config' : 'credentials',
      isSso: Boolean(configValues?.sso_session || configValues?.sso_start_url),
    }
  })
}

export function parseIniSections(content: string): ParsedSection[] {
  const sections: ParsedSection[] = []
  let current: ParsedSection | undefined

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue
    const sectionMatch = /^\[([^\]]+)]$/.exec(line)
    if (sectionMatch) {
      current = { name: sectionMatch[1].trim(), values: {} }
      sections.push(current)
      continue
    }
    const assignmentMatch = /^([^=]+?)\s*=\s*(.*)$/.exec(line)
    if (current && assignmentMatch) current.values[assignmentMatch[1].trim()] = assignmentMatch[2].trim()
  }
  return sections
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

