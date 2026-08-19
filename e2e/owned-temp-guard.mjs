import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

export const OWNED_E2E_TEMP_PREFIXES = [
  'sikumi-e2e-',
  'sikumi-local-e2e-',
]

export function isSafeOwnedTempDirectory(directory) {
  if (typeof directory !== 'string' || directory.length === 0) {
    return false
  }
  if (!isAbsolute(directory) || directory.includes('\0')) {
    return false
  }

  let tmpRoot
  try {
    tmpRoot = realpathSync(tmpdir())
  } catch {
    return false
  }
  const lexicalTmp = resolve(tmpdir())

  let candidate
  try {
    candidate = existsSync(directory) ? realpathSync(directory) : resolve(directory)
  } catch {
    return false
  }
  const lexical = resolve(directory)

  if (!isInsideDirectory(lexical, lexicalTmp) && !isInsideDirectory(lexical, tmpRoot)) {
    return false
  }
  if (!isInsideDirectory(candidate, tmpRoot) && !isInsideDirectory(candidate, lexicalTmp)) {
    return false
  }

  const name = basename(candidate)
  return OWNED_E2E_TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function isInsideDirectory(target, root) {
  const relativePath = relative(root, target)
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== '..' &&
    !relativePath.includes(`${sep}..${sep}`)
  )
}
