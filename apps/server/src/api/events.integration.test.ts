import { get as httpGet, type IncomingMessage } from 'node:http'
import { readFileSync, rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_COOKIE_NAME } from '../security/http-guard.js'
import { buildApp } from '../app.js'
import { activeSseConnectionCount } from '../jobs/sse.js'
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

describe('SSE event streams', () => {
  it('replays from Last-Event-ID and does not mix another job', async () => {
    const { port, workspaceId } = await listenApp()
    const created = await createResearchJob(workspaceId)
    const jobId = created.json().job.id as string
    const session = await obtainSession(lastApp())
    const first = await readSse(
      port,
      `/api/jobs/${jobId}/events`,
      session.token,
    )
    expect(first.body).toContain('id: ')
    expect(first.body).toContain('run.started')
    expect(first.ids.length).toBeGreaterThan(0)
    expect(JSON.stringify(first.body)).not.toContain('reasoning')

    const replay = await readSse(
      port,
      `/api/jobs/${jobId}/events`,
      session.token,
      first.ids[0],
    )
    expect(replay.ids).not.toContain(first.ids[0])

    const globalStream = await readSse(port, '/api/events', session.token)
    expect(globalStream.body).toContain(jobId)

    const rejected = await readSseStatus(port, `/api/jobs/${jobId}/events`)
    expect(rejected).toBe(403)
  })

  it('delivers a later job on the same /api/events connection and cleans up', async () => {
    const { port, workspaceId, dataDirectory } = await listenApp()
    const session = await obtainSession(lastApp())
    const stream = openSse(port, '/api/events', session.token)
    await stream.waitFor(': connected')
    expect(activeSseConnectionCount()).toBe(1)

    const created = await createResearchJob(workspaceId)
    const jobId = created.json().job.id as string
    await stream.waitFor(jobId)
    await stream.waitFor('run.started')
    expect(stream.body).toContain('run.started')
    expect(stream.body).not.toContain('INTERNAL_REASONING_MUST_NOT_PERSIST')
    expect(
      readFileSync(`${dataDirectory}/database.sqlite`).includes(
        'INTERNAL_REASONING_MUST_NOT_PERSIST',
      ),
    ).toBe(false)

    stream.destroy()
    await waitUntil(() => activeSseConnectionCount() === 0)
  })

  it('delivers a later cancel on the same job SSE connection and cleans up', async () => {
    const { port, workspaceId } = await listenApp()
    const hanging = await injectAuthed(lastApp(), {
      method: 'POST',
      url: '/api/jobs',
      payload: { workspaceId, request: '[hang]待って' },
    })
    const jobId = hanging.json().job.id as string
    const session = await obtainSession(lastApp())
    const stream = openSse(port, `/api/jobs/${jobId}/events`, session.token)
    await stream.waitFor(': connected')
    expect(activeSseConnectionCount()).toBe(1)

    const cancelled = await injectAuthed(lastApp(), {
      method: 'POST',
      url: `/api/jobs/${jobId}/cancel`,
    })
    expect(cancelled.json().job.status).toBe('cancelled')
    await stream.waitFor('run.cancelled')

    stream.destroy()
    await waitUntil(() => activeSseConnectionCount() === 0)
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

interface SseClient {
  readonly body: string
  waitFor(text: string): Promise<void>
  destroy(): void
}

function openSse(port: number, path: string, token: string): SseClient {
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
      headers: sseHeaders(token),
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

function readSse(
  port: number,
  path: string,
  token: string,
  lastEventId?: string,
): Promise<{ body: string; ids: string[] }> {
  const stream = openSse(port, path, token)
  if (lastEventId) {
    stream.destroy()
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
            if (body.includes(': connected') || ids.length > 0) {
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
  return stream.waitFor('run.started').then(() => {
    stream.destroy()
    return {
      body: stream.body,
      ids: [...stream.body.matchAll(/^id: (.+)$/gm)].map(
        (match) => match[1] ?? '',
      ),
    }
  })
}

function readSseStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpGet(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: {
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
