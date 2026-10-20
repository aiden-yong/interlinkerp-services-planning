/** Next.js runs this once per server instance before serving requests. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { redactConsole } = await import('./server/support/redactConsole');
    redactConsole();
  }
}
