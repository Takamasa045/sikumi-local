process.argv.splice(2, 0, '--protocol-variant', 'malformed')
await import('./fake-claude.mjs')
