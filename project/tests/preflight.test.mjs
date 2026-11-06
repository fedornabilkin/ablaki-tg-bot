import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preflight } from '../dist/preflight.js';
import { readConfig } from '../dist/config.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'bot-preflight-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { ...readConfig({
    TELEGRAM_BOT_TOKEN: '123:' + 'a'.repeat(32),
    TELEGRAM_AUTH_API_KEY: 'private-test-key'.repeat(3),
    ABL_API_BASE_URL: 'https://api.example.test',
  }, false), dataDir };
}

function upstream(config, calls, { webhook = '', registrationStatus = 200 } = {}) {
  return async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'POST');
    if (url.endsWith('/getMe')) return Response.json({ ok: true, result: { id: 123, username: 'ExampleBot' } });
    if (url.endsWith('/getWebhookInfo')) return Response.json({ ok: true, result: { url: webhook } });
    if (url === config.apiUrl + '/auth/telegram/bot/register') {
      assert.equal(options.headers.Authorization, `Bearer ${config.apiKey}`);
      assert.deepEqual(JSON.parse(options.body), { bot_id: '123', bot_username: 'ExampleBot' });
      if (registrationStatus !== 200) return new Response('sensitive upstream details', { status: registrationStatus });
      return Response.json({ bot: { registered: true }, site: { name: 'Example', host: 'example.test' } });
    }
    assert.fail(`Unexpected request: ${new URL(url).pathname.split('/').at(-1)}`);
  };
}

test('preflight checks API, Telegram and data without polling or changing saved state', async t => {
  const config = await fixture(t);
  const saved = JSON.stringify({ version: 1, botId: 123, offset: 321, receipts: {} });
  await writeFile(join(config.dataDir, 'state.json'), saved);
  const calls = [];
  assert.deepEqual(await preflight(config, upstream(config, calls)), { bot: 'ExampleBot', site: 'example.test' });
  assert.equal(calls.length, 3);
  assert.equal(await readFile(join(config.dataDir, 'state.json'), 'utf8'), saved);
  assert.deepEqual(await readdir(config.dataDir), ['state.json']);
});

test('preflight supports a fresh volume without initializing polling state', async t => {
  const config = await fixture(t);
  await preflight(config, upstream(config, []));
  assert.deepEqual(await readdir(config.dataDir), []);
});

test('preflight refuses a configured webhook without deleting it or calling the site', async t => {
  const config = await fixture(t);
  const calls = [];
  await assert.rejects(preflight(config, upstream(config, calls, { webhook: 'https://old.example.test/hook' })), /webhook/);
  assert.equal(calls.length, 2);
});

test('preflight preserves incompatible or corrupt state and refuses to register the bot', async t => {
  const config = await fixture(t);
  for (const saved of ['invalid JSON', JSON.stringify({ version: 1, botId: 456, offset: 100, receipts: {} })]) {
    await writeFile(join(config.dataDir, 'state.json'), saved);
    const calls = [];
    await assert.rejects(preflight(config, upstream(config, calls)), /data.*different bot/);
    assert.equal(calls.length, 2);
    assert.equal(await readFile(join(config.dataDir, 'state.json'), 'utf8'), saved);
    assert.deepEqual(await readdir(config.dataDir), ['state.json']);
  }
});

test('preflight exposes the API status but not credentials or upstream error details', async t => {
  const config = await fixture(t);
  await assert.rejects(preflight(config, upstream(config, [], { registrationStatus: 401 })), error => {
    assert.match(error.message, /HTTP 401/);
    assert.ok(!error.message.includes(config.apiKey));
    assert.ok(!error.message.includes(config.token));
    assert.ok(!error.message.includes('sensitive'));
    return true;
  });
});

test('preflight does not leak the token when Telegram or the network fails', async t => {
  const config = await fixture(t);
  await assert.rejects(preflight(config, async () => { throw new Error(config.token); }), error => {
    assert.match(error.message, /getMe failed/);
    assert.ok(!error.message.includes(config.token));
    return true;
  });
});

test('server preflight refuses local HTTP before sending any credentials', async t => {
  const config = await fixture(t);
  await assert.rejects(preflight({ ...config, apiUrl: 'http://127.0.0.1:3180' }, async () => assert.fail('Must not connect')), /HTTPS/);
});
