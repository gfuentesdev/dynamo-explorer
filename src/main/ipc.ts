import type { IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { ConnectionContext, DeleteRequest, ExportCsvRequest, ExportCsvResult, ExploreRequest } from '../shared/types'
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
  ipcMain.handle('dynamodb:export-csv', secureHandler((request: ExportCsvRequest) => exportCsv(request)))
}

async function exportCsv(request: ExportCsvRequest): Promise<ExportCsvResult> {
  if (!request || typeof request.tableName !== 'string' || !/^[A-Za-z0-9_.-]{3,255}$/.test(request.tableName)) {
    throw new Error('Nombre de tabla no válido.')
  }
  if (typeof request.contents !== 'string' || Buffer.byteLength(request.contents, 'utf8') > 50 * 1024 * 1024) {
    throw new Error('El archivo CSV no es válido o supera el límite de 50 MB.')
  }

  const response = await dialog.showSaveDialog({
    defaultPath: `${request.tableName}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (response.canceled || !response.filePath) return { saved: false }

  await writeFile(response.filePath, request.contents, 'utf8')
  return { saved: true, filePath: response.filePath }
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
  const candidate = error as { name?: string; message?: string; code?: string }
  const name = candidate?.name ?? ''
  if (candidate?.code === 'ECONNREFUSED' || candidate?.code === 'ENOTFOUND') {
    return 'No fue posible conectar con el endpoint de DynamoDB.'
  }
  if (candidate?.code === 'EACCES' || candidate?.code === 'EPERM' || candidate?.code === 'ENOSPC') {
    return 'No fue posible guardar el archivo CSV en la ubicación seleccionada.'
  }
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

