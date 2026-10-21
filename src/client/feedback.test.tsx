import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FeedbackProvider, useFeedback } from './feedback';

afterEach(() => cleanup());

function Chooser({ onResult }: { onResult: (value: string | null) => void }) {
  const { choose } = useFeedback();
  return (
    <button type="button" onClick={async () => onResult(await choose('Change a repeated shift', [], [
      { value: 'this', label: 'This shift' },
      { value: 'following', label: 'This and following' },
      { value: 'all', label: 'All' },
    ]))}>
      Ask
    </button>
  );
}

describe('choose', () => {
  it('resolves to the clicked option\'s value', async () => {
    let result: string | null = null;
    render(<FeedbackProvider><Chooser onResult={(v) => { result = v; }} /></FeedbackProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'This and following' }));
    await waitFor(() => expect(result).toBe('following'));
  });

  it('resolves to null on Cancel', async () => {
    let result: string | null = 'unset';
    render(<FeedbackProvider><Chooser onResult={(v) => { result = v; }} /></FeedbackProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(result).toBeNull());
  });
});
