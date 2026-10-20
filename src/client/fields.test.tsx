import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FieldError, FormError, invalid } from './fields';

afterEach(cleanup);

describe('field errors (backlog item 27)', () => {
  it('links an input to its announced error only while there is one', () => {
    render(<label>Name<input {...invalid('Must be at most 80 characters.', 'role-name-error')} /><FieldError id="role-name-error" message="Must be at most 80 characters." /></label>);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('role-name-error');
    expect(screen.getByRole('alert').id).toBe('role-name-error');
    expect(invalid(undefined, 'x')).toEqual({});
  });

  it('renders nothing without a message, and announces form problems', () => {
    const { container } = render(<><FieldError id="a" message={null} /><FormError message="" /></>);
    expect(container.innerHTML).toBe('');
    render(<FormError message="Something went wrong." className="wide" />);
    expect(screen.getByRole('alert').className).toBe('form-error wide');
  });
});
