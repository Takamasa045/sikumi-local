import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AppError } from '@sikumi-local/core'

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

export async function chooseLocalFolder(
  options: {
    readonly platform?: NodeJS.Platform
    readonly run?: FolderPickerRunner
  } = {},
): Promise<FolderChoice> {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    throw new AppError(
      'FOLDER_PICKER_UNAVAILABLE',
      'この環境ではフォルダ選択が使えません。場所のパスを手で入力してください。',
      400,
    )
  }

  const run = options.run ?? defaultRunner
  try {
    const { stdout } = await run(
      'osascript',
      [
        '-e',
        'POSIX path of (choose folder with prompt "観測する場所を選んでください")',
      ],
      { timeout: PICKER_TIMEOUT_MS },
    )
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
  return raw.trim().replace(/\/+$/, '')
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
  return /user canceled|user cancelled|-128/i.test(text)
}

async function defaultRunner(
  command: string,
  args: readonly string[],
  options: { readonly timeout: number },
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return execFileAsync(command, [...args], options)
}
