# Architecture

Modular monolith. One Node.js process hosts the Discord gateway client, the BullMQ worker and a `/health`
endpoint. PostgreSQL is the source of truth; Redis only wakes the process at the right time.

```
src/
  index.ts                 wiring, intents, graceful shutdown, reconciliation every 10 min
  app/                     AppContext, health server
  bot/                     command list, interaction router, guards, Bible embeds
  config/env.ts            Zod-validated environment
  jobs/                    JobScheduler interface, BullMQ + in-memory implementations
  modules/
    bible/                 catalog (73 books), parser, in-memory provider, importer, quotation matcher, /biblia, messageCreate
    liturgy/               Liturgia Diária v2/v3 adapters, service + cache, embeds, daily-post composer, /liturgia, /calendario
    calendar/              computus + General Roman Calendar rules, LitCal client + SaintsService, 1962 stub
    moderation/            durations, hierarchy rules, MuteService, Discord gateway, mod-log, commands, member events
    scheduling/            recurrence, ScheduleService, DeliveryService, renderer, Discord sender, /agendar
    guild-settings/, audit/
  shared/                  Discord text safety, dates, embed packing, logger, text normalization
```

Services never import discord.js (except explicit gateway/sender adapters), so they are unit-testable with fakes.

## Decision records

### ADR-1 — Bible corpus: Matos Soares from `Dancrf/biblia-db`

- The link originally supplied (`httpassoca/biblia-matos-soares-api`) returned 404 / no access. `Dancrf/biblia-db`
  (`biblia.json`, 73 books, revision `c5feefff…`, SHA-256 `ae10ca8d…`) describes itself as the 1956 Matos Soares translation.
- The importer validates structure with Zod, maps source book names to canonical IDs, checks chapter counts,
  keeps text verbatim (NFC + trim only) and writes an anomaly report. The verified revision has **216 numbering
  anomalies** (194 gaps such as Gn 15,4 and 3Jo 1,3; 17 duplicate numbers with different text, e.g. Os 10,15 filed as
  Os 11,1; 5 identical duplicates dropped). The bot reports gaps to users and never fills them.
- Whole edition (~35.6k verses) is loaded into memory at start; lookups are deterministic and offline.
- Rights status is recorded per edition (`unverified` by default). See `data-sources-and-rights.md`.

### ADR-2 — Reference recognition

Deterministic regex over an accent-folded copy of the text (length-preserving, so indices map back to the original).
Requires book + chapter + verse in automatic mode; ambiguous lowercase aliases (`os`, `na`, `mal`, `at`, `is`, …)
only count when capitalized; `Jó` vs `Jo` decided from the original accent; numbered books (`1 João`) win over plain
ones; fenced/inline code is blanked out. Dedupe by message ID and per-channel cooldown prevent spam.

### ADR-3 — Mutes

- ≤ 28 days → native Discord timeout (`communication_disabled_until`). > 28 days → muted role.
- Role mutes are refused for Administrator targets and when the role is above the bot; after applying, the bot
  counts channels where the member can still send and warns (no false guarantees).
- New mute supersedes the active one (status `SUPERSEDED`); release jobs re-read the row and no-op unless it is still
  `ACTIVE` and due. Release claims the row with a conditional update (no double release).
- Restart: `reconcile()` releases overdue mutes and re-enqueues active ones; also runs every 10 minutes.
- Rejoin re-applies the role; manual removal in Discord (timeout cleared / role removed) closes the record.

### ADR-4 — Scheduling

- Definition stored as local wall time `startLocal` + IANA `timezone` + recurrence; only the **next** occurrence is
  enqueued. Monthly/yearly occurrences are computed from the anchor (31 Jan → 28 Feb → 31 Mar; 29 Feb returns in leap years).
- **DST policy:** a non-existent local time (spring forward) moves forward by the gap (Lisbon 01:30 → 02:30);
  a repeated local time (fall back) uses the first occurrence.
- **Effectively-once:** `ScheduledDelivery` is unique on (schedule, occurrenceKey); multi-message posts record
  `partsSent` after each part and resume from there; each part carries a deterministic Discord `nonce` with
  `enforce_nonce`, so a retry right after an ambiguous network failure is de-duplicated by Discord. A crash between
  Discord accepting a message and the row update can still, in rare cases older than Discord's nonce window,
  produce a duplicate — exact-once is impossible without a Discord-side transaction.
- Edits/pauses change `nextOccurrenceKey`; stale jobs see the mismatch and do nothing. Advancing is a conditional
  update on the current key.
- Missed occurrences (outage): delivered late within `SCHEDULE_MISSED_GRACE_MINUTES` (default 360), else recorded
  `SKIPPED` and the schedule advances.
- Permanent Discord errors (unknown channel, missing access/permissions) → schedule `ERROR` + mod-log notice;
  `/agendar retomar` resumes. Transient errors → BullMQ retries with backoff.
- Mentions: `allowedMentions.parse = []`; only roles explicitly chosen by the admin are pinged; @everyone never.
- Drafts are previewed (with real rendering) and only enqueued after **Ativar**.

### ADR-5 — Liturgy providers

- **Liturgia Diária v2 (stable, default)** and **v3 (beta, feature-flagged)** have separate Zod schemas and
  normalizers into one `LiturgicalDay` model (ordered readings with all alternative options; v2 Easter-Vigil extras
  appended after the Gospel because v2 doesn't give their position).
- Always `?dia=DD&mes=MM&ano=YYYY`; `periodo` is never used (it starts at the server's date and caps at 7).
  A response whose `data` differs from the requested date is rejected.
- HTTP: timeout, streamed size limit, ≤3 attempts on 429/5xx/network with exponential backoff + jitter, honours
  `Retry-After` (capped); 404 = "not found", never retried.
- In-memory LRU cache (past dates 24 h, current/future 6 h, 404 1 h) + in-flight de-duplication.
  Postgres stores only metadata (`LiturgyDaySummary`: name, colour, hash).

### ADR-6 — Saints of the day (LitCal)

- Source: Liturgical Calendar API (`Liturgical-Calendar/LiturgicalCalendarAPI`, Apache-2.0). Schema verified from the
  project's `jsondata/schemas/LitCal.json`/`openapi.json` and golden-master fixtures (commit `e2846cb`).
- One request per (calendar, locale, civil year) with `year_type=CIVIL` (the API default is the liturgical year),
  cached 24 h. Events are selected by their `year/month/day` fields; `is_vigil_mass` events are excluded;
  grade 0 (ferias) hidden; optional memorials configurable.
- Limitations surfaced to users: names come in la/en/it/fr/nl (no Portuguese upstream); national calendars available
  are CA, HR, IT, NL, US (no Brazil/Portugal) — the footer says national calendars may differ.
- The daily post combines Dancrf (Portuguese readings) and LitCal (saints) for the **occurrence's local civil date**
  (or the next day with `vespera`). If a provider is down it retries the job twice, then posts a truthful notice.

### ADR-7 — Calendar engine

Own deterministic computus and season/week/cycle rules (General Roman Calendar, ordinary form) with an explicit
`unsupported` list. Displayed next to — not instead of — the provider's celebration. See `calendar-roadmap.md`.

## Operations

- Env validated at boot (`src/config/env.ts`); secrets only via environment.
- Logs: pino JSON; message content is never logged.
- Graceful shutdown on SIGTERM/SIGINT: stop timers, close worker/queue, destroy client, disconnect DB/Redis.
- Health: `/health` reports Discord gateway, DB, Redis, Bible loaded (503 if any false).
