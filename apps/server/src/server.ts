import { mkdirSync } from 'node:fs'
import { z } from 'zod'
import { buildApp } from './app.js'
import { resolveDataDirectory } from './storage/data-directory.js'

const environmentSchema = z.object({
  SIKUMI_LOCAL_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  SIKUMI_LOCAL_PORT: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65_535)
    .default(4321),
})

const environment = environmentSchema.parse(process.env)
const dataDirectory = resolveDataDirectory()
mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
const app = buildApp({ dataDirectory })

try {
  await app.listen({
    host: environment.SIKUMI_LOCAL_HOST,
    port: environment.SIKUMI_LOCAL_PORT,
  })
  console.log(
    `Shikumi Local server: http://${environment.SIKUMI_LOCAL_HOST}:${environment.SIKUMI_LOCAL_PORT}`,
  )
  console.log(`Data directory: ${dataDirectory}`)
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
