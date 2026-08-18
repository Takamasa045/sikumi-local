import {
  diagnoseProvider,
  redactDiagnosticText,
} from './lib/provider-diagnostics.mjs'

console.log('Shikumi Local live provider probe (read-only)')
console.log('This script does not start jobs or send prompts.')
console.log('')

for (const id of ['codex', 'grok', 'claude']) {
  const diagnosis = await diagnoseProvider(id)
  const title =
    id === 'codex' ? 'Codex' : id === 'grok' ? 'Grok Build' : 'Claude Code'
  console.log(title)
  console.log(`  installed: ${diagnosis.installed.detail}`)
  console.log(`  auth: ${diagnosis.authenticated.detail}`)
  console.log(`  protocol: ${diagnosis.protocol.detail}`)
  console.log(
    `  notes: ${redactDiagnosticText(diagnosis.raw.install.stdout).split('\n')[0] || 'none'}`,
  )
  console.log('')
}
