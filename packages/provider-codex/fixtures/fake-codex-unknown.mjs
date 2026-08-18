process.argv.splice(2, 0, '--protocol-variant', 'unknown')
await import('./fake-codex.mjs')
