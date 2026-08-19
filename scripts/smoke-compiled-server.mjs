import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const serverEntry = join(root, 'apps/server/dist/server.js')
const coreEntry = join(root, 'packages/core/dist/index.js')
const CHILD_EXIT_TIMEOUT_MS = 2_000

if (!existsSync(serverEntry) || !existsSync(coreEntry)) {
  console.error(
    'Compiled server smoke requires a prior pnpm build (missing dist files).',
  )
  process.exit(1)
}

const dataDirectory = mkdtempSync(join(tmpdir(), 'sikumi-smoke-'))
const port = await allocateEphemeralPort()
const base = `http://127.0.0.1:${port}`

const child = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: {
    ...process.env,
    SIKUMI_LOCAL_DATA_DIR: dataDirectory,
    SIKUMI_LOCAL_HOST: '127.0.0.1',
    SIKUMI_LOCAL_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => {
  output += String(chunk)
})
child.stderr.on('data', (chunk) => {
  output += String(chunk)
})

try {
  await waitForHealth(base)
  const health = await fetchJson(`${base}/api/health`)
  if (health.ok !== true || health.bind !== '127.0.0.1') {
    throw new Error(`Unexpected health contract: ${JSON.stringify(health)}`)
  }

  const today = await fetchJson(`${base}/api/observer/today`)
  if (!today.overview || typeof today.overview.repositoryCount !== 'number') {
    throw new Error(`Unexpected today contract: ${JSON.stringify(today)}`)
  }

  const adapters = await fetchJson(`${base}/api/observer/adapters`)
  if (!Array.isArray(adapters.adapters) || adapters.adapters.length < 5) {
    throw new Error(`Unexpected adapters contract: ${JSON.stringify(adapters)}`)
  }

  const conflicts = await fetchJson(`${base}/api/conflicts`)
  if (!Array.isArray(conflicts.conflicts) || !conflicts.counts) {
    throw new Error(
      `Unexpected conflicts contract: ${JSON.stringify(conflicts)}`,
    )
  }

  const sessionResponse = await fetch(`${base}/api/session`)
  const session = await sessionResponse.json()
  const setCookie = sessionResponse.headers.get('set-cookie') ?? ''
  if (!session.token || !setCookie.includes('HttpOnly')) {
    throw new Error('Compiled server did not issue a session cookie')
  }

  const unauthenticated = await fetch(`${base}/api/workspaces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5184',
    },
    body: JSON.stringify({ path: '/tmp/repo' }),
  })
  const unauthenticatedBody = await unauthenticated.json()
  if (
    unauthenticated.status !== 403 ||
    unauthenticatedBody.error?.code !== 'CSRF_REJECTED'
  ) {
    throw new Error('Compiled server accepted a write without a session token')
  }

  console.log('Compiled server smoke passed')
  console.log(`node ${serverEntry}`)
  console.log(`health: ${base}/api/health`)
} catch (error) {
  console.error('Compiled server smoke failed')
  console.error(error)
  if (output.trim()) {
    console.error(output)
  }
  process.exitCode = 1
} finally {
  await stopChild(child)
  rmSync(dataDirectory, { recursive: true, force: true })
}

async function allocateEphemeralPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  })

  const address = server.address()
  if (!address || typeof address === 'string' || address.port < 1024) {
    server.close()
    throw new Error('Failed to allocate a safe high port')
  }

  const port = address.port
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve(undefined)
    })
  })
  return port
}

async function stopChild(childProcess) {
  if (!hasExited(childProcess)) {
    childProcess.kill('SIGTERM')
    await waitForChildExit(childProcess, CHILD_EXIT_TIMEOUT_MS)
  }

  if (!hasExited(childProcess)) {
    childProcess.kill('SIGKILL')
    await waitForChildExit(childProcess, CHILD_EXIT_TIMEOUT_MS)
  }

  if (!hasExited(childProcess)) {
    console.error('Compiled server child did not exit after SIGKILL')
    process.exitCode = 1
  }
}

function hasExited(childProcess) {
  return childProcess.exitCode !== null || childProcess.signalCode !== null
}

function waitForChildExit(childProcess, timeoutMs) {
  if (hasExited(childProcess)) {
    return Promise.resolve(true)
  }

  return new Promise((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      childProcess.off('exit', onExit)
      resolve(hasExited(childProcess))
    }, timeoutMs)
    childProcess.once('exit', onExit)
    if (hasExited(childProcess)) {
      childProcess.off('exit', onExit)
      clearTimeout(timer)
      resolve(true)
    }
  })
}

async function waitForHealth(origin, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) {
        return
      }
    } catch {
      // The compiled process may still be binding.
    }
    await delay(100)
  }
  throw new Error('Compiled server did not become healthy')
}

async function fetchJson(url) {
  const response = await fetch(url)
  return response.json()
}
