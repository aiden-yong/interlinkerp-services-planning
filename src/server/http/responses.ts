export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function envelope(code: string, message: string, correlationId: string, details: unknown) {
  return { error: { code, message, correlation_id: correlationId, details } };
}
