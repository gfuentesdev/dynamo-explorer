import { describe, expect, it } from 'vitest'
import { createTranslator, localizeError } from './i18n'

describe('localization', () => {
  it('translates interface messages and interpolates values', () => {
    const english = createTranslator('en')
    const spanish = createTranslator('es')

    expect(english('estimatedRecords', { count: '1,000' })).toBe('1,000 estimated records')
    expect(spanish('estimatedRecords', { count: '1,000' })).toBe('1,000 registros estimados')
  })

  it('localizes known backend errors without exposing implementation details', () => {
    expect(localizeError('La sesión AWS expiró. Renueva el acceso SSO y vuelve a intentar.', 'en')).toBe(
      'The AWS session expired. Renew the SSO session and try again.',
    )
    expect(localizeError('La ruta “profile.name” no es válida.', 'en')).toBe('The path “profile.name” is invalid.')
  })

  it('keeps Spanish and unknown service messages unchanged', () => {
    expect(localizeError('Perfil AWS no válido.', 'es')).toBe('Perfil AWS no válido.')
    expect(localizeError('Network connection lost', 'en')).toBe('Network connection lost')
  })
})
