/// <reference types="vite/client" />

import type { DynamoExplorerApi } from '../../shared/types'

declare global {
  interface Window {
    dynamoExplorer: DynamoExplorerApi
  }
}

export {}

