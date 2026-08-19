import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppError } from '@sikumi-local/core'
import { resolveCommandOnPath } from '@sikumi-local/process-runtime'

const execFileAsync = promisify(execFile)
const PICKER_TIMEOUT_MS = 10 * 60 * 1000

export type FolderChoice =
  | { readonly cancelled: true }
  | { readonly cancelled: false; readonly path: string }

export type FolderPickerRunner = (
  command: string,
  args: readonly string[],
  options: { readonly timeout: number },
) => Promise<{ readonly stdout: string; readonly stderr: string }>

export type FolderPickerInvocation = {
  readonly command: string
  readonly args: readonly string[]
}

const WINDOWS_FOLDER_PICKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  '[System.Windows.Forms.Application]::EnableVisualStyles()',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$dialog.Description = '観測する場所を選んでください'",
  'try { $dialog.UseDescriptionForTitle = $true } catch {}',
  'try { $dialog.AutoUpgradeEnabled = $true } catch {}',
  '$dialog.ShowNewFolderButton = $false',
  '$form = New-Object System.Windows.Forms.Form',
  '$form.TopMost = $true',
  "$form.StartPosition = 'CenterScreen'",
  '$form.ShowInTaskbar = $false',
  '$form.Width = 0',
  '$form.Height = 0',
  'try {',
  '  $result = $dialog.ShowDialog($form)',
  '  if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {',
  '    [Console]::Out.Write($dialog.SelectedPath)',
  '  }',
  '} finally {',
  '  $form.Dispose()',
  '  $dialog.Dispose()',
  '}',
].join('\n')

export function folderPickerInvocation(
  platform: NodeJS.Platform,
): FolderPickerInvocation | null {
  if (platform === 'darwin') {
    return {
      command: 'osascript',
      args: [
        '-e',
        'POSIX path of (choose folder with prompt "観測する場所を選んでください")',
      ],
    }
  }
  if (platform === 'win32') {
    return {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-STA',
        '-WindowStyle',
        'Hidden',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        WINDOWS_FOLDER_PICKER_SCRIPT,
      ],
    }
  }
  return null
}

export async function chooseLocalFolder(
  options: {
    readonly platform?: NodeJS.Platform
    readonly run?: FolderPickerRunner
  } = {},
): Promise<FolderChoice> {
  const platform = options.platform ?? process.platform
  const invocation = folderPickerInvocation(platform)
  if (!invocation) {
    throw new AppError(
      'FOLDER_PICKER_UNAVAILABLE',
      'この環境ではフォルダ選択が使えません。場所のパスを手で入力してください。',
      400,
    )
  }

  const run = options.run ?? defaultRunner
  try {
    const { stdout } = await run(invocation.command, invocation.args, {
      timeout: PICKER_TIMEOUT_MS,
    })
    const path = normalizeChosenPath(stdout)
    if (!path) {
      return { cancelled: true }
    }
    return { cancelled: false, path }
  } catch (error) {
    if (isFolderPickerCancel(error)) {
      return { cancelled: true }
    }
    throw new AppError(
      'FOLDER_PICKER_UNAVAILABLE',
      'フォルダを選べませんでした。場所のパスを手で入力してください。',
      400,
    )
  }
}

export function normalizeChosenPath(raw: string): string {
  return raw
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .replace(/[/\\]+$/, '')
}

export function isFolderPickerCancel(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const record = error as {
    readonly code?: string | number
    readonly stderr?: string
    readonly message?: string
  }
  const text = `${record.stderr ?? ''} ${record.message ?? ''}`
  return /user cancel+ed|operation (was )?cancel+ed|-128/i.test(text)
}

async function defaultRunner(
  command: string,
  args: readonly string[],
  options: { readonly timeout: number },
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const resolved =
    resolveCommandOnPath(command) ??
    (command === 'powershell'
      ? resolveCommandOnPath('powershell.exe')
      : undefined) ??
    command
  return execFileAsync(resolved, [...args], options)
}
