import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[a-zA-Z0-9_]{2,29}bot$/i),
  TELEGRAM_AUTH_API_KEY: z.string().min(32).max(512).regex(/^\S+$/),
  ABL_API_BASE_URL: z.url(),
  ABL_SITE_URL: z.url(),
  ABL_SITE_NAME: z.string().min(1).max(60).regex(/^[^\r\n<>]+$/).default('Аблакин'),
  TELEGRAM_UPDATES_MODE: z.literal('polling').default('polling'),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  BOT_DATA_DIR: z.string().min(1).default('./data'),
  BOT_HEALTH_FILE: z.string().min(1).default('/tmp/bot-health.json'),
});

export type Config = ReturnType<typeof readConfig>;

export function readConfig(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  // Do not include Zod errors: they may contain input secrets.
  if (!parsed.success) throw new Error('Invalid environment: ' + [...new Set(parsed.error.issues.map(i => i.path[0]))].join(', '));
  const e = parsed.data;
  const api = new URL(e.ABL_API_BASE_URL);
  const site = new URL(e.ABL_SITE_URL);
  for (const url of [api, site]) {
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash
      || (url.protocol !== 'https:' && !(e.NODE_ENV !== 'production' && loopback && url.protocol === 'http:'))) {
      throw new Error('URLs must use HTTPS without credentials, query or fragment (local development permits loopback HTTP).');
    }
  }
  return {
    token: e.TELEGRAM_BOT_TOKEN,
    username: e.TELEGRAM_BOT_USERNAME,
    apiKey: e.TELEGRAM_AUTH_API_KEY,
    apiUrl: api.href.replace(/\/$/, ''),
    siteHost: site.host,
    siteName: e.ABL_SITE_NAME,
    dataDir: resolve(e.BOT_DATA_DIR),
    healthFile: resolve(e.BOT_HEALTH_FILE),
  };
}
