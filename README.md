# Telegram-бот Аблакина

Node.js 26, TypeScript, grammY и Zod. Приложение целиком находится в `project/`; Docker, Compose, env и GitHub Actions — в корне репозитория.

Пользователь открывает бота с сайта, сравнивает шестизначный код и подтверждает вход кнопкой в чате. Сайт сам завершает вход. Дополнительной ссылки для возврата нет. Бот проверяет отправителя и личный чат, сохраняет заявки и offset; повторное нажатие не создаёт второй аккаунт.

## Только три переменные

Скопируйте `.env.example` в `.env` и заполните:

| Переменная | Значение |
| --- | --- |
| TELEGRAM_BOT_TOKEN | Токен из @BotFather. Только для бота. |
| ABL_API_BASE_URL | Корень API. Для текущей локалки в Docker: `http://host.docker.internal:3180`. Для отдельного сервера — HTTPS адрес API сайта. |
| TELEGRAM_AUTH_API_KEY | Общий секрет с backend, минимум 32 символа. Это не BotFather token. |

Имя бота определяется через Telegram getMe и регистрируется в API сайта при запуске. Название сайта и отображаемый домен возвращает API. Polling, пути хранения и остальные параметры заданы в коде. Домен и входящие порты для сервера бота не нужны.

В backend env остаётся только `TELEGRAM_AUTH_API_KEY`. Примените миграции `m261104_120000_telegram_auth` и `m261106_120000_telegram_settings`. Переключатель находится в админке: «Настройки авторизации», адрес `/auth-settings/index`, доступ с правом `p-admin`. Он включён по умолчанию; вход становится доступен после подключения реального бота. Повторный запуск бота не меняет решение администратора.

## Локальный запуск в Docker

Нужны Docker Engine/Desktop с Linux-контейнерами и Compose. Запустите локальный backend на порту 3180. Из корня `bot`:

```powershell
docker compose up -d --build
docker compose logs --tail=50 -f telegram-bot
```

Контейнер сам собирает `project`, работает без root и хранит заявки в именованном томе `bot-data`. Для остановки: `docker compose down`. Не удаляйте том, если нужно сохранить незавершённые заявки. Только один работающий бот на токен.

Для запуска без Docker замените endpoint в `.env` на `http://127.0.0.1:3180`, затем:

```powershell
npm ci --prefix project
npm run dev --prefix project
```

## GitHub Actions и отдельный сервер

Push в master проверяет TypeScript и публикует образ в GHCR. Выкладка VPS выполняется отдельно через Run workflow с `deploy=true`; дополнительно требуется переменная Actions `BOT_DEPLOY_ENABLED=true`. Во время локальной разработки push не выкатывает production.

На VPS установите Docker/Compose и положите `.env` в каталог развёртывания с правами 600. Настройте Actions secrets: `BOT_HOST` (IP), `BOT_PORT` (22), `BOT_USER`, `BOT_DEPLOY_PATH`, `BOT_SSH_KEY`, `BOT_KNOWN_HOSTS`. Публичный SSH-ключ добавьте пользователю сервера. Host key проверьте через консоль VPS перед добавлением в known_hosts.

Workflow передаёт `compose.deploy.yaml` как серверный `compose.yaml`, получает образ с SHA коммита и ждёт здорового контейнера. Для приватного GHCR используется краткоживущий GITHUB_TOKEN. Токен Telegram и общий ключ хранятся только в серверном `.env`, в workflow они не передаются.

Для ручного запуска готового образа после входа в GHCR: `docker compose -f compose.deploy.yaml up -d`. Приложение обращается только к Telegram и API сайта, прямого доступа к базе нет.
