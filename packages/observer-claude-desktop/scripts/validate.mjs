#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundler = join(root, 'dist/mcpb.js')
if (!existsSync(bundler)) {
  process.stderr.write(
    'dist/mcpb.js is missing. Build @sikumi-local/observer-claude-desktop before validating.\n',
  )
  process.exit(1)
}

const {
  claudeDesktopManifestPath,
  runOfficialMcpbValidate,
  writeExtensionSources,
} = await import(pathToFileURL(bundler).href)

const errors = []
const sourceManifest = claudeDesktopManifestPath()
const source = runOfficialMcpbValidate(sourceManifest)
if (!source.ok) {
  errors.push(`source manifest: ${source.output || 'official mcpb validate failed'}`)
}

const staging = mkdtempSync(join(tmpdir(), 'sikumi-mcpb-validate-'))
try {
  writeExtensionSources(staging)
  const staged = runOfficialMcpbValidate(join(staging, 'manifest.json'))
  if (!staged.ok) {
    errors.push(
      `staged manifest: ${staged.output || 'official mcpb validate failed'}`,
    )
  }
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error))
} finally {
  rmSync(staging, { recursive: true, force: true })
}

if (errors.length > 0) {
  process.stderr.write(`${errors.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`ok ${sourceManifest}\n`)
