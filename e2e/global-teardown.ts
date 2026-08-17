import { rmSync } from 'node:fs'

export default async function globalTeardown(): Promise<void> {
  const dataDirectory = process.env.SIKUMI_E2E_DATA_DIR
  if (dataDirectory) {
    rmSync(dataDirectory, { recursive: true, force: true })
  }
}
