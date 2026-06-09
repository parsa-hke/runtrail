import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from './atoms'

describe('StatusBadge', () => {
  it('renders the status label', () => {
    render(<StatusBadge status="running" />)
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('renders an unknown status verbatim', () => {
    render(<StatusBadge status="queued" />)
    expect(screen.getByText('queued')).toBeInTheDocument()
  })
})
