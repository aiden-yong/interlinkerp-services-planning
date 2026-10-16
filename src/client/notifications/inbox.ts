/** The badge text: the count, capped at 99+. */
export const unreadLabel = (n: number): string => (n > 99 ? '99+' : String(n));
