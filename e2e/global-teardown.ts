import { rmSync } from 'node:fs'
import { isSafeOwnedTempDirectory, readOwnedDirectories } from './owned-temp'

export default async function globalTeardown(): Promise<void> {
  for (const directory of readOwnedDirectories()) {
    rmSync(directory, { recursive: true, force: true })
  }
  const dataDirectory = process.env.SIKUMI_E2E_DATA_DIR
  if (dataDirectory && isSafeOwnedTempDirectory(dataDirectory)) {
    rmSync(dataDirectory, { recursive: true, force: true })
  }
}
