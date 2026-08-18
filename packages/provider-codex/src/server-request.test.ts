import { describe, expect, it } from 'vitest'
import {
  buildCodexApprovalResult,
  isSupportedCodexServerRequest,
} from './server-request.js'

const PERMISSIONS_FIXTURE = {
  rules: [{ pattern: 'git status' }],
}

describe('Codex ServerRequest allowlist', () => {
  it('accepts only the documented approval methods', () => {
    expect(
      isSupportedCodexServerRequest('item/commandExecution/requestApproval'),
    ).toBe(true)
    expect(
      isSupportedCodexServerRequest('item/fileChange/requestApproval'),
    ).toBe(true)
    expect(
      isSupportedCodexServerRequest('item/permissions/requestApproval'),
    ).toBe(true)
    expect(isSupportedCodexServerRequest('item/tool/requestUserInput')).toBe(
      false,
    )
    expect(
      isSupportedCodexServerRequest('mcpItem/elicitation/requestApproval'),
    ).toBe(false)
    expect(
      isSupportedCodexServerRequest('item/dynamicTool/requestApproval'),
    ).toBe(false)
    expect(isSupportedCodexServerRequest('account/token/refresh')).toBe(false)
    expect(isSupportedCodexServerRequest('turn/steer')).toBe(false)
  })

  it('builds method-specific responses and fail-closes unknown permissions', () => {
    expect(
      buildCodexApprovalResult(
        'item/commandExecution/requestApproval',
        'approved',
      ),
    ).toEqual({ decision: 'accept' })
    expect(
      buildCodexApprovalResult('item/fileChange/requestApproval', 'denied'),
    ).toEqual({ decision: 'decline' })
    expect(
      buildCodexApprovalResult(
        'item/permissions/requestApproval',
        'approved',
        PERMISSIONS_FIXTURE,
      ),
    ).toEqual({
      permissions: PERMISSIONS_FIXTURE,
      scope: 'turn',
    })
    expect(
      buildCodexApprovalResult(
        'item/permissions/requestApproval',
        'denied',
        PERMISSIONS_FIXTURE,
      ),
    ).toEqual({
      permissions: {},
      scope: 'turn',
    })
    expect(
      buildCodexApprovalResult('item/permissions/requestApproval', 'approved'),
    ).toEqual({
      permissions: {},
      scope: 'turn',
    })
  })
})
