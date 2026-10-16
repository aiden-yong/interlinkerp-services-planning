'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface ToastAction { label: string; run: () => void | Promise<void> }
interface Toast { id: number; message: string; action?: ToastAction }
interface Question { title: string; lines: string[]; confirmLabel: string; resolve: (ok: boolean) => void }
interface Feedback {
  toast(message: string, action?: ToastAction, ms?: number): void;
  confirm(title: string, lines: string[], confirmLabel: string): Promise<boolean>;
}

const FeedbackContext = createContext<Feedback | null>(null);
let nextId = 0;

/** An accessible modal: role=dialog, focus moves inside, Escape or a backdrop click closes it. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);

  const toast = useCallback((message: string, action?: ToastAction, ms = 10_000) => {
    const id = ++nextId;
    setToasts((all) => [...all, { id, message, action }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), ms);
  }, []);
  const confirm = useCallback((title: string, lines: string[], confirmLabel: string) =>
    new Promise<boolean>((resolve) => setQuestion((open) => {
      open?.resolve(false);
      return { title, lines, confirmLabel, resolve };
    })), []);
  const answer = (ok: boolean) => {
    question?.resolve(ok);
    setQuestion(null);
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {question && (
        <Modal title={question.title} onClose={() => answer(false)}>
          {question.lines.length > 0 && <ul className="lines">{question.lines.map((line) => <li key={line}>{line}</li>)}</ul>}
          <div className="actions">
            <button type="button" onClick={() => answer(false)}>Cancel</button>
            <button type="button" className="primary" autoFocus onClick={() => answer(true)}>{question.confirmLabel}</button>
          </div>
        </Modal>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <span>{t.message}</span>
            {t.action && (
              <button type="button" onClick={() => {
                setToasts((all) => all.filter((x) => x.id !== t.id));
                void t.action!.run();
              }}>{t.action.label}</button>
            )}
          </div>
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('useFeedback must be used inside <FeedbackProvider>.');
  return feedback;
}
