import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/),
  TELEGRAM_AUTH_API_KEY: z.string().min(32).max(512).regex(/^\S+$/),
  ABL_API_BASE_URL: z.url(),
});

export type Config = ReturnType<typeof readConfig>;

export function readConfig(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  // Do not include Zod errors: they may contain input secrets.
  if (!parsed.success) throw new Error('Invalid environment: ' + [...new Set(parsed.error.issues.map(i => i.path[0]))].join(', '));
  const e = parsed.data;
  const api = new URL(e.ABL_API_BASE_URL);
  if (api.username || api.password || api.search || api.hash || !['https:', 'http:'].includes(api.protocol)) {
    throw new Error('API URL must be HTTP(S) without credentials, query or fragment.');
  }
  return {
    token: e.TELEGRAM_BOT_TOKEN,
    apiKey: e.TELEGRAM_AUTH_API_KEY,
    apiUrl: api.href.replace(/\/$/, ''),
    siteHost: api.host,
    siteName: 'Аблакин',
    dataDir: resolve('/data'),
    healthFile: resolve('/tmp/bot-health.json'),
  };
}
