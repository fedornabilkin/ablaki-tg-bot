import type { Config } from "./config.js";
import type { Prepared } from "./site-api.js";

export type Decision = "approved" | "denied";

function description(request: Prepared, config: Config): string {
  const action = request.purpose === "link" ? "подключение Telegram к аккаунту" : "вход на сайт";
  const name = config.siteName.replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);
  return [
    name + " · " + config.siteHost,
    "",
    "Запрошено " + action + ".",
    "Код сравнения: " + request.display_code,
    "",
    "Сравните код с кодом во вкладке сайта. Если вы его не запрашивали или коды не совпадают, нажмите «Отказать».",
    "",
    "После подтверждения сайт обновится автоматически. Перейти по ссылке из этого чата не потребуется.",
  ].join("\n");
}

export function approvalMessage(request: Prepared, config: Config) {
  return {
    text: description(request, config),
    reply_markup: { inline_keyboard: [[
      { text: "✅ Подтвердить", callback_data: "ok:" + request.id },
      { text: "✖️ Отказать", callback_data: "no:" + request.id },
    ]] },
  };
}

export function completedMessage(decision: Decision, siteHost: string, purpose: Prepared["purpose"]): string {
  if (decision === "denied") return "Запрос отклонён. Сайт не выполнит вход.";
  if (purpose === "link") return "Telegram подключён к аккаунту. Вернитесь во вкладку сайта.";
  return "Вход подтверждён на " + siteHost + ". Вернитесь во вкладку сайта: она войдёт автоматически.";
}
