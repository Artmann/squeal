import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { Toaster } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FilePathInput } from './FilePathInput'
import { Form, FormField, FormItem, FormLabel } from './ui/form'

// `FilePathInput` renders `FormControl`, which reads the react-hook-form
// context, so it cannot be rendered on its own. This is the smallest form that
// gives it one — and it doubles as the assertion that the label reaches the
// input, which is what every query below goes through.
function FilePathInputHarness({
  onFileSelected
}: {
  onFileSelected: (filePath: string) => void
}) {
  const form = useForm({ defaultValues: { certificate: '' } })

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="certificate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>SSL Root Certificate</FormLabel>
            <FilePathInput
              browseLabel="Browse for certificate file"
              dialogKind="certificate"
              placeholder="system"
              {...field}
              onFileSelected={(filePath) => {
                field.onChange(filePath)
                onFileSelected(filePath)
              }}
            />
          </FormItem>
        )}
      />
    </Form>
  )
}

function renderFilePathInput(onFileSelected = vi.fn()) {
  render(
    <>
      <FilePathInputHarness onFileSelected={onFileSelected} />
      <Toaster />
    </>
  )

  return onFileSelected
}

describe('FilePathInput', () => {
  beforeEach(() => {
    // `vitest.setup.ts` gives every test a bridge whose picker cancels. The
    // cases that pick a file replace it.
    vi.spyOn(window.electron, 'openFileDialog').mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fills the field with the picked path', async () => {
    const user = userEvent.setup()

    vi.spyOn(window.electron, 'openFileDialog').mockResolvedValue(
      '/etc/ssl/certs/pagila.pem'
    )

    const onFileSelected = renderFilePathInput()

    await user.click(
      screen.getByRole('button', { name: 'Browse for certificate file' })
    )

    expect(screen.getByLabelText('SSL Root Certificate')).toHaveValue(
      '/etc/ssl/certs/pagila.pem'
    )
    expect(onFileSelected.mock.calls).toEqual([['/etc/ssl/certs/pagila.pem']])
  })

  it('asks for the dialog its kind names', async () => {
    const user = userEvent.setup()

    renderFilePathInput()

    await user.click(
      screen.getByRole('button', { name: 'Browse for certificate file' })
    )

    expect(vi.mocked(window.electron.openFileDialog).mock.calls).toEqual([
      ['certificate']
    ])
  })

  // Cancelling is an answer, not a failure: whatever was typed by hand has to
  // survive it, or the picker becomes a way to lose a path.
  it('leaves a typed path alone when the picker is cancelled', async () => {
    const user = userEvent.setup()
    const onFileSelected = renderFilePathInput()

    const field = screen.getByLabelText('SSL Root Certificate')

    await user.type(field, '/etc/ssl/certs/typed.pem')
    await user.click(
      screen.getByRole('button', { name: 'Browse for certificate file' })
    )

    expect(field).toHaveValue('/etc/ssl/certs/typed.pem')
    expect(onFileSelected.mock.calls).toEqual([])
  })

  // The picker failing to open is the one case where the field is the only way
  // through, so the toast has to say so rather than leaving a dead button.
  it('says to type the path instead when the picker cannot open', async () => {
    const user = userEvent.setup()
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    vi.spyOn(window.electron, 'openFileDialog').mockRejectedValue(
      new Error(
        'Invariant failed: A file dialog was requested with no window open.'
      )
    )

    renderFilePathInput()

    await user.click(
      screen.getByRole('button', { name: 'Browse for certificate file' })
    )

    expect(
      await screen.findByText('Could not open the file picker')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Type the path into the field instead.')
    ).toBeInTheDocument()
    expect(consoleError.mock.calls.length).toEqual(1)
  })
})
