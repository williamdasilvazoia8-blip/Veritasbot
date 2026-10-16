# VeritasBot

Discord bot for Portuguese-speaking Roman Catholic communities.

| Feature                                                                                                                                              | Status                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Automatic Bible references in ordinary messages (`João 3:16`, `1 Cor 13,4-7`, …) — Pe. Manuel de Matos Soares                                        | ✅ working (requires corpus import)                                       |
| `/biblia passagem · buscar · livro · aleatorio · configuracao`                                                                                       | ✅                                                                        |
| Pasted-quotation identification (n-gram matching)                                                                                                    | ✅ implemented, **off by default**                                        |
| Daily liturgy — Liturgia Diária API **v2** (`/liturgia …`)                                                                                           | ✅ (v3 beta adapter behind `LITURGIA_V3_ENABLED`)                         |
| Saints of the day — Liturgical Calendar API (LitCal) (`/calendario santos`)                                                                          | ✅ (Latin/English/Italian/French/Dutch names; no BR/PT calendar upstream) |
| Scheduled daily post: readings (references / Gospel / all) + saints, for the real local date                                                         | ✅ `/agendar liturgia`                                                    |
| Liturgical calendar: computus, seasons, weeks, A/B/C & I/II cycles (`/calendario …`)                                                                 | ✅ foundation; no precedence engine yet                                   |
| Moderation: `/mute` (s, min, h, d, sem, mo, y), `/unmute`, `/mute-status`, `/kick`, `/ban`, `/unban`, `/purge`, `/modlogs`, `/configurar-silenciado` | ✅                                                                        |
| Scheduled & recurring announcements `/agendar criar · listar · ver · editar · cancelar · pausar · retomar`                                           | ✅                                                                        |
| 1962 calendar                                                                                                                                        | 📝 design only (`docs/calendar-roadmap.md`)                               |

## 1. Discord application setup

1. <https://discord.com/developers/applications> → **New Application**.
2. **Bot** tab → _Reset Token_ → put it in `DISCORD_TOKEN`. Copy the **Application ID** to `DISCORD_CLIENT_ID`.
3. **Bot → Privileged Gateway Intents**: enable **Message Content Intent** (needed to read `João 3:16` in ordinary
   messages) and **Server Members Intent** (re-apply long mutes on rejoin, detect manual unmutes).
   Bots in 100+ servers must apply for these intents during verification.
4. Invite URL (**OAuth2 → URL Generator**): scopes `bot` + `applications.commands`; permissions:
   View Channels, Send Messages, Send Messages in Threads, Embed Links, Read Message History,
   Moderate Members, Kick Members, Ban Members, Manage Messages, Manage Roles, Manage Channels
   (the last two only for `/configurar-silenciado`). Administrator is **not** needed.
5. Place the bot's role **above** the roles it must moderate and above the muted role.

## 2. Run locally

```bash
cp .env.example .env            # fill DISCORD_TOKEN / DISCORD_CLIENT_ID (and DISCORD_GUILD_ID for dev)
npm ci
docker compose up -d postgres redis
npm run db:migrate
# Bible corpus (see docs/data-sources-and-rights.md before using it publicly)
git clone --depth 1 https://github.com/Dancrf/biblia-db /tmp/biblia-db
npm run bible:import -- --source /tmp/biblia-db/biblia.json \
  --revision "$(git -C /tmp/biblia-db rev-parse HEAD)" --rights-status unverified
npm run commands:register       # guild-scoped if DISCORD_GUILD_ID is set, global otherwise
npm run dev                     # or: npm run build && npm start
```

Health: `GET http://localhost:8080/health` → `{ ok, discord, database, redis, bibleLoaded }`.

## 3. Tests

```bash
npm run typecheck && npm run lint
npm test                                                      # unit tests
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/veritas_test npm test   # + integration (throwaway DB!)
BIBLE_SOURCE_PATH=/tmp/biblia-db/biblia.json TEST_DATABASE_URL=… npm test            # + real-corpus check
npm run liturgy:smoke -- America/Sao_Paulo                    # live API check (network)
```

## 4. Deploy

**Google Cloud:** see [`docs/deploy-google-cloud.md`](docs/deploy-google-cloud.md). It recommends one
Compute Engine VM running `docker compose`. App Engine and default Cloud Run settings scale to zero,
which breaks the permanent Discord connection.

Anywhere with Docker: `docker compose --profile bot up -d --build` runs PostgreSQL, Redis and the bot.
The bot container applies pending migrations on start. Import the Bible once with
`docker compose --profile bot run --rm -v <biblia.json>:/data/biblia.json:ro bot node dist/scripts/import-bible.js --source /data/biblia.json …`.
Run **exactly one** bot instance: a second one would answer every message twice.

## 5. Using it (admins)

- `/config fuso fuso:Europe/Lisbon` — guild timezone (drives "hoje", schedules, `mo`/`y` mutes).
- `/biblia configuracao` — auto-references on/off, channels, cooldown, Psalm numbering, quotation detection.
- `/liturgia configuracao calendario_romano:… idioma_calendario:…` — LitCal calendar and saint-name language.
- `/agendar liturgia canal:#liturgia hora:07:00 leituras:gospel santos:true` — daily post with the summary,
  the Gospel text and the saints for that day's real local date (`vespera:true` posts tomorrow's in the evening).
  A preview appears first; nothing is scheduled until you press **Ativar**.
- `/modlogs canal:#mod-log` and `/configurar-silenciado` before using mutes longer than 28 days.

More: `docs/architecture.md`, `docs/data-sources-and-rights.md`, `docs/calendar-roadmap.md`.
