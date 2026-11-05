# Telegram-вход для Аблакина

Это отдельный TypeScript-бот на Node.js 24 с grammY и Zod. Бот принимает заявку в личном чате, сверяет код с API сайта и показывает inline-кнопки «Подтвердить» и «Отказать». После подтверждения исходная вкладка сайта сама завершит вход. Обратной ссылки в чате нет.

Бот обращается только к Telegram Bot API и HTTPS API сайта. Он не подключается к базе сайта и не получает токен пользовательской сессии. Пересланная заявка не подходит другому Telegram-пользователю.

## Настройки

Создайте локальный приватный .env на основе .env.example. Не сохраняйте заполненный .env в GitHub.

| Переменная | Что указать |
| --- | --- |
| TELEGRAM_BOT_TOKEN | Создать бота в @BotFather через /newbot. Токен остаётся только на сервере бота. |
| TELEGRAM_BOT_USERNAME | Точное имя бота без @. Это же имя указать в TELEGRAM_BOT_USERNAME на API сайта. |
| ABL_API_BASE_URL | HTTPS API сайта, сейчас https://api.ablakin.ru. Это адрес сайта, не IP бота. |
| TELEGRAM_AUTH_API_KEY | Тот же общий секрет, что в TELEGRAM_AUTH_API_KEY на backend API. Подготовленная приватная заготовка находится в back/.env.telegram-bot. |
| ABL_SITE_URL / ABL_SITE_NAME | HTTPS адрес и название сайта для сообщения подтверждения. |
| TELEGRAM_UPDATES_MODE | Оставить polling. Домен и webhook боту не нужны. |

BotFather token и общий TELEGRAM_AUTH_API_KEY — разные секреты. Не отправляйте их друг другу, не помещайте в VITE_ настройки и не пишите в журналы. Веб-сайту и контейнеру секреты передаются только через приватные env файлы.

## Подключение сайта

1. Создайте бота в @BotFather и заполните username/token.
2. Убедитесь, что миграция сайта установлена, API доступен по HTTPS, username совпадает, а TELEGRAM_AUTH_API_KEY одинаков на сайте и боте.
3. Запустите ровно один экземпляр. При старте бот проверит свой username и остановится, если для этого токена установлен webhook.
4. Пройдите настоящий вход, отказ, таймаут и привязку к существующему аккаунту. Затем отдельно включите TELEGRAM_AUTH_ENABLED=1 на backend и обновите окружение API. При значении 0 сайт показывает, что вход пока недоступен.
5. Если API знает исходящий публичный IP VPS, можно дополнительно задать TELEGRAM_AUTH_BOT_IPS. IP фильтр не заменяет общий секрет.

## Локальный запуск

Установите Node.js 24, скопируйте .env.example в приватный .env, укажите рабочий BotFather token и username, затем в PowerShell:

~~~
cd C:\Users\nolikshpik\Desktop\projects\ablakin\bot
npm ci
npm run dev
~~~

Для настоящего входа всё равно нужны публичный HTTPS API сайта, одинаковый API secret на обеих сторонах и включённый на сайте способ входа.

## Запуск в Docker

На сервере установите Docker Engine и Compose plugin. Создайте каталог для compose.yaml, приватного .env и постоянной папки data. У Docker пользователю deploy необходимы права на управление контейнерами.

Установите секретный .env с правами 600, затем выполните:

~~~
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml logs --tail=50 -f telegram-bot
~~~

Контейнер работает без root, использует read-only filesystem и отдельный постоянный том для polling offset и текущих заявок. Нужен один контейнер на Telegram token.

## Сборка и автоматическая выкладка

Workflow находится в .github/workflows/deploy.yml. Pull request выполняет npm ci и сборку TypeScript. Push в master и ручной workflow публикуют в GitHub Container Registry два тега: SHA коммита и latest. SSH выкладка VPS включается только после настройки BOT_DEPLOY_ENABLED и секретов ниже.

Создайте отдельную пару SSH ключей на компьютере администратора:

~~~
ssh-keygen -t ed25519 -C ablakin-telegram-bot-deploy -f bot-deploy-key
~~~

Публичный ключ добавьте в authorized_keys пользователя deploy на VPS. Приватный ключ добавьте в GitHub → Settings → Secrets and variables → Actions. Создайте секреты:

- BOT_HOST — IP сервера.
- BOT_PORT — SSH порт, обычно 22.
- BOT_USER — имя deploy пользователя.
- BOT_DEPLOY_PATH — абсолютный каталог compose, например /opt/ablakin-telegram-bot.
- BOT_SSH_KEY — закрытая часть bot-deploy-key.
- BOT_KNOWN_HOSTS — закреплённый SSH ключ сервера из ssh-keyscan. До сохранения сравните fingerprint с консолью VPS. Для нестандартного порта используйте формат [IP]:PORT.

В Actions → Variables создайте BOT_DEPLOY_ENABLED со значением true. До этого Docker образы будут собираться и публиковаться, VPS обновляться не будет.

Проверьте ручной запуск compose на VPS и создайте заполненный приватный .env. После добавления GitHub параметров запустите Telegram bot → Run workflow для первой выкладки. Следующие push в master опубликуют новый образ, передадут VPS краткоживущий GITHUB_TOKEN для docker pull и перезапустят контейнер с точным SHA. Workflow копирует compose.yaml, читает существующий серверный .env и очищает вход GHCR после deploy. BotFather token и общий API key не копируются через workflow.

GHCR образ приватный. Для сборки секрет BotFather не нужен. Для HTTPS long polling серверу нужны исходящие соединения к Telegram и API сайта, публичного домена у сервера бота может не быть.

## Файлы

- src/main.ts — long polling, /start и обработка inline callback.
- src/site-api.ts — HTTPS вызовы bot/prepare и bot/confirm.
- src/state.ts — атомарное сохранение offset и заявок на диске.
- src/config.ts — проверка переменных окружения.
- src/messages.ts — сравнение кода и сообщения бота.
- Dockerfile и compose.yaml — образ и один защищённый сервис.
- .github/workflows/deploy.yml — CI, GHCR и включаемая SSH выкладка.

Полный API контракт сайта: back/docs/architecture/telegram-auth.md.
