import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionContext,
  DeleteRequest,
  DynamoExplorerApi,
  ExploreRequest,
} from '../shared/types'

const api: DynamoExplorerApi = {
  listProfiles: () => ipcRenderer.invoke('aws:list-profiles'),
  listTables: (connection: ConnectionContext) => ipcRenderer.invoke('dynamodb:list-tables', connection),
  describeTable: (request: ConnectionContext & { tableName: string }) =>
    ipcRenderer.invoke('dynamodb:describe-table', request),
  explore: (request: ExploreRequest) => ipcRenderer.invoke('dynamodb:explore', request),
  deleteItem: (request: DeleteRequest) => ipcRenderer.invoke('dynamodb:delete-item', request),
}

contextBridge.exposeInMainWorld('dynamoExplorer', api)
