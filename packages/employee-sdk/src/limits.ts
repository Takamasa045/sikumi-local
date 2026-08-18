export const EMPLOYEE_PACK_SCHEMA_VERSION = 1
export const MAX_PACK_DEPTH = 4
export const MAX_PACK_FILES = 64
export const MAX_PACK_FILE_BYTES = 256 * 1024
export const MAX_PACK_TOTAL_BYTES = 1024 * 1024
export const MAX_PACK_PATH_LENGTH = 4096

export const FORBIDDEN_PACK_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.sh',
  '.bash',
  '.zsh',
  '.exe',
  '.bin',
  '.dll',
  '.so',
  '.dylib',
  '.bat',
  '.cmd',
  '.ps1',
  '.wasm',
])

export const FORBIDDEN_PACK_NAMES = new Set([
  'package.json',
  'postinstall',
  'preinstall',
])
