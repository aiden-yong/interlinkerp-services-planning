/**
 * WCAG 2.2 AA (backlog item 27): a field's error is linked to its input (aria-invalid, aria-describedby) and announced
 * when it appears (role="alert"), so screen-reader users hear what went wrong without hunting for it.
 */
export function invalid(message: string | null | undefined, id: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
  return message ? { 'aria-invalid': true, 'aria-describedby': id } : {};
}

export function FieldError({ id, message, as: Tag = 'span', className = '' }: { id: string; message: string | null | undefined; as?: 'span' | 'p' | 'div'; className?: string }) {
  if (!message) return null;
  return <Tag id={id} role="alert" className={`field-error ${className}`.trim()}>{message}</Tag>;
}

/** A form-level problem, announced the same way. */
export function FormError({ message, className = '' }: { message: string | null | undefined; className?: string }) {
  if (!message) return null;
  return <p role="alert" className={`form-error ${className}`.trim()}>{message}</p>;
}
