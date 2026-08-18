import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

export function runServerCli(command, argv = process.argv.slice(2)) {
  const compiled = join(root, 'apps/server/dist/distribution/cli.js')
  if (existsSync(compiled)) {
    exitWith(
      spawnSync(process.execPath, [compiled, command, ...argv], {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
      }),
    )
  }

  const coreDist = join(root, 'packages/core/dist/index.js')
  if (!existsSync(coreDist)) {
    const built = spawnSync(
      'pnpm',
      ['--filter', '@sikumi-local/core', 'build'],
      {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
      },
    )
    if ((built.status ?? 1) !== 0) {
      process.exit(built.status ?? 1)
    }
  }

  const tsx = join(root, 'apps/server/node_modules/tsx/dist/cli.mjs')
  const entry = join(root, 'apps/server/src/distribution/cli.ts')
  if (!existsSync(tsx)) {
    console.error('tsx is not installed. Run pnpm install first.')
    process.exit(1)
  }
  exitWith(
    spawnSync(process.execPath, [tsx, entry, command, ...argv], {
      cwd: join(root, 'apps/server'),
      env: process.env,
      stdio: 'inherit',
    }),
  )
}

function exitWith(result) {
  process.exit(result.status ?? 1)
}
