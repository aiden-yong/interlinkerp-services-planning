import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { describeError, errorText } from './common';

const invalid = new ApiError(422, 'VALIDATION_ERROR', 'The request has invalid fields.', { name: 'Too long.', other: 'Odd.' }, null);

describe('error text', () => {
  it('puts known field messages on their inputs and the rest in the message', () => {
    expect(describeError(invalid, ['name'])).toEqual({ message: 'The request has invalid fields. other: Odd.', fields: { name: 'Too long.' } });
    expect(describeError(invalid, ['name', 'other'])).toEqual({ message: '', fields: { name: 'Too long.', other: 'Odd.' } });
  });

  it('keeps the server message for other API errors', () => {
    expect(describeError(new ApiError(409, 'ROLE_NAME_TAKEN', 'Taken.', null, null), ['name'])).toEqual({ message: 'Taken.', fields: {} });
  });

  it('uses a fixed message for failures that are not API errors', () => {
    expect(errorText(new TypeError('Failed to fetch')).length).toBeGreaterThan(0);
    expect(errorText(new TypeError('Failed to fetch'))).not.toContain('fetch');
  });
});
