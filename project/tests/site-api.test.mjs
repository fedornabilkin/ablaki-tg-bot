import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteApi } from '../dist/site-api.js';
import { readConfig } from '../dist/config.js';

test('startup registers getMe identity with the shared key and accepts site metadata', async () => {
  const api = new SiteApi('http://localhost:3180', 'fixture-key', async (url, options) => {
    assert.equal(url, 'http://localhost:3180/auth/telegram/bot/register');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    assert.deepEqual(JSON.parse(options.body), { bot_id: '123', bot_username: 'ExampleBot' });
    return Response.json({ bot: { registered: true }, site: { name: 'Аблакин', host: 'localhost:5173' } });
  });
  assert.deepEqual(await api.register(123, 'ExampleBot'), { name: 'Аблакин', host: 'localhost:5173' });
});

test('bad credentials are not retried and response data is not exposed', async () => {
  let calls = 0;
  const api = new SiteApi('https://example.test', 'fixture-key', async () => {
    calls++; return new Response('sensitive upstream data', { status: 401 });
  });
  await assert.rejects(api.register(123, 'ExampleBot'), error => error.status === 401 && !error.message.includes('sensitive'));
  assert.equal(calls, 1);
});

test('temporary register failure retries without changing the identity', async () => {
  let calls = 0;
  const api = new SiteApi('https://example.test', 'fixture-key', async () => {
    if (++calls === 1) return new Response('', { status: 503 });
    return Response.json({ bot: { registered: true }, site: { name: 'Аблакин', host: 'ablakin.ru' } });
  }, async () => {});
  assert.equal((await api.register(123, 'ExampleBot')).host, 'ablakin.ru');
  assert.equal(calls, 2);
});

test('only local HTTP is accepted and config errors never include credentials', () => {
  const env = { TELEGRAM_BOT_TOKEN: '123:' + 'a'.repeat(32), TELEGRAM_AUTH_API_KEY: 's'.repeat(48), ABL_API_BASE_URL: 'http://host.docker.internal:3180' };
  assert.equal(readConfig(env, true).apiUrl, env.ABL_API_BASE_URL);
  assert.throws(() => readConfig({ ...env, ABL_API_BASE_URL: 'http://example.com' }), /HTTPS/);
  assert.throws(() => readConfig({ ...env, TELEGRAM_BOT_TOKEN: 'private-invalid-token' }), error => !error.message.includes('private-invalid-token'));
});

test('the same local env resolves the backend correctly on Windows and in Docker', () => {
  const env = { TELEGRAM_BOT_TOKEN: '123:' + 'a'.repeat(32), TELEGRAM_AUTH_API_KEY: 's'.repeat(48), ABL_API_BASE_URL: 'http://127.0.0.1:3180/api' };
  assert.equal(readConfig(env, false).apiUrl, 'http://127.0.0.1:3180/api');
  assert.equal(readConfig(env, true).apiUrl, 'http://host.docker.internal:3180/api');
  assert.equal(readConfig({ ...env, ABL_API_BASE_URL: 'http://host.docker.internal:3180' }, false).apiUrl, 'http://127.0.0.1:3180');
  assert.match(readConfig(env, false).dataDir.replaceAll('\\', '/'), /\/bot\/data$/);
  assert.equal(readConfig(env, true).dataDir, '/data');
  assert.equal(readConfig({ ...env, ABL_API_BASE_URL: 'https://api.ablakin.ru' }, true).apiUrl, 'https://api.ablakin.ru');
});
