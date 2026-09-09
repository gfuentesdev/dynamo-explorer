import type { IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import type { ConnectionContext, DeleteRequest, ExploreRequest } from '../shared/types'
import { deleteItem, describeTable, explore, listTables } from './aws/dynamodb-service'
import { listAwsProfiles } from './aws/profiles'

export function registerIpcHandlers(): void {
  ipcMain.handle('aws:list-profiles', secureHandler(() => listAwsProfiles()))
  ipcMain.handle('dynamodb:list-tables', secureHandler((request: ConnectionContext) => listTables(request)))
  ipcMain.handle(
    'dynamodb:describe-table',
    secureHandler((request: ConnectionContext & { tableName: string }) => describeTable(request)),
  )
  ipcMain.handle('dynamodb:explore', secureHandler((request: ExploreRequest) => explore(request)))
  ipcMain.handle('dynamodb:delete-item', secureHandler((request: DeleteRequest) => deleteItem(request)))
}

function secureHandler<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult | Promise<TResult>,
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> {
  return async (event, ...args) => {
    assertTrustedSender(event)
    try {
      return await handler(...args)
    } catch (error) {
      throw new Error(toSafeErrorMessage(error))
    }
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const trusted = url.startsWith('file://') || (developmentUrl ? url.startsWith(developmentUrl) : false)
  if (!trusted) throw new Error('Origen IPC no autorizado.')
}

function toSafeErrorMessage(error: unknown): string {
  const candidate = error as { name?: string; message?: string }
  const name = candidate?.name ?? ''
  if (name === 'ExpiredTokenException' || /token.*expired|session.*expired/i.test(candidate?.message ?? '')) {
    return 'La sesión AWS expiró. Renueva el acceso SSO y vuelve a intentar.'
  }
  if (name === 'AccessDeniedException' || /not authorized|access denied/i.test(candidate?.message ?? '')) {
    return 'El perfil no tiene permisos para realizar esta operación.'
  }
  if (name === 'ResourceNotFoundException') return 'La tabla o el índice ya no existe.'
  if (name === 'ProvisionedThroughputExceededException' || name === 'ThrottlingException') {
    return 'DynamoDB limitó temporalmente la operación. Espera un momento y vuelve a intentar.'
  }
  if (candidate instanceof Error && candidate.message) return candidate.message.slice(0, 500)
  return 'No fue posible completar la operación con DynamoDB.'
}

