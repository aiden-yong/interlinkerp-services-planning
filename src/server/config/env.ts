/** A required setting is missing or invalid. Raised before any request is served (contract SS-20). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function env(key: string, fallback?: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

export function requireEnv(key: string): string {
  const value = env(key);
  if (value === undefined) throw new ConfigError(`Missing required environment variable ${key}.`);
  return value;
}

export function requireAll(keys: string[]): void {
  const missing = keys.filter((key) => env(key) === undefined);
  if (missing.length > 0) throw new ConfigError(`Missing required environment variables: ${missing.join(', ')}.`);
}

/** For scripts run outside Next.js. Never overrides a variable that is already set. */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local: rely on the real environment.
  }
}
