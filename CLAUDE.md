# VeritasBot — project instructions

Portuguese-speaking Roman Catholic Discord bot (TypeScript, discord.js 14, PostgreSQL/Prisma 6, Redis/BullMQ 5, Zod 4, Luxon, Vitest).
Engineering text in English; everything users see on Discord in Portuguese (pt-BR default).

## Commands

- `npm run typecheck` · `npm run lint` · `npm run format` · `npm run build`
- `npm test` — unit tests always; integration tests run only with `TEST_DATABASE_URL` set (they `migrate deploy` it and TRUNCATE tables — use a throwaway DB).
- Optional real-corpus test: `BIBLE_SOURCE_PATH=data/bible/biblia.json`.
- `npm run db:migrate` (deploy) / `npm run db:migrate:dev -- --name x` (new migration)
- `npm run bible:import -- --source <biblia.json> --revision <sha> --rights-status unverified`
- `npm run references:import [-- --document ccc|cic] [--ccc-dir … --cic-pdf …] [--dry-run]` — Catechism (vatican.va) + Code of Canon Law (CEP PDF).
- `npm run commands:register` after changing any slash-command definition.
- `npm run liturgy:smoke` — live check of external APIs (network required; not part of CI).

## Layout

`src/modules/<area>/{domain,application,providers,commands,events}`; handlers stay thin, logic lives in services
that don't import discord.js (tests use fakes: `InMemoryJobScheduler`, fake gateways/senders, `fakeFetch`).
`src/bot/commands.ts` lists every slash command; `src/index.ts` wires everything.

## Invariants (do not break)

- Never invent Scripture, liturgy, saints, ranks or dates. Missing/invalid → say so in Portuguese.
- Bible text comes only from the imported edition (`BibleEdition`/`BibleVerse`). Source gaps are reported, never filled.
- Matos Soares Psalms use **Vulgate numbering**; conversion from Hebrew numbering only when 1:1.
- Text from Liturgia Diária (Dancrf) is labelled as that provider's text, never as Matos Soares.
- Saints come from LitCal (no pt locale, no BR/PT national calendar) — always labelled with calendar + language.
- Liturgical texts are cached in memory only; Postgres stores just metadata (`LiturgyDaySummary`).
- External JSON is untrusted: validate with Zod, escape with `escapeDiscord`, send with `allowedMentions: { parse: [] }`.
- Always request liturgy with explicit `dia/mes/ano`; compute "hoje" in the guild timezone (`localDate`).
- Every guild-owned row is filtered by `guildId`. Privileged commands check permissions server-side (`requireMemberPermission` / `checkModerationHierarchy`), not only via `default_member_permissions`.
- Native Discord timeout ≤ 28 days; longer mutes use the muted role and must refuse Administrator targets.
- `mo`/`y` durations and monthly/yearly schedules are calendar arithmetic in an IANA zone (Luxon), never 30/365 days.
- Postgres is the source of truth for schedules/mutes; BullMQ job IDs are deterministic; handlers re-validate DB state. Use `safeJobId` (no `:`).
- Scheduled delivery is effectively-once: unique (schedule, occurrenceKey) + `partsSent` + Discord nonce per part.
- Catechism/Code text: only from `ReferenceText` (imported from vatican.va / the CEP PDF), never committed; on demand only (≤ 5 units), always with edition + rights footer and official link. CCC/CIC = Catecismo; CDC/cân. = Código.
- Dates the Liturgia Diária API lacks (it covers 2024–2027) are served from an EQUIVALENT date (same Brazilian celebration + A/B/C + I/II cycles, `src/modules/liturgy/equivalence/`), always labelled via `day.equivalent`; no equivalent → say so. Before 1970 → `PRE_1970_MESSAGE` (traditional calendar not implemented), never apply ordinary-form rules.
- 1962 calendar is a separate provider; never mix with ordinary-form rules or the Dancrf API.
