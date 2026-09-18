import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { EnvironmentDto } from '@/glue/environments'
import { EnvironmentBadge } from './EnvironmentBadge'

const production: EnvironmentDto = {
  createdAt: 3,
  hue: 25,
  id: 'production',
  name: 'Production'
}

describe('EnvironmentBadge', () => {
  it('names the environment', () => {
    render(<EnvironmentBadge environment={production} />)

    expect(screen.getByText('Production')).toBeInTheDocument()
  })

  // The hue is the whole colour: the utilities compose lightness and chroma
  // themselves and read the angle off this property, so a badge that does not
  // set it is a badge with no colour.
  it('carries the hue as an inline custom property', () => {
    render(<EnvironmentBadge environment={production} />)

    expect(
      screen.getByText('Production').style.getPropertyValue('--env-hue')
    ).toEqual('25')
  })

  // Undefined covers both "no environment" and "an environment deleted since
  // this connection was listed". Neither is an error, and neither gets a badge.
  it('renders nothing without an environment', () => {
    const { container } = render(<EnvironmentBadge environment={undefined} />)

    expect(container).toBeEmptyDOMElement()
  })
})
