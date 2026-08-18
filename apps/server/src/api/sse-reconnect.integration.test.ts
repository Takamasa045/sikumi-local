import { get as httpGet, type IncomingMessage } from 'node:http'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { SESSION_COOKIE_NAME } from '../security/http-guard.js'
import { buildApp } from '../app.js'
import {
  SSE_REPLAY_LIMIT,
  activeSseConnectionCount,
  assertSseCursorOwnedByJob,
} from '../jobs/sse.js'
import {
  createTemporaryDirectory,
  createTemporaryGitRepository,
} from '../test/git-fixture.js'
import { injectAuthed, obtainSession } from '../test/http.js'

const apps: Array<ReturnType<typeof buildApp>> = []
const tempDirectories: string[] = []
const streams: SseClient[] = []

afterEach(async () => {
  for (const stream of streams.splice(0)) {
    stream.destroy()
  }
  await Promise.all(apps.splice(0).map((app) => app.close()))
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SSE reconnect integration', () => {
  it('replays only events after the owned cursor and rejects a foreign job cursor', async () => {
    const { port, workspaceId } = await listenApp()
    const firstJob = await createResearchJob(workspaceId)
    const firstId = firstJob.json().job.id as string
    const secondJob = await createResearchJob(workspaceId)
    const secondId = secondJob.json().job.id as string
    const session = await obtainSession(lastApp())

    const first = await readSseUntil(
      port,
      `/api/jobs/${firstId}/events`,
      session.token,
      'run.started',
    )
    expect(first.ids.length).toBeGreaterThan(0)
    const cursor = first.ids[0]!

    const replay = await readSse(
      port,
      `/api/jobs/${firstId}/events`,
      session.token,
      cursor,
    )
    expect(replay.ids).not.toContain(cursor)

    const foreign = await readSseStatus(
      port,
      `/api/jobs/${secondId}/events`,
      session.token,
      cursor,
    )
    expect(foreign).toBe(400)

    expect(() =>
      assertSseCursorOwnedByJob(cursor, secondId, (id) =>
        id === cursor ? { jobId: firstId } : undefined,
      ),
    ).toThrow(/Cursor/)
  })

  it('reconnects a live job stream, then cleans up the listener', async () => {
    const { port, workspaceId } = await listenApp()
    const hanging = await injectAuthed(lastApp(), {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId, request: '[hang]待って' },
    })
    const jobId = hanging.json().job.id as string
    const session = await obtainSession(lastApp())

    const first = openSse(port, `/api/jobs/${jobId}/events`, session.token)
    await first.waitFor(': connected')
    expect(activeSseConnectionCount()).toBe(1)
    const firstIds = [...first.body.matchAll(/^id: (.+)$/gm)].map(
      (match) => match[1] ?? '',
    )
    first.destroy()
    await waitUntil(() => activeSseConnectionCount() === 0)

    const second = openSse(
      port,
      `/api/jobs/${jobId}/events`,
      session.token,
      firstIds[0],
    )
    await second.waitFor(': connected')
    expect(activeSseConnectionCount()).toBe(1)
    expect(second.body).not.toContain(`id: ${firstIds[0]}`)

    const cancelled = await injectAuthed(lastApp(), {
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
    })
    expect(cancelled.json().job.status).toBe('cancelled')
    await second.waitFor('run.cancelled')
    second.destroy()
    await waitUntil(() => activeSseConnectionCount() === 0)
  })

  it('bounds replay to the last window even when the store has more events', async () => {
    const { port, workspaceId, dataDirectory } = await listenApp()
    const created = await createResearchJob(workspaceId)
    const jobId = created.json().job.id as string
    seedExtraEvents(dataDirectory, jobId, SSE_REPLAY_LIMIT + 25)
    const session = await obtainSession(lastApp())
    const replay = await readSse(
      port,
      `/api/jobs/${jobId}/events`,
      session.token,
    )
    expect(replay.ids.length).toBeLessThanOrEqual(SSE_REPLAY_LIMIT)
  })
})

async function listenApp() {
  const dataDirectory = track(createTemporaryDirectory())
  const repositoryPath = track(createTemporaryGitRepository())
  const app = buildApp({
    dataDirectory,
    enableFakeProvider: true,
  })
  apps.push(app)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  if (!address || typeof address === 'string') {
    throw new Error('expected a TCP address')
  }
  const workspaceId = (
    await injectAuthed(app, {
      method: 'POST',
      url: '/api/workspaces',
      payload: { path: repositoryPath },
    })
  ).json().workspace.id as string
  return { port: address.port, workspaceId, dataDirectory }
}

function lastApp() {
  const app = apps.at(-1)
  if (!app) {
    throw new Error('expected an app')
  }
  return app
}

function createResearchJob(workspaceId: string) {
  return injectAuthed(lastApp(), {
    method: 'POST',
    url: '/api/jobs',
    payload: { workspaceId, request: '構成を調べて' },
  })
}

function seedExtraEvents(
  dataDirectory: string,
  jobId: string,
  count: number,
): void {
  const sqlite = new Database(`${dataDirectory}/database.sqlite`)
  try {
    const insert = sqlite.prepare(
      `INSERT INTO events (id, job_id, run_id, type, payload, occurred_at)
       VALUES (?, ?, null, 'run.state_changed', ?, ?)`,
    )
    const tx = sqlite.transaction(() => {
      for (let index = 0; index < count; index += 1) {
        insert.run(
          `seed_${index.toString().padStart(4, '0')}`,
          jobId,
          JSON.stringify({ summary: `seed-${index}` }),
          `t-${index.toString().padStart(4, '0')}`,
        )
      }
    })
    tx()
  } finally {
    sqlite.close()
  }
}

interface SseClient {
  readonly body: string
  waitFor(text: string): Promise<void>
  destroy(): void
}

function openSse(
  port: number,
  path: string,
  token: string,
  lastEventId?: string,
): SseClient {
  let body = ''
  const waiters = new Set<{
    text: string
    resolve: () => void
    timer: ReturnType<typeof setTimeout>
  }>()
  const request = httpGet(
    {
      host: '127.0.0.1',
      port,
      path,
      headers: sseHeaders(token, lastEventId),
    },
    (response: IncomingMessage) => {
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
        for (const waiter of [...waiters]) {
          if (body.includes(waiter.text)) {
            clearTimeout(waiter.timer)
            waiters.delete(waiter)
            waiter.resolve()
          }
        }
      })
    },
  )
  request.on('error', () => {
    // Client destroy is an expected disconnect.
  })
  const client: SseClient = {
    get body() {
      return body
    },
    waitFor(text) {
      if (body.includes(text)) {
        return Promise.resolve()
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(waiter)
          reject(new Error(`SSE timed out waiting for ${text} on ${path}`))
        }, 5_000)
        const waiter = { text, resolve, timer }
        waiters.add(waiter)
      })
    },
    destroy() {
      request.destroy()
    },
  }
  streams.push(client)
  return client
}

function sseHeaders(token: string, lastEventId?: string) {
  return {
    host: '127.0.0.1',
    accept: 'text/event-stream',
    cookie: `${SESSION_COOKIE_NAME}=${token}`,
    origin: 'http://127.0.0.1:5184',
    ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
  }
}

function readSseUntil(
  port: number,
  path: string,
  token: string,
  text: string,
  lastEventId?: string,
): Promise<{ body: string; ids: string[] }> {
  const stream = openSse(port, path, token, lastEventId)
  return stream.waitFor(text).then(() => {
    stream.destroy()
    return {
      body: stream.body,
      ids: [...stream.body.matchAll(/^id: (.+)$/gm)].map(
        (match) => match[1] ?? '',
      ),
    }
  })
}

function readSse(
  port: number,
  path: string,
  token: string,
  lastEventId?: string,
): Promise<{ body: string; ids: string[] }> {
  return new Promise((resolve, reject) => {
    const request = httpGet(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: sseHeaders(token, lastEventId),
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          body += chunk
          const ids = [...body.matchAll(/^id: (.+)$/gm)].map(
            (match) => match[1] ?? '',
          )
          const connected = body.includes(': connected')
          const hasReplay = ids.length > 0 || body.includes('run.started')
          if (connected && (lastEventId || hasReplay)) {
            request.destroy()
            resolve({ body, ids })
          }
        })
        response.on('error', reject)
      },
    )
    request.on('error', () => {
      // Destroy after replay is expected.
    })
    setTimeout(() => {
      request.destroy()
      reject(new Error(`SSE timed out for ${path}`))
    }, 4_000)
  })
}

function readSseStatus(
  port: number,
  path: string,
  token?: string,
  lastEventId?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpGet(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: token
          ? sseHeaders(token, lastEventId)
          : {
              host: '127.0.0.1',
              accept: 'text/event-stream',
            },
      },
      (response) => {
        resolve(response.statusCode ?? 0)
        request.destroy()
      },
    )
    request.on('error', reject)
  })
}

async function waitUntil(ok: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (ok()) {
      return
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
  }
  throw new Error('timed out waiting for SSE cleanup')
}

function track(directory: string): string {
  tempDirectories.push(directory)
  return directory
}
