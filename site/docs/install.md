# Install

Orbital is one container that talks to Docker on the same host. It creates a container for each session from a separate session image. You need Docker and a few minutes; everything after the first start is set up in the browser.

## Docker Compose

```sh
mkdir orbital && cd orbital
curl -fsSLO https://raw.githubusercontent.com/vitafortis/Orbital/main/compose.yaml
docker compose up -d
```

Open `http://<your-host>:3050` and create the local admin account. No environment variables are needed. To create the admin from the environment instead of the setup screen, see [Configuration](configuration.html).

The compose file mounts three things:

| Mount | What it holds |
| --- | --- |
| `orbital-data` at `/data` | The SQLite database (accounts, settings, encrypted tokens) and `secret.key`, the key that encrypts them. |
| `orbital-sessions` at `/sessions` | Each session's repo and home folder, and each model account's login and conversations. Session containers mount their part of it. |
| `/var/run/docker.sock` | The Docker socket, so Orbital can create, start and stop session containers. |

Back up both volumes. Keep `secret.key` (or set `ORB_SECRET_KEY`): without it, the stored tokens can't be decrypted.

## Requirements

- **Docker Engine 26 or newer.** Sessions mount parts of the `orbital-sessions` volume by subpath. On older engines, bind-mount a host folder at `/sessions` and set `ORB_SESSIONS_HOST_PATH` to it.
- **The real Docker socket.** Orbital creates and removes containers, so a read-only socket proxy isn't enough.
- **amd64 or arm64.** Both images are published for both.

## First run

The Sessions page walks you through three steps, with a button for each:

1. **Add a model account.** Under **Settings → Accounts**, add one for the organization (or **Yours → Add a sign-in** for your own plan). For a Claude subscription, a terminal opens in the browser: open the link, approve, and paste the code back. See [Model accounts](accounts.html).
2. **Connect GitHub**, for private repos and pushing. Public repos work without it. See [GitHub](github.html).
3. **Start a session.** **New session**: pick the repo, a first message, the model and the permission mode, then **Start session**.

The first session start pulls the session image (`ghcr.io/vitafortis/orbital-session`), which takes a minute.

## Behind a reverse proxy

If people reach Orbital through a TLS reverse proxy:

- Set **Settings → General → Public URL** to the address people use, e.g. `https://orbital.example.com`. It's the single sign-on redirect address and the link in Linear comments.
- Pass `X-Forwarded-Proto`, so sign-in cookies are marked secure. Common proxies do.
- Forward WebSocket upgrades on `/ws/` (the terminals).
- Don't buffer `/api/sessions/live` (Server-Sent Events).

## Build from source

To build both images yourself, for example to add tools to the session image:

```sh
git clone https://github.com/vitafortis/Orbital orbital && cd orbital
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

This also builds the image for Codex and Gemini sessions. Drop the `session-image-all` service from `compose.build.yaml` if you only use Claude.

To add languages or tools to sessions without building Orbital, build your own image `FROM ghcr.io/vitafortis/orbital-session` and set it under **Settings → General → Image**. Keep the `node` user (uid 1000) and the entrypoint:

```dockerfile
FROM ghcr.io/vitafortis/orbital-session:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client && rm -rf /var/lib/apt/lists/*
USER node
```

## Upgrading

```sh
docker compose pull
docker compose up -d
```

Running sessions keep their containers. **Settings → General → Pull latest** fetches the newest session image; sessions use it from their next start. Claude Code's auto-updater is off in sessions; the session image is rebuilt weekly instead.

Orbital used to be called cc·modern. To move an older install over, see *Upgrading from cc·modern or Orbit* in the [README](https://github.com/vitafortis/Orbital#upgrading-from-ccmodern-or-orbit).

## Security

Whoever can sign in to Orbital with the right role can run code on the Docker host: that's what Orbital is for. Keep it on your LAN, a VPN, or behind single sign-on, and read the [Security model](security.html) before opening it to a team.
