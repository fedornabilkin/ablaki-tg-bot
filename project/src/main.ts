import { Bot, type Context } from "grammy";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig } from "./config.js";
import { approvalMessage, completedMessage } from "./messages.js";
import { SiteApi, SiteApiError, requestIdSchema } from "./site-api.js";
import { StateStore } from "./state.js";

const config = readConfig(process.env);
const bot = new Bot(config.token);
const site = new SiteApi(config.apiUrl, config.apiKey);
let stopping = false;

function log(event: string, detail?: Record<string, string | number>) {
  console.info(JSON.stringify({ time: new Date().toISOString(), event, ...detail }));
}

function telegramId(ctx: Context): string | undefined {
  const user = ctx.from;
  if (!user || user.is_bot || !Number.isSafeInteger(user.id) || user.id <= 0) return undefined;
  if (ctx.chat?.type !== "private" || ctx.chat.id !== user.id) return undefined;
  return String(user.id);
}

function publicError(error: unknown): string {
  if (error instanceof SiteApiError) {
    if (error.status === 401 || error.status === 403) return "Не удалось проверить запрос. Вернитесь на сайт и начните заново.";
    if (error.status === 404 || error.status === 409 || error.status === 410) return "Запрос уже закрыт или истёк. Вернитесь на сайт и создайте новый.";
    if (error.status === 429 || error.status >= 500) return "Сайт временно не ответил. Подождите немного и нажмите кнопку ещё раз.";
  }
  return "Не удалось обработать запрос. Вернитесь на сайт и начните заново.";
}

async function safeReply(ctx: Context, text: string) {
  if (!telegramId(ctx)) return;
  await ctx.reply(text).catch(() => undefined);
}

export function registerHandlers(target: Bot, store: StateStore, api: SiteApi, botConfig = config) {
  target.command("start", async ctx => {
    const userId = telegramId(ctx);
    const telegramUser = ctx.from;
    if (!userId || !telegramUser) return;

    const match = /^login_([A-Za-z0-9_-]{43})$/.exec(ctx.match.trim());
    if (!match || !requestIdSchema.safeParse(match[1]).success) {
      await safeReply(ctx, "Чтобы войти, откройте сайт " + botConfig.siteHost + " и нажмите «Войти через Telegram».");
      return;
    }

    const requestId = match[1]!;
    const oldReceipt = store.receipt(requestId);
    if (oldReceipt && oldReceipt.userId !== userId) {
      await safeReply(ctx, "Этот запрос уже связан с другим аккаунтом Telegram. Откройте новую заявку на сайте.");
      return;
    }
    if (oldReceipt) {
      await safeReply(ctx, "Заявка уже подготовлена. Нажмите кнопку в первом сообщении от бота.");
      return;
    }

    try {
      const prepared = await api.prepare(requestId, userId, telegramUser.username);
      if (prepared.id !== requestId) throw new SiteApiError(502);
      if (prepared.expires_at <= Math.floor(Date.now() / 1000)) {
        await safeReply(ctx, "Время запроса истекло. Вернитесь на сайт и начните заново.");
        return;
      }

      const message = approvalMessage(prepared, botConfig);
      if (prepared.status !== "pending") {
        await ctx.reply(completedMessage(prepared.status === "denied" ? "denied" : "approved",
          botConfig.siteHost, prepared.purpose));
        return;
      }
      const sent = await ctx.reply(message.text, { reply_markup: message.reply_markup });
      await store.remember({
        requestId, userId, messageId: sent.message_id,
        purpose: prepared.purpose, expiresAt: prepared.expires_at,
        startUpdateId: ctx.update.update_id,
      });
      log("request_prepared", { update: ctx.update.update_id });
    } catch (error) {
      log("request_prepare_failed", { status: error instanceof SiteApiError ? error.status : 0 });
      await safeReply(ctx, publicError(error));
    }
  });

  target.on("callback_query:data", async ctx => {
    const userId = telegramId(ctx);
    const query = ctx.callbackQuery;
    const telegramUser = ctx.from;
    const queryMessage = "message" in query ? query.message : undefined;
    const match = /^(ok|no):([A-Za-z0-9_-]{43})$/.exec(query.data);
    const receipt = match ? store.receipt(match[2]!) : undefined;
    if (!userId || !telegramUser || !match || !requestIdSchema.safeParse(match[2]).success
      || !receipt || receipt.userId !== userId
      || !queryMessage || queryMessage.message_id !== receipt.messageId
      || queryMessage.chat.type !== "private" || queryMessage.chat.id !== telegramUser.id) {
      await ctx.answerCallbackQuery({ text: "Запрос недействителен или был открыт другим аккаунтом." })
        .catch(() => undefined);
      return;
    }

    const approve = match[1] === "ok";
    await ctx.answerCallbackQuery({ text: approve ? "Проверяю и подтверждаю…" : "Отклоняю запрос…" })
      .catch(() => undefined);
    if (receipt.expiresAt <= Math.floor(Date.now() / 1000)) {
      await ctx.editMessageText("Запрос истёк. Вернитесь на сайт и начните заново.",
        { reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      return;
    }

    try {
      const decision = await api.decide(receipt.requestId, userId, approve);
      const outcome = decision.status === "denied" ? "denied" : "approved";
      await ctx.editMessageText(completedMessage(outcome, botConfig.siteHost, receipt.purpose),
        { reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      log("request_confirmed", { update: ctx.update.update_id, decision: outcome });
    } catch (error) {
      log("request_confirmation_failed", { update: ctx.update.update_id, status: error instanceof SiteApiError ? error.status : 0 });
      const temporaryFailure = error instanceof SiteApiError && (error.status === 429 || error.status >= 500);
      await ctx.editMessageText(publicError(error), temporaryFailure ? undefined
        : { reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
    }
  });

  target.on("message", async ctx => {
    if (!telegramId(ctx) || ctx.message.text?.startsWith("/start")) return;
    await safeReply(ctx, "Для входа откройте сайт " + botConfig.siteHost + " и нажмите «Войти через Telegram».");
  });
}

async function writeHealth(path: string) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), "bot-health.json.tmp");
  await writeFile(temporary, JSON.stringify({ checkedAt: Date.now() }), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function run() {
  const me = await bot.api.getMe();
  const webhook = await bot.api.getWebhookInfo();
  if (webhook.url) throw new Error("A webhook is configured. Remove it deliberately in BotFather/API before enabling long polling.");

  const store = await StateStore.load(config.dataDir, me.id);
  registerHandlers(bot, store, site);
  bot.catch(error => {
    log("update_handler_failed", { update: error.ctx.update.update_id });
    void safeReply(error.ctx, "Не удалось обработать запрос. Вернитесь на сайт и начните заново.");
  });

  log("bot_started", { mode: "long_polling" });
  let backoff = 1000;
  while (!stopping) {
    try {
      const updates = await bot.api.getUpdates({
        offset: store.offset,
        limit: 100,
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      backoff = 1000;
      await writeHealth(config.healthFile);
      for (const update of updates) {
        if (stopping) break;
        await bot.handleUpdate(update);
        await store.acknowledge(update.update_id);
      }
    } catch (error) {
      if (stopping) break;
      if (error instanceof Error && error.name === "GrammyError"
        && error.message.toLowerCase().includes("terminated by other getupdates")) {
        throw new Error("Another bot instance is polling this Telegram token. Keep only one bot container running.");
      }
      log("polling_retry", { delay_ms: backoff });
      await delay(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
  log("bot_stopped");
}

function stop() {
  if (stopping) return;
  stopping = true;
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

run().catch(error => {
  const message = error instanceof Error ? error.message : "";
  const reason = message.includes("Another bot instance") ? "another_poller"
    : message.includes("webhook is configured") ? "webhook_configured"
    : message.includes("username does not match") ? "username_mismatch" : "configuration_error";
  log("fatal_configuration_or_polling_error", { reason });
  process.exitCode = 1;
});
