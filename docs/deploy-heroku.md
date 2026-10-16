# Deploying on Heroku

The bot keeps a permanent connection to Discord and serves no web traffic, so on Heroku it runs as a
**worker** dyno (never `web`: web dynos must answer HTTP on `$PORT` within 60 s, and Eco web dynos
sleep after 30 minutes without web traffic, which takes the bot offline).

The repository's `Procfile` defines:

```
release: npx prisma migrate deploy && node dist/scripts/register-commands.js   # every deploy: tables + slash commands
worker: node dist/src/index.js         # the bot
```

The Node.js buildpack installs dependencies, generates the Prisma client and runs `npm run build`.

## 1. Add-ons (Resources tab)

| Add-on                         | Sets config var | Why                                                 |
| ------------------------------ | --------------- | --------------------------------------------------- |
| Heroku Postgres                | `DATABASE_URL`  | Moderation records, schedules, settings, Bible text |
| Heroku Key-Value Store (Redis) | `REDIS_URL`     | Job queue for mute expirations and scheduled posts  |

CLI equivalent:

```bash
heroku config:unset DATABASE_URL -a <app>          # only if you set it by hand earlier
heroku addons:create heroku-postgresql:essential-0 -a <app>
heroku addons:create heroku-redis:mini -a <app>
```

Heroku's Redis uses a self-signed TLS certificate; the bot detects Heroku (`DYNO`) and accepts it.
Override with `REDIS_TLS_REJECT_UNAUTHORIZED=true|false` if needed.

## 2. Config vars (Settings → Config Vars)

Required:

| Key                         | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| `DISCORD_TOKEN`             | Bot token (Developer Portal → Bot)                      |
| `DISCORD_CLIENT_ID`         | Application ID (Developer Portal → General Information) |
| `DATABASE_URL`, `REDIS_URL` | Set by the add-ons — do not type them yourself          |

Do **not** set `HEALTH_PORT` or a `localhost` `DATABASE_URL`/`REDIS_URL` on Heroku.
Everything else is optional; defaults are listed in `.env.example`.

## 3. Dynos (Resources tab)

After the first deploy that includes the `Procfile`: turn **web off** and **worker on**.

```bash
heroku ps:scale web=0 worker=1 -a <app>
```

## 4. One-time setup: Bible import

```bash
heroku run bash -a <app>
curl -fsSL -o /tmp/biblia.json \
  https://raw.githubusercontent.com/Dancrf/biblia-db/c5feefffc2d940efa7b11c49445c52ea1426d6a4/biblia.json
node dist/scripts/import-bible.js --source /tmp/biblia.json \
  --revision c5feefffc2d940efa7b11c49445c52ea1426d6a4 --rights-status unverified
exit
heroku ps:restart worker -a <app>
```

Slash commands are registered automatically by the `release` phase on every deploy (the release
log shows `N comando(s) registrado(s)`). Global commands can take a few minutes to appear; press
Ctrl+R in Discord. To register by hand: `heroku run node dist/scripts/register-commands.js -a <app>`.

## 5. Check

```bash
heroku logs --tail -a <app>
```

Expected: `Edição bíblica carregada` and `Bot conectado`. Common failures:

| Log                                            | Cause                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Configuração inválida: - DISCORD_CLIENT_ID …` | Missing/invalid config var (the message names it)                                            |
| `Can't reach database server at localhost`     | `DATABASE_URL` points to localhost instead of Heroku Postgres                                |
| `ECONNREFUSED 127.0.0.1:6379`                  | No Redis add-on (`REDIS_URL` missing)                                                        |
| `Error R10 (Boot timeout)`                     | Running as a `web` dyno — switch to `worker`                                                 |
| `TokenInvalid` / `Used disallowed intents`     | Wrong token, or Message Content / Server Members intents not enabled in the Developer Portal |

Run exactly one worker dyno: two would answer every message twice.
