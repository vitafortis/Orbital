# Configuration

Almost everything is configured in the browser, under **Settings**. The Orbital container also reads a few environment variables, for things that must be known before the UI is up, or that you'd rather pin. All are optional.

## Environment variables

Set them on the `orbital` service in `compose.yaml`. Settings saved in the UI take over from the ones marked *default for*.

| Variable | Default | What it does |
| --- | --- | --- |
| `ORB_ADMIN_EMAIL`, `ORB_ADMIN_PASSWORD` | | Create the local admin on first start, instead of the setup screen. Both are needed. |
| `ORB_ADMIN_NAME` | | The local admin's name, with the two above. |
| `ORB_SECRET_KEY` | A random key in `/data/secret.key` | The key that encrypts stored tokens and keys. Keep it (or the file): without it, stored secrets can't be decrypted. |
| `ORB_AUTH` | | `disabled` turns sign-in off, whatever the UI says. For recovery only. |
| `ORB_SESSION_IMAGE` | `ghcr.io/vitafortis/orbital-session:latest` | Default for **Settings → General → Image**. |
| `ORB_AGENTS_IMAGE` | `ghcr.io/vitafortis/orbital-session:latest-all` | Default for **Image for Codex and Gemini sessions**. |
| `ORB_SESSION_NETWORK` | Docker's default bridge | Default for **Docker network**, the network session containers join. |
| `ORB_GITHUB_CLIENT_ID` | | Default for **GitHub sign-in**, the OAuth app or GitHub App behind *Sign in with GitHub*. |
| `ORB_DOCKER_HOST` | `unix:///var/run/docker.sock` (or `DOCKER_HOST`) | The Docker endpoint. `tcp://host:2375` works too. |
| `ORB_DATA_DIR` | `/data` in the image | Where the database and key file live. |
| `ORB_SESSIONS_DIR` | `/sessions` in a container | Where session data lives, as Orbital sees it. |
| `ORB_SESSIONS_VOLUME` | Found by inspecting Orbital's own container | The Docker volume session containers mount, when auto-detection can't tell. |
| `ORB_SESSIONS_HOST_PATH` | | A host folder session containers bind-mount instead of a volume. Needed on Docker Engine older than 26. |
| `ORB_SELF_CONTAINER` | The container's hostname | Orbital's own container (name or ID), if its hostname was changed. |
| `ORB_INSTANCE` | `orbital` | The label on Orbital's containers, so two installs can share one Docker host. |
| `ORB_LINEAR_API_URL` | `https://api.linear.app/graphql` | Linear's API. For testing against a mock server. |
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Where Orbital listens inside the container. The compose file maps port 3050 to it. |

Older installs may still use `CCM_*` names (from before the rename to Orbital). They keep working, but rename them to `ORB_*`.

## Settings in the browser

The rest is set in the browser by admins:

| Where | What |
| --- | --- |
| **Settings → Accounts** | The organization's model accounts, profiles, GitHub connections and AWS. Everyone's own sign-ins are under **Yours**. See [Model accounts](accounts.html), [GitHub](github.html) and [AWS](aws.html). |
| **Settings → Library** | Skills, MCP servers and the reply style. See [Library](library.html). |
| **Settings → Automations** | Linear and its rules. See [Automations](automations.html). |
| **Settings → General** | Session images, Docker network, memory and CPU limits, session expiry, default model and permissions, Remote Control by default, Public URL, GitHub sign-in, and extra environment variables for every session (`KEY=value` lines). |
| **Settings → Sign-in & users** | Sign-in methods, rules and roles, users, and what people see of each other's sessions. See [Sign-in and users](users.html). |

Changes to session containers (image, network, limits, extra environment) apply to sessions started or restarted after you save.
