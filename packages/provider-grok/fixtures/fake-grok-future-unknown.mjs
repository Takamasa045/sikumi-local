process.argv.splice(2, 0, '--protocol-variant', 'future-unknown')
await import('./fake-grok.mjs')
