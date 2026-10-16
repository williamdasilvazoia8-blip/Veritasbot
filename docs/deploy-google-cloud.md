# Deploying on Google Cloud

## Why not App Engine / a default Cloud Run service

A Discord bot keeps **one permanent WebSocket connection** to the Discord gateway and runs timers
(mute expirations, scheduled posts). It does not answer HTTP requests.

- **App Engine standard** and a **default Cloud Run service** scale to zero and throttle CPU between HTTP
  requests. The bot would disconnect, miss messages and miss scheduled posts.
- Run **exactly one instance**. Two instances = two gateway connections = every `João 3:16` answered twice
  (message de-duplication is per process).
- The bot also needs **PostgreSQL** and **Redis**.

Recommended: **one Compute Engine VM running `docker compose`** (bot + PostgreSQL + Redis).
It is the simplest setup and an `e2-micro` in `us-central1`, `us-east1` or `us-west1` is covered by
the Google Cloud free tier (one instance per billing account, 30 GB standard disk).
Discord's servers are in the US, so a US region is fine for latency.

## The error in the console ("Falha ao ativar as APIs necessárias")

Enabling APIs fails almost always because the project has **no billing account linked**, or your
account lacks permission to enable services (needs Owner/Editor or `Service Usage Admin`).

1. Console → **Faturamento** (Billing) → link a billing account to project `veritasbot-511814`.
   The free tier still requires a billing account.
2. Then enable the API you need. For the VM route only Compute Engine is needed:
   ```bash
   gcloud config set project veritasbot-511814
   gcloud services enable compute.googleapis.com
   ```
   (The Cloud Run route additionally needs `run`, `cloudbuild`, `artifactregistry`, `sqladmin`… — not needed here.)

## Option A (recommended) — Compute Engine VM + docker compose

Run these in **Cloud Shell** (the `>_` icon in the console).

```bash
gcloud compute instances create veritasbot \
  --zone=us-central1-a --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard
gcloud compute ssh veritasbot --zone=us-central1-a
```

On the VM:

```bash
# 2 GB swap: e2-micro has 1 GB RAM; building the image needs more.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker + git
curl -fsSL https://get.docker.com | sudo sh
sudo apt-get install -y git
sudo usermod -aG docker "$USER" && newgrp docker

# Code (private repo: use a GitHub personal access token as the password, or a deploy key)
git clone -b claude/clever-clarke-uvq3rb https://github.com/williamdasilvazoia8-blip/Veritasbot.git
cd Veritasbot
cp .env.example .env
nano .env        # set DISCORD_TOKEN and DISCORD_CLIENT_ID (DATABASE_URL/REDIS_URL are set by compose)

# Build and start PostgreSQL, Redis and the bot (migrations run automatically on start)
docker compose --profile bot up -d --build

# Import the Bible once (see docs/data-sources-and-rights.md)
git clone --depth 1 https://github.com/Dancrf/biblia-db /tmp/biblia-db
docker compose --profile bot run --rm -v /tmp/biblia-db/biblia.json:/data/biblia.json:ro bot \
  node dist/scripts/import-bible.js --source /data/biblia.json \
  --revision "$(git -C /tmp/biblia-db rev-parse HEAD)" --rights-status unverified

# Register slash commands (global; set DISCORD_GUILD_ID in .env for instant per-server registration)
docker compose --profile bot run --rm bot node dist/scripts/register-commands.js

# Restart so the bot loads the imported Bible, then watch the logs
docker compose --profile bot restart bot
docker compose logs -f bot
```

You should see `Edição bíblica carregada` and `Bot conectado`.

Updating later:

```bash
cd ~/Veritasbot && git pull && docker compose --profile bot up -d --build
```

Notes:

- PostgreSQL and Redis listen only on `127.0.0.1`, and the VM firewall only opens SSH by default.
  Nothing needs to be exposed to the internet.
- All three containers have `restart: unless-stopped` and Docker starts on boot, so the bot survives VM reboots.
- Backups: `docker compose exec postgres pg_dump -U postgres veritasbot > backup.sql` (or schedule disk snapshots).
- If the e2-micro is too tight (watch `free -m`), stop the VM and change the machine type to `e2-small`.

## Option B — staying on Cloud Run

Possible, but with more moving parts and cost:

- Use a **worker pool** (the "Pools de workers" entry in the Cloud Run menu; built for non-HTTP background
  work) with **1 instance**. Or use a service with **min instances = 1, max instances = 1** and CPU always
  allocated (instance-based billing). The bot listens on `$PORT` for `/health`, so a service starts correctly.
- External **PostgreSQL** (Cloud SQL, or a hosted provider) and **Redis** (Memorystore needs VPC access;
  a hosted Redis also works). Set `DATABASE_URL` and `REDIS_URL` as environment variables/secrets.
- Put `DISCORD_TOKEN` in **Secret Manager**.
- Migrations run on container start. The Bible import must be run once from a machine that can reach the
  database (e.g. Cloud Shell with the Cloud SQL Auth Proxy) using `npm run bible:import`.
