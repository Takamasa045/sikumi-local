export const CODEX_ACCEPT_DECLINE_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
] as const

export const CODEX_PERMISSIONS_METHOD = 'item/permissions/requestApproval'

export type CodexApprovalMethod =
  | (typeof CODEX_ACCEPT_DECLINE_METHODS)[number]
  | typeof CODEX_PERMISSIONS_METHOD

export function isCodexAcceptDeclineMethod(
  method: string,
): method is (typeof CODEX_ACCEPT_DECLINE_METHODS)[number] {
  return (CODEX_ACCEPT_DECLINE_METHODS as readonly string[]).includes(method)
}

export function isCodexPermissionsMethod(
  method: string,
): method is typeof CODEX_PERMISSIONS_METHOD {
  return method === CODEX_PERMISSIONS_METHOD
}

export function isSupportedCodexServerRequest(
  method: string,
): method is CodexApprovalMethod {
  return isCodexAcceptDeclineMethod(method) || isCodexPermissionsMethod(method)
}

export function buildCodexApprovalResult(
  method: string,
  decision: 'approved' | 'denied',
  permissions?: unknown,
): Record<string, unknown> {
  if (isCodexPermissionsMethod(method)) {
    return {
      permissions:
        decision === 'approved' && isPlainObject(permissions)
          ? permissions
          : {},
      scope: 'turn',
    }
  }
  return {
    decision: decision === 'approved' ? 'accept' : 'decline',
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
