// Starts the app in development mode against DynamoDB Local, using the dummy profile in this folder
// instead of ~/.aws. Works the same on macOS, Linux, and Windows.
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const folder = dirname(fileURLToPath(import.meta.url))
const env = {
  ...process.env,
  AWS_ENDPOINT_URL_DYNAMODB: process.env.AWS_ENDPOINT_URL_DYNAMODB || 'http://localhost:8000',
  AWS_CONFIG_FILE: join(folder, 'aws-config'),
  AWS_SHARED_CREDENTIALS_FILE: join(folder, 'aws-credentials'),
}

const child = spawn('npm run dev', { env, stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
