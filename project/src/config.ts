import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  const local = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(api.hostname);
  if (api.username || api.password || api.search || api.hash || (api.protocol !== 'https:' && !(local && api.protocol === 'http:'))) {
    throw new Error('API URL must use HTTPS; local development also allows loopback/Docker HTTP.');
  }
  return {
    token: e.TELEGRAM_BOT_TOKEN,
    apiKey: e.TELEGRAM_AUTH_API_KEY,
    apiUrl: api.href.replace(/\/$/, ''),
    siteHost: api.host,
    siteName: 'Аблакин',
    dataDir: existsSync('/.dockerenv') ? '/data' : resolve(import.meta.dirname, '../../data'),
    healthFile: resolve(tmpdir(), 'bot-health.json'),
  };
}
