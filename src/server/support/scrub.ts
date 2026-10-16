const ADDRESS = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;

/** DR-02: replaces every email address in `text`, with no length limit (for logs that keep a stack). */
export function redactAddresses(text: string): string {
  return text.replace(ADDRESS, '[address]');
}

/** DR-02: error text saved to the database never keeps an email address (SMTP errors often quote the recipient). */
export function scrubAddresses(text: string): string {
  return redactAddresses(text).slice(0, 500);
}
