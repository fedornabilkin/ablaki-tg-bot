# Сервер Telegram-бота и GitHub Actions

Инструкция для Windows PowerShell в терминале PHPStorm и **отдельного Ubuntu/Debian VPS x86_64 с systemd**. Достаточно IP и SSH-доступа администратора. Домен, nginx и входящий HTTP-порт боту не нужны. Блоки выполняются сверху вниз; скрипты останавливаются на ошибке.

Как у фронтенда: отдельный пользователь, фиксированные каталоги, проверенный host key, сборка в GitHub, релиз по SHA, проверка здоровья и откат. На VPS нет checkout приложения, npm или Node.js на хосте.

SSH-пользователь — `deploy`, как при выкладке фронтенда. Его существующие ключи сохраняются; права чтения домашнего каталога не ужесточаются до `700`. Каталоги бота и `.ssh` получают отдельные права.

GitHub можно настроить полностью через браузер: **Settings → Secrets and variables → Actions**. В Repository secrets добавьте `BOT_HOST`, `BOT_PORT`, `BOT_USER=deploy`, `BOT_DEPLOY_PATH=/opt/ablaki-tg-bot`, `BOT_SSH_KEY` (закрытый ключ) и `BOT_KNOWN_HOSTS` (проверенный ключ сервера). В Repository variables добавьте `BOT_DEPLOY_ENABLED=false`. Затем **Actions → Telegram bot → Run workflow**, ветка `master`, `operation=check`. После успешной проверки и остановки локального бота измените переменную на `true` и запустите `operation=deploy`. Поле `check_id` можно оставить пустым. Команды с `gh` ниже — альтернативный способ, они не требуются для настройки через браузер.

| Назначение | Значение |
|---|---|
| Репозиторий | `fedornabilkin/ablaki-tg-bot` |
| Пользователь SSH | `deploy` |
| Каталог | `/opt/ablaki-tg-bot` |
| Релизы | `/opt/ablaki-tg-bot/releases/<SHA>` |
| Секреты приложения | `/opt/ablaki-tg-bot/.env`, владелец `deploy`, права `600` |
| Данные | Docker volume `ablakin-telegram-bot_bot-data`, UID/GID `1000:1000` |
| Публикация | push master собирает образ; сервер запускается только ручным `operation=deploy` |

Пользователь деплоя входит в группу Docker: это доступ уровня root к выделенному VPS. Ключ отдельный, без пароля, с ограничениями `restrict` в `authorized_keys`; не используйте ключ доступа к серверу сайта. SSH/firewall скрипты не перенастраивают, права `777` и общий `sudo NOPASSWD` не используются. [Права Docker](https://docs.docker.com/engine/install/linux-postinstall/).

## 1. До запуска: API и ключ сервера

На backend выбранного окружения должны быть установлены Telegram API и миграции:

- `m261104_120000_telegram_auth`;
- `m261106_120000_telegram_settings`;
- `m261106_140000_telegram_unlink`.

В backend задаётся `TELEGRAM_AUTH_API_KEY` — **тот же** секрет, что у бота. Авторизация включается в админке `/auth-settings/index`. Если код Telegram ещё только в рабочей ветке backend, проверка сервера не заменит его выкладку. Нельзя указывать на VPS `http://127.0.0.1:3180`: это сам VPS, а не ваш компьютер. Нужен доступный этому серверу HTTPS API нужного тестового/боевого окружения. Бот не имеет прямого доступа к БД.

Откройте доверенную web-консоль VPS у хостера. Выполните:

```bash
cat /etc/os-release
uname -m
if [ "$(id -u)" -eq 0 ]; then ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; else sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub; fi
```

Сохраните отпечаток `SHA256:...` из последней строки. Это проверка подлинности сервера, а не пароль. Убедитесь, что SSH-порт доступен извне и из GitHub-hosted runners. Исходящие DNS/HTTPS нужны для Telegram, вашего API, GHCR и загрузки слоёв образа; постоянного IP у обычных GitHub runners нет. Никакие порты контейнера наружу не публикуются.

## 2. Windows: GitHub CLI

В терминале PHPStorm, отдельным блоком (после установки откройте новый терминал):

```powershell
winget install --id GitHub.cli --exact --source winget
```

Затем:

```powershell
Set-Location C:\Users\nolikshpik\Desktop\projects\ablakin\bot
$ErrorActionPreference = 'Stop'
gh auth login --hostname github.com --git-protocol https --web
if ($LASTEXITCODE -ne 0) { throw 'Не выполнен вход в GitHub' }
gh auth status
git status --short
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'Не удалось обновить репозиторий; сохраните локальные изменения' }
```

Войти нужно пользователем с правом настройки Actions secrets этого репозитория. При ограничениях организации разрешите Actions и доступ workflow к GHCR. Пакет `ablaki-tg-bot` должен наследовать права этого репозитория или иметь его в **Package settings → Manage Actions access** с правами чтения/записи. Используется временный `GITHUB_TOKEN`; постоянный PAT на сервере не нужен. [GitHub Container Registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## 3. Windows: параметры, отдельный ключ и проверка сервера

Выполните весь блок. IP, SSH-порт и имя администратора запрашиваются один раз. При генерации нового ключа дважды нажмите Enter на вопрос о passphrase: для GitHub нужен отдельный ключ без пароля. Уже существующий файл ключа не перезаписывается.

```powershell
$Server = Read-Host 'IP сервера бота'
if ($Server -notmatch '^[A-Za-z0-9][A-Za-z0-9.:-]*$') { throw 'Некорректный адрес' }
$PortText = Read-Host 'SSH-порт (Enter = 22)'
$Port = if ($PortText) { [int]$PortText } else { 22 }
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Некорректный порт' }
$Admin = Read-Host 'Администратор SSH (например root или ubuntu)'
if ($Admin -notmatch '^[a-z_][a-z0-9_-]*$') { throw 'Некорректное имя пользователя' }
$ExpectedFingerprint = Read-Host 'SHA256:... из доверенной консоли VPS'
$KeyDir = Join-Path $env:USERPROFILE '.ssh'
New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
$Key = Join-Path $KeyDir 'ablakin-bot-actions'
$KnownHosts = Join-Path $KeyDir 'ablakin-bot-known-hosts'
if (!(Test-Path -LiteralPath $Key)) {
    ssh-keygen -t ed25519 -a 64 -f $Key -C 'ablakin-bot-github-actions'
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось создать SSH-ключ' }
}
# /inheritance:r не удаляет явно заданные права других учётных записей.
$KeyOwnerSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls $Key /inheritance:r /grant:r "*${KeyOwnerSid}:(F)"
if ($LASTEXITCODE -ne 0) { throw 'Не удалось настроить доступ владельца ключа' }
$OtherKeySids = @((Get-Acl -LiteralPath $Key).Access |
    ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } |
    Where-Object { $_ -ne $KeyOwnerSid } | Sort-Object -Unique)
foreach ($OtherKeySid in $OtherKeySids) {
    icacls $Key /remove "*$OtherKeySid"
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось удалить лишние разрешения ключа' }
}
# Windows PowerShell 5.1 считает служебный stderr ssh-keyscan ошибкой.
$ErrorActionPreference = 'Continue'
$Scan = @(ssh-keyscan -T 15 -t ed25519 -p $Port $Server 2>$null)
$ErrorActionPreference = 'Stop'
if (!$Scan.Count) { throw 'SSH недоступен: проверьте IP, порт и firewall' }
$ScanFile = Join-Path $KeyDir 'ablakin-bot-known-hosts.pending'
[IO.File]::WriteAllText($ScanFile, ($Scan -join "`n") + "`n", (New-Object Text.UTF8Encoding($false)))
$Fingerprints = @(ssh-keygen -lf $ScanFile)
if ($LASTEXITCODE -ne 0) { throw 'Не удалось прочитать ключ сервера' }
foreach ($line in $Fingerprints) {
    if (($line -split '\s+')[1] -ne $ExpectedFingerprint.Trim()) { throw 'Отпечаток не совпадает. Не продолжайте подключение к этому адресу.' }
}
Move-Item -LiteralPath $ScanFile -Destination $KnownHosts -Force
$SshOptions = @('-p', "$Port", '-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$KnownHosts")
$Bootstrap = '/tmp/ablakin-bot-setup-' + [guid]::NewGuid().ToString('N')
ssh @SshOptions "$Admin@$Server" "umask 077; mkdir '$Bootstrap'"
if ($LASTEXITCODE -ne 0) { throw 'Нет административного SSH-доступа' }
$ScpHost = if ($Server.Contains(':')) { "[$Server]" } else { $Server }
scp -P $Port -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$KnownHosts" "$Key.pub" docker/server-setup.sh docker/configure-env.sh "${Admin}@${ScpHost}:$Bootstrap/"
if ($LASTEXITCODE -ne 0) { throw 'Не удалось передать файлы настройки' }
$RootPrefix = if ($Admin -eq 'root') { '' } else { 'sudo ' }
ssh -tt @SshOptions "$Admin@$Server" "${RootPrefix}bash '$Bootstrap/server-setup.sh' '$Bootstrap/ablakin-bot-actions.pub' && ${RootPrefix}runuser -u deploy -- bash /opt/ablaki-tg-bot/docker/configure-env.sh"
if ($LASTEXITCODE -ne 0) { throw 'Настройка сервера не завершена' }
```

В конце будут три вопроса: HTTPS API, BotFather token и общий ключ backend. Секреты вводятся скрыто, не попадают в историю команд и GitHub. Повторное заполнение сохраняет предыдущий `.env` рядом с правами `600`. Не копируйте локальный `.env` вслепую: его loopback-адрес не подходит VPS.

Скрипт устанавливает Docker из официального репозитория, если Docker отсутствует. Существующую установку и контейнеры не заменяет. Нужен Compose ≥ 2.30: `.env` передаётся как **raw**, поэтому `$` в ключе не подставляется как переменная. Каталоги и SSH-файлы получают точечных владельцев/права; проверяется новый сеанс пользователя с доступом к Docker. Для нестандартной ОС/архитектуры настройка остановится с объяснением. [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Docker Debian](https://docs.docker.com/engine/install/debian/).

## 4. Записать настройки репозитория

В том же окне PowerShell, где остались `$Server`, `$Port`, `$Key`, `$KnownHosts`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\configure-github.ps1 -Server $Server -Port $Port -KeyPath $Key -KnownHostsPath $KnownHosts
if ($LASTEXITCODE -ne 0) { throw 'Настройка GitHub не завершена' }
```

Скрипт сначала проверяет **тот самый SSH-ключ и пользователя**, которым воспользуется GitHub: без пароля, sudo и интерактивного терминала. После успеха записывает `BOT_HOST`, `BOT_PORT`, `BOT_USER`, `BOT_DEPLOY_PATH`, `BOT_SSH_KEY`, `BOT_KNOWN_HOSTS`. Переменная `BOT_DEPLOY_ENABLED` устанавливается в `false`: проверка разрешена, запуск пока закрыт. BotFather token и ключ API остаются только на VPS и backend. [GitHub CLI secrets](https://cli.github.com/manual/gh_secret_set).

## 5. Итоговая команда «проверить всё»

Из корня репозитория, в том числе из нового терминала:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\check.ps1
```

Команда запускает workflow на **master**, находит именно свой запуск по уникальному идентификатору и ждёт результата. Проверяются сборка/тесты, синтаксис Bash, SSH, права, GHCR, скачивание образа по SHA, Docker/Compose, `.env`, запись/переименование в томе от UID 1000, читаемость состояния и совпадение bot ID, Telegram `getMe`, отсутствие webhook и общий ключ через регистрацию бота в API. Регистрация обновляет публичное имя бота на сайте; пользователей и заявки проверки не создают. `getUpdates` не вызывается, второй бот не запускается, существующий контейнер не останавливается.

Успех: `READY: ...` в Actions и `SUCCESS: check` в терминале. Неверный ключ/права/маршрут API дают ошибку с указанием этапа. Это проверка технической готовности, **не** замена итоговому входу через настоящий чат. Наличие другого poller на вашем компьютере/другом VPS нельзя гарантированно определить без запуска polling; остановите его перед следующим шагом.

## 6. Запустить бота через GitHub

Сначала остановите локальный бот (`Ctrl+C` в его терминале). Если он был запущен фоном, найдите его и остановите только проверенный PID:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
    Where-Object { $_.CommandLine -match '--env-file=../.env dist/main.js' } |
    Select-Object ProcessId, CommandLine
# Подставьте PID именно бота из вывода; не останавливайте все процессы Node.js.
# Stop-Process -Id 12345
```

После успешной проверки и остановки другого экземпляра:

```powershell
gh variable set BOT_DEPLOY_ENABLED --repo fedornabilkin/ablaki-tg-bot --body true
if ($LASTEXITCODE -ne 0) { throw 'Не удалось разрешить выкладку' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\docker\check.ps1 -Operation deploy
```

Релиз повторяет preflight, затем останавливает старый контейнер, запускает новый и ждёт healthcheck. При ошибке возвращает предыдущий образ и Compose; том не удаляет. При самой первой выкладке откатывать некуда — неудачный контейнер останавливается, состояние сохраняется. Нельзя параллельно запускать иной Compose project с тем же токеном. Логи ограничены 3×10 MB. Docker поднимает контейнер после перезагрузки VPS.

Последующие обновления: `git push` → образ; затем та же команда с `-Operation deploy`. Без неё push сервер не меняет. Для изменения `.env` из административной SSH-сессии выполните `sudo -u deploy bash /opt/ablaki-tg-bot/docker/configure-env.sh` (из root: `runuser -u deploy -- bash /opt/ablaki-tg-bot/docker/configure-env.sh`), затем check и deploy. Релизы сохраняются; автоматической очистки образов/тома нет.

## 7. Посмотреть состояние и логи

В SSH-сессии пользователя `deploy`:

```bash
cd /opt/ablaki-tg-bot
export IMAGE_TAG=$(cat .current)
docker compose --env-file /dev/null -f "releases/$IMAGE_TAG/compose.deploy.yaml" ps
docker compose --env-file /dev/null -f "releases/$IMAGE_TAG/compose.deploy.yaml" logs --tail=60 telegram-bot
```

Нужен статус `healthy`, без `another_poller`, `webhook_configured` или повторяющихся ошибок. Затем проверьте вход на сайте. `docker compose config` без `--quiet`/`--no-env-resolution` может вывести секреты — не отправляйте такой вывод в чат. Команда `down -v` удаляет состояние и здесь не нужна.

Если preflight сообщает о старом томе с неверными правами, остановите бот и исправьте **только** этот том (не host-каталоги):

```bash
cd /opt/ablaki-tg-bot
export IMAGE_TAG=$(cat .current)
docker compose --env-file /dev/null -f "releases/$IMAGE_TAG/compose.deploy.yaml" stop telegram-bot
docker run --rm --network none --user 0:0 -v ablakin-telegram-bot_bot-data:/data \
  --entrypoint sh "ghcr.io/fedornabilkin/ablaki-tg-bot:$IMAGE_TAG" \
  -c 'chown 1000:1000 /data; chmod 700 /data; for file in /data/state.json /data/state.json.tmp; do if [ -f "$file" ] && [ ! -L "$file" ]; then chown 1000:1000 "$file"; chmod 600 "$file"; fi; done'
docker compose --env-file /dev/null -f "releases/$IMAGE_TAG/compose.deploy.yaml" up -d --no-build --wait
```

Если это первый запуск и `.current` ещё отсутствует, используйте точный SHA проверенного образа из Actions вместо `$(cat .current)`. Состояние от другого bot ID не исправляется chmod: для другого токена нужен отдельный том или восстановление подходящего состояния, а не удаление файла наугад.
