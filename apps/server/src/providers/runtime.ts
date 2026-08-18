export function resolveFakeHarnessEnabled(
  explicit?: boolean,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (explicit !== undefined) {
    return explicit
  }
  return env.SIKUMI_LOCAL_ENABLE_FAKE_PROVIDER === '1'
}
