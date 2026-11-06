import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readConfig, type Config } from './config.js';
import { SiteApi, SiteApiError } from './site-api.js';
import { StateStore } from './state.js';

/** Never calls getUpdates, sends chat messages, or changes the saved offset. */
export async function preflight(config: Config, fetcher: typeof fetch = fetch,
  register = (id: number, username: string) => new SiteApi(config.apiUrl, config.apiKey, fetcher).register(id, username)) {
  if (new URL(config.apiUrl).protocol !== 'https:') throw new Error('Server API must use HTTPS, not a local address.');
  const telegram = async (method: string) => {
    try {
      const response = await fetcher(`https://api.telegram.org/bot${config.token}/${method}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      const body = await response.json() as { ok?: boolean; result?: Record<string, unknown> };
      if (!response.ok || !body.ok || !body.result) throw new Error();
      return body.result;
    } catch { throw new Error(`Telegram ${method} failed: check token, DNS, HTTPS and outbound access.`); }
  };
  const me = await telegram('getMe');
  if (!Number.isSafeInteger(me.id) || Number(me.id) <= 0 || typeof me.username !== 'string' || !me.username) {
    throw new Error('Telegram returned invalid bot metadata.');
  }
  const webhook = await telegram('getWebhookInfo');
  if (webhook.url !== '') throw new Error('A webhook is configured. Long polling cannot start until it is removed deliberately.');
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const temporary = join(config.dataDir, `.preflight-${randomUUID()}`);
  const renamed = temporary + '.renamed';
  try {
    await writeFile(temporary, 'ok', { flag: 'wx', mode: 0o600 });
    await rename(temporary, renamed);
    if (await readFile(renamed, 'utf8') !== 'ok') throw new Error();
    await StateStore.load(config.dataDir, Number(me.id));
  } catch { throw new Error('Bot data is not writable/readable or belongs to a different bot. Check volume ownership (1000:1000) and state backup.'); }
  finally { await Promise.all([rm(temporary, { force: true }), rm(renamed, { force: true })]); }
  try {
    const website = await register(Number(me.id), me.username);
    return { bot: me.username, site: website.host };
  } catch (error) {
    const status = error instanceof SiteApiError ? error.status : 0;
    throw new Error(`Site API registration failed (HTTP ${status || 'network'}). Check HTTPS, API route, shared key and migrations.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await preflight(readConfig(process.env));
    console.info(`PREFLIGHT OK: @${result.bot}, API ${result.site}, data writable, no webhook. Polling was not started.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Preflight failed');
    process.exitCode = 1;
  }
}
