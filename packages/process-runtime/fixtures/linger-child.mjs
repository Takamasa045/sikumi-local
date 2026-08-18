import { writeFileSync } from 'node:fs'

const pidFile = process.argv[2]
if (!pidFile) {
  process.exit(2)
}

writeFileSync(pidFile, String(process.pid))

const timer = setInterval(() => {
  // Stay alive until the process group is signalled.
}, 1000)

process.on('SIGTERM', () => {
  clearInterval(timer)
  process.exit(143)
})
