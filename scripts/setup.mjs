import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const dataDirectory =
  process.env.SIKUMI_LOCAL_DATA_DIR ?? join(homedir(), '.shikumi-local')

await mkdir(dataDirectory, { recursive: true, mode: 0o700 })

console.log('Shikumi Local setup complete')
console.log(`Data directory: ${dataDirectory}`)
console.log('Next: pnpm start')
