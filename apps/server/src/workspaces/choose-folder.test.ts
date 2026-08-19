import { describe, expect, it } from 'vitest'
import { AppError } from '@sikumi-local/core'
import {
  chooseLocalFolder,
  isFolderPickerCancel,
  normalizeChosenPath,
} from './choose-folder.js'

describe('chooseLocalFolder', () => {
  it('opens the macOS folder dialog and returns the POSIX path', async () => {
    const choice = await chooseLocalFolder({
      platform: 'darwin',
      run: async () => ({
        stdout: '/Users/example/blog/\n',
        stderr: '',
      }),
    })

    expect(choice).toEqual({
      cancelled: false,
      path: '/Users/example/blog',
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
})
