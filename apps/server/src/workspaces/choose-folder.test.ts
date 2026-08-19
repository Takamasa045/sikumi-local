import { describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import {
  chooseLocalFolder,
  folderPickerInvocation,
  isFolderPickerCancel,
  normalizeChosenPath,
} from './choose-folder.js'

describe('folderPickerInvocation', () => {
  it('uses osascript on macOS and PowerShell on Windows', () => {
    const mac = folderPickerInvocation('darwin')
    expect(mac?.command).toBe('osascript')
    expect(mac?.args).toContain(
      'POSIX path of (choose folder with prompt "観測する場所を選んでください")',
    )

    const windows = folderPickerInvocation('win32')
    expect(windows?.command).toBe('powershell')
    expect(windows?.command).not.toBe('osascript')
    expect(windows?.args).toContain('-STA')
    expect(
      windows?.args.some((arg) => String(arg).includes('FolderBrowserDialog')),
    ).toBe(true)
    expect(windows?.args.some((arg) => String(arg).includes('osascript'))).toBe(
      false,
    )

    expect(folderPickerInvocation('linux')).toBeNull()
  })
})

describe('chooseLocalFolder', () => {
  it('opens the macOS folder dialog and returns the POSIX path', async () => {
    const choice = await chooseLocalFolder({
      platform: 'darwin',
      run: async (command) => {
        expect(command).toBe('osascript')
        return {
          stdout: '/Users/example/blog/\n',
          stderr: '',
        }
      },
    })

    expect(choice).toEqual({
      cancelled: false,
      path: '/Users/example/blog',
    })
  })

  it('opens the Windows folder dialog and does not call osascript', async () => {
    const commands: string[] = []
    const choice = await chooseLocalFolder({
      platform: 'win32',
      run: async (command, args) => {
        commands.push(command)
        expect(command).toBe('powershell')
        expect(args).toContain('-STA')
        expect(
          args.some((arg) => String(arg).includes('FolderBrowserDialog')),
        ).toBe(true)
        return {
          stdout: 'C:\\Users\\example\\blog\\\r\n',
          stderr: '',
        }
      },
    })

    expect(commands).toEqual(['powershell'])
    expect(choice).toEqual({
      cancelled: false,
      path: 'C:\\Users\\example\\blog',
    })
  })

  it('treats a user cancel as no-op', async () => {
    const choice = await chooseLocalFolder({
      platform: 'darwin',
      run: async () => {
        throw Object.assign(new Error('execution error'), {
          stderr: 'User canceled.',
          code: 1,
        })
      },
    })

    expect(choice).toEqual({ cancelled: true })
  })

  it('treats an empty Windows dialog result as cancel', async () => {
    const choice = await chooseLocalFolder({
      platform: 'win32',
      run: async () => ({ stdout: '\r\n', stderr: '' }),
    })

    expect(choice).toEqual({ cancelled: true })
  })

  it('does not open a native picker on other platforms', async () => {
    try {
      await chooseLocalFolder({
        platform: 'linux',
        run: async () => {
          throw new Error('osascript should not run')
        },
      })
      throw new Error('expected FOLDER_PICKER_UNAVAILABLE')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('FOLDER_PICKER_UNAVAILABLE')
    }
  })
})

describe('normalizeChosenPath', () => {
  it('strips trailing slashes from AppleScript POSIX paths', () => {
    expect(normalizeChosenPath('  /Users/example/blog/  ')).toBe(
      '/Users/example/blog',
    )
  })

  it('strips trailing backslashes and quotes from Windows dialog paths', () => {
    expect(normalizeChosenPath('  "C:\\Users\\example\\blog\\"  ')).toBe(
      'C:\\Users\\example\\blog',
    )
    expect(normalizeChosenPath('C:/Users/example/blog/')).toBe(
      'C:/Users/example/blog',
    )
  })
})

describe('isFolderPickerCancel', () => {
  it('recognizes AppleScript user-cancel messages', () => {
    expect(
      isFolderPickerCancel({ stderr: 'User canceled.\n', message: '' }),
    ).toBe(true)
    expect(isFolderPickerCancel({ message: 'error -128' })).toBe(true)
    expect(isFolderPickerCancel({ message: 'spawn osascript ENOENT' })).toBe(
      false,
    )
  })

  it('recognizes a Windows dialog cancel without treating a missing binary as cancel', () => {
    expect(isFolderPickerCancel({ message: 'The operation was canceled' })).toBe(
      true,
    )
    expect(
      isFolderPickerCancel({ message: 'spawn powershell ENOENT' }),
    ).toBe(false)
  })
})
