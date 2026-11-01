<p align="center">
  <img src="docs/logo.svg" width="64" height="64" alt="" />
</p>

<h1 align="center">Orbital</h1>

<p align="center">
  Claude Code sessions on your own hardware.<br />
  Pick a repo, and Claude Code starts in its own container on your homelab, with a terminal in the browser,<br />
  live summaries of every session, Remote Control, and sessions you can stop and pick up again.<br />
  Label a Linear issue and a session starts on its own; start a session from a skill to review a pull request.<br />
  Run Claude through Anthropic, Bedrock, Vertex, Foundry or your gateway, or OpenAI's Codex and Google's Gemini CLI, with profiles deciding which repo goes where.
</p>

<p align="center">
  <img src="docs/screenshots/overview.png" alt="Orbital sessions overview" />
</p>

## Features

- **One container per session**: Orbital clones the repo (optionally onto a new branch) into a fresh container named `orbital-<repo>` (`orbital-<repo>-2`, `-3`… for more sessions on the same repo) and starts Claude Code there, with the name you gave it. For a new project, start without a repo: the session gets an empty folder with git ready, and the agent can put it on GitHub with `gh repo create`. All sessions share one image; repos, home folders and conversations live in a volume, so containers are disposable and nothing is rebuilt per project.
- **Terminals in the browser**: open any session as a full terminal (xterm.js over a WebSocket). Claude runs inside tmux, so closing the tab doesn't stop it, and several browsers can watch the same session. A **Shell** tab opens a second terminal in the same container. You type straight into the terminal, and scroll it with the wheel or a finger; on phones, a key bar adds Esc, Tab, ⇧Tab, arrows, Ctrl+C, End and Enter. When the agent asks something (a permission prompt, a question with options), the options show above the terminal as buttons. Links on screen, even long sign-in links that wrap over many lines, show above the terminal with Open and Copy buttons.
- **Live overview**: every session shows whether Claude is *working*, *needs you* (a permission prompt or question), is *idle*, or has exited, plus the last prompt and reply, the task list, the tool it's running, git changes and the last lines of its screen. Sessions that need you sort to the top and get a quick-reply box. **Summarize** asks a small model for a three-sentence summary, using the session's own Claude account.
- **Stop, resume, relaunch**: stopping removes the container and keeps everything else. Starting again picks up the newest conversation (`claude --continue`); you can also resume any earlier conversation or start a fresh one, and restart Claude inside a running session.
- **Linear automations**: connect Linear and add rules like *issues in ENG labelled `claude` start a session on owner/repo*. Each new issue gets its own session, on Linear's branch name for it (so the pull request links back), with the issue as the first message. Orbital moves the issue to In Progress, comments with a link to the session, and comments again with the PR once Claude opens one. It polls Linear every minute, so nothing on your network has to be reachable from outside.
- **Skill sessions**: start a session from a skill or slash command instead of a message: `/code-review 234` on a pull request, `/security-review`, `/simplify`, or the account's own skills. Pick a pull request and the session checks out its branch (or `pull/<n>/head` for a fork). **Review a PR** on the overview starts one in two clicks, and **Session → Run a skill** sends one to a running session.
- **Pull requests**: when a session's branch has a pull request, its number and state (open, draft, merged, closed) show on the card and link to GitHub.
- **Remote Control**: sessions on a Claude subscription start with `--remote-control "<name>"`, so they also show up at claude.ai/code and in the Claude app, under the session's name. The overview links straight to them.
- **Model accounts**: sign in with a Claude Pro or Max plan in a terminal right in the browser (`claude auth login`), or add a long-lived token or an API key; run Claude on **Amazon Bedrock**, **Google Vertex AI**, **Microsoft Foundry** or an **LLM gateway** (LiteLLM, Portkey…); or use **OpenAI** (ChatGPT plan or API key) through Codex CLI and **Google** (Google account or Gemini API key) through Gemini CLI, in the same containers and terminals. Sessions of one account share its login, settings and memory, like terminals on one machine.
- **Profiles**: say which repos go to which model: `acme/*` on Bedrock with Opus, `me/side-*` on Codex, everything else on your subscription. New sessions pick the matching profile's account, model and permissions (you can still change them), and Linear rules can use it too.
- **GitHub accounts and orgs**: add personal access tokens, as many as you like and each with a name ("Acme org", "Read-only"), or sign in with GitHub through your own OAuth app. Rename a token or swap in a new one when it expires, without touching the sessions and automations that use it. Browse every repo your tokens can see across your account and organizations, and pick a branch, or have a new session create its repo (private or public, under you or an organization); New session uses the token that can open the repo (the stricter one when several can, which you can change). Sessions get the token for `git push` and `gh pr create`, and commit under your GitHub noreply address.
- **AWS through SSO**: sign Orbital in to IAM Identity Center once, and give sessions AWS profiles, each one account and role. A session gets only those roles' short-lived keys, as the standard AWS files the CLI, SDKs and Terraform read, renewed while it runs; your sign-in never reaches it. The AWS CLI is in the session image.
- **Sign-in your way**: a local admin account, plus single sign-on with any OpenID Connect provider (Authentik, Authelia, Keycloak, Pocket ID…), or your reverse proxy's forward auth, with email and group rules and admin/member roles. Or turn sign-in off behind a proxy that already does it. All set in the UI.
- **Encrypted storage**: tokens and keys are sealed with AES-256-GCM and never sent back to the browser.
- **Command palette**: `⌘K` (`Ctrl+K`) jumps to any session or page.
- **Light and dark** themes, phone-friendly layout, multi-arch images (`amd64`, `arm64`).

## Screenshots

<table>
  <tr>
    <td><img src="docs/screenshots/accounts.png" alt="Model accounts from Anthropic, AWS, Google Cloud, OpenAI and Google, and profiles mapping repos to them" /></td>
    <td><img src="docs/screenshots/accounts-add.png" alt="Adding a model account: every provider, grouped" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/new-profile.png" alt="New session: the repo matched a profile, which picked a Codex account" /></td>
    <td><img src="docs/screenshots/session-gemini.png" alt="A Gemini CLI session in the browser terminal" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/sign-in.png" alt="Settings → Sign-in and users: password, single sign-on, reverse proxy headers" /></td>
    <td><img src="docs/screenshots/login.png" alt="The sign-in page with single sign-on" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/session.png" alt="A session's terminal with its summary, tasks, git status and conversations" /></td>
    <td><img src="docs/screenshots/automations.png" alt="Linear automations: a rule and the issues it picked up" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/new-skill.png" alt="New session in skill mode: /code-review on pull request 18" /></td>
    <td><img src="docs/screenshots/automations-rule.png" alt="Editing a Linear rule" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/session-skill.png" alt="Run a skill in a running session" /></td>
    <td><img src="docs/screenshots/overview-light.png" alt="The overview in the light theme" /></td>
  </tr>
</table>

<p align="center">
  <img src="docs/screenshots/phone-overview.png" width="280" alt="Overview on a phone" />
  &nbsp;
  <img src="docs/screenshots/phone-session.png" width="280" alt="A session's terminal on a phone, with the key bar" />
</p>

Screenshots use demo data: the conversations, Linear workspace and pull requests are made up. **[All screenshots →](docs/screenshots/README.md)**

## Getting started

### Docker Compose (recommended)

```sh
mkdir orbital && cd orbital
curl -fsSLO https://raw.githubusercontent.com/vitafortis/Orbital/main/compose.yaml
docker compose up -d
```

Open `http://<your-host>:3050` and create the local admin account. Everything else is set up in the UI; no environment variables are needed. The Sessions page then walks you through these three steps, with a button for each:

1. **Accounts → Models → Add account.** Pick *Claude subscription* and sign in in the terminal that opens: open the link, approve, paste the code back. (Or a token, an API key, a cloud provider, OpenAI or Google.)
2. **Accounts → GitHub → Add a token**, for private repos and pushing. Public repos work without one.
3. **New session**: pick the repo (or start without one), optionally a branch to start from and a new branch to work on, a first message, the model and the permission mode. **Start session** opens its terminal.

The first start pulls the session image (`ghcr.io/vitafortis/orbital-session`), which takes a minute. To put it behind single sign-on or your reverse proxy's login, see [Sign-in](#sign-in).

To build both images from source instead (for example to add tools to the session image):

```sh
git clone https://github.com/vitafortis/Orbital orbital && cd orbital
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

This also builds the Codex and Gemini image; drop the `session-image-all` service from `compose.build.yaml` if you only use Claude.

### Requirements

- Docker Engine **26 or newer** (sessions mount parts of the `orbital-sessions` volume by subpath). On older engines, bind-mount a host folder at `/sessions` and set `ORB_SESSIONS_HOST_PATH` to it.
- The Docker socket. Orbital creates, starts and stops session containers, so it needs the real socket, not a read-only proxy.

> **Security.** Whoever can sign in to Orbital can run code on the Docker host (that is the point of it). Keep it on your LAN or behind a VPN or an authenticating reverse proxy, and use a strong password.

## Sign-in

**Settings → Sign-in & users** (admins only) decides how people get in. The local admin made at setup always works, so a broken SSO setup never locks you out.

- **Password**: the local admin's email and password. The form can be hidden once SSO works; `/login?local` still shows it.
- **Single sign-on (OpenID Connect)**: a *Sign in with…* button for Authentik, Authelia, Keycloak, Pocket ID, Zitadel, Google, Entra ID and others. Create a confidential web client at your provider with the redirect URI shown on the page (`https://<orbital>/api/auth/oidc/callback`), then enter the issuer URL (**Test** checks it), client ID and secret. It uses the authorization code flow with PKCE. Groups come from the `groups` claim, or another one you name (`realm_access.roles` for Keycloak).
- **Reverse proxy headers (forward auth)**: when Authelia, Authentik's proxy outpost, oauth2-proxy, Tailscale and the like sign people in in front of Orbital, it trusts `Remote-Email`, `Remote-Name` and `Remote-Groups` (names configurable), but only from the proxy addresses you list (Docker's and LAN ranges by default). Make sure the proxy strips those headers from incoming requests and that port 3050 isn't reachable around it. Set the proxy's logout URL so **Sign out** ends that session too.
- **Off**: anyone who can reach Orbital uses it as the admin. Only for a proxy that already signs people in, on a network you trust. `ORB_AUTH=disabled` on the container does the same and overrides the UI (for recovery).

**Who gets in**: SSO and proxy users can be limited to emails, `@domains` or groups, and emails or groups can be made admins. With no rules, everyone your provider lets through gets in. People appear under **Users** the first time they sign in; a local account with the same email becomes that account.

**Roles**: *admins* manage sign-in and users; *members* use everything else (sessions, accounts, automations, settings). The local admin is an admin, and there is always at least one.

**Behind a TLS reverse proxy**, set **Settings → Public URL** to the address people use (e.g. `https://cc.home.arpa`): it's the SSO redirect URI and the link in Linear comments. The proxy must pass `X-Forwarded-Proto` (all common ones do) so sign-in cookies are marked secure, forward WebSocket upgrades on `/ws/`, and not buffer `/api/sessions/live` (Server-Sent Events).

## How it works

```
 browser ──HTTP/SSE──▶ Orbital ──Docker API──▶ session container (one per session)
    │                   (SvelteKit)                 tini → tmux "main" → claude --name … --remote-control …
    └──WebSocket──────▶ terminal bridge ──docker exec -it──▶ tmux attach   (or bash, for the Shell tab)
```

- A session container runs `tmux`, and in it a small launcher that clones the repo on first start, pre-answers Claude Code's first-run questions it already knows (onboarding, trusting the repo folder, approving the account's API key), then runs `claude` with the session's settings. When Claude exits, the pane drops to a shell instead of closing.
- Each browser terminal is its own `docker exec` running `tmux attach`, bridged over a WebSocket. tmux sizes the window to whoever typed last.
- The overview polls each running session every few seconds with one cheap `docker exec` (the pane's last lines and command, and every fifth time `git status`) and reads the newest conversation transcript straight from the volume.
- The live state reaches the browser over one Server-Sent Events stream.

### Where things live

Everything a session needs survives its container, in the `orbital-sessions` volume:

| Path in the volume | Mounted in the session at | What |
| --- | --- | --- |
| `accounts/<account>/` | `/claude` (`CLAUDE_CONFIG_DIR`), `/codex` (`CODEX_HOME`) or `/gemini` (`GEMINI_CLI_HOME`) | The account's login, settings, memory and conversations (and a Vertex service account key). Shared by the account's sessions. |
| `sessions/<id>/home/` | `/session/home` (`$HOME`) | The session's home folder: shell history, caches, tool configs. |
| `sessions/<id>/repo/` | `/workspace/<repo>` (Codex and Gemini: `/workspace/<id>/<repo>`) | The cloned repository, with your uncommitted work. |
| `sessions/<id>/.orb/` | `/session/.orb` | Launch settings and the last AI summary, written by Orbital. |

Conversations are stored per session (`CLAUDE_CODE_PROJECT_DIR_NAME` is the session id), so two sessions on the same repo never mix their history. Codex and Gemini keep conversations by working directory, so their sessions get a working directory of their own. Deleting a session removes its folder and its Claude conversations; deleting an account removes its folder.

The app's own data (`orbital-data`, at `/data`) holds the SQLite store and `secret.key`, the key that encrypts tokens. Back up both volumes, and keep `secret.key` (or set `ORB_SECRET_KEY`), or the stored tokens can't be decrypted.

## Model accounts

**Accounts → Add account** groups every kind by vendor.

| Kind | Runs | How | Remote Control | Billing |
| --- | --- | --- | --- | --- |
| **Claude subscription** | Claude Code | Sign in from the browser (`claude auth login` in a short-lived container). | ✓ | Your Pro/Max/Team plan |
| **Long-lived token** | Claude Code | Run `claude setup-token` anywhere, paste the `sk-ant-oat…` token. | ✗ | Your plan |
| **Anthropic API key** | Claude Code | Paste a Claude Console key. | ✗ | Per use |
| **Amazon Bedrock** | Claude Code | Region, plus a Bedrock API key or an access key and secret. | ✗ | Your AWS account |
| **Google Vertex AI** | Claude Code | Project, region and a service account key (JSON). | ✗ | Your Google Cloud project |
| **Microsoft Foundry** | Claude Code | Resource name and API key. | ✗ | Your Azure resource |
| **LLM gateway** | Claude Code | An Anthropic-compatible base URL and credential (sent as a bearer token or `x-api-key`). The gateway's models show in `/model`. | ✗ | Your gateway |
| **ChatGPT plan** | Codex CLI | Sign in from the browser (`codex login --device-auth`). | ✗ | Your ChatGPT plan |
| **OpenAI API key** | Codex CLI | Paste an OpenAI API key. | ✗ | Per use |
| **Google account** | Gemini CLI | Sign in from the browser (Gemini CLI's Google login). | ✗ | Your Google plan |
| **Gemini API key** | Gemini CLI | Paste a Google AI Studio key. | ✗ | Per use |

Claude Code only runs Claude models, so OpenAI and Google models run through their vendors' own agents, Codex CLI and Gemini CLI, in the same kind of container, terminal and tmux. Bedrock, Vertex, Foundry and gateway accounts take optional model IDs for the opus, sonnet and haiku aliases, for providers that name models differently.

Remote Control needs a full claude.ai login; Claude Code refuses it for tokens, API keys and cloud providers. The first time a subscription session starts with Remote Control, Claude Code asks you to confirm it once: answer in the session's terminal.

**Check** makes sure an account works: `claude auth status` for Anthropic accounts, a one-line request with a small model for cloud and gateway accounts, `codex login status` for ChatGPT, the sign-in files for Google, and a model listing for OpenAI and Gemini keys (free, but it needs Orbital itself to reach api.openai.com or generativelanguage.googleapis.com).

Every session of an account shares that account's configuration, as sessions on one machine share `~/.claude`. Settings you change in one session (`/config`, MCP servers, memory) apply to the others.

### Codex and Gemini sessions

They run in the session image with Codex CLI and Gemini CLI added: `ghcr.io/vitafortis/orbital-session:latest-all` (**Settings → Image for Codex and Gemini sessions**, or `ORB_AGENTS_IMAGE`). It's pulled the first time an OpenAI or Google account starts a session, so Claude-only installs never download it.

- The terminal, live state (working, waiting, idle), git status, stop and continue (`codex resume --last`, `gemini --resume latest`) all work as for Claude.
- The conversation summary, the conversation list, **Summarize**, skills and Remote Control are Claude Code features and only show for Claude sessions.
- Permission modes map to each agent's own: Codex has *Ask* (`-a on-request`) and *Bypass*; Gemini has *Ask*, *Accept edits*, *Plan* and *Bypass* (`--approval-mode yolo`). Codex's own sandbox can't run inside an unprivileged container, so Codex gets full access to the container, which is the sandbox, and asks before commands unless bypassed.
- A session keeps its agent: its account can change to another account of the same agent.

### Profiles

**Accounts → Profiles** maps repos to an account, a model and a permission mode. Patterns are `owner/name` with `*` for anything (`acme/*`, `*-infra`, `*`), matched case-insensitively; the first matching profile in the list wins, and the arrows change the order. **Try a repo** shows which profile a repo would get.

- **New session** applies the matching profile as soon as you pick the repo, or the one you choose. The fields stay editable.
- **Linear rules** take *None* (the rule's own account and permissions), *Match the repo* (the matching profile, else the rule's own settings), or one profile.
- A profile can also list **AWS profiles** for its repos' sessions (see [AWS](#aws)).

## GitHub

Add a **fine-grained token** with access to the repos you want (*Contents* and *Pull requests*: read and write; add *Workflows* to push workflow changes), or a **classic token** with `repo`, `read:org` and `workflow`. Orbital lists every repository the token can see, grouped by owner, so organizations show up as filters in the repo picker.

**Sign in with GitHub** appears once **Settings → GitHub OAuth app** names an OAuth app of yours with *Enable Device Flow* checked (GitHub → Settings → Developer settings → OAuth Apps). No client secret or callback URL is needed.

In a session, git and `gh` sign in as the session's GitHub account without further setup: `git clone`, `pull` and `push` (SSH remotes such as `git@github.com:…` go over https), `gh pr create` and the rest. The token sits in `/session/.orb` (`github-token`, and `gh/hosts.yml` for gh) and stays current while the session runs: pick another GitHub account in the session panel, or replace an expired token under **Accounts → GitHub**, and the next push uses it, with no restart.

## AWS

Sessions can work with AWS (the AWS CLI, SDKs, Terraform) through **IAM Identity Center** (AWS SSO), without your AWS sign-in ever entering a session. Only admins set this up, under **Accounts → AWS**:

1. **Sign in to AWS SSO** with your access portal URL (`https://<you>.awsapps.com/start`) and its region. Orbital shows a code; confirm it on the AWS page, as with `aws sso login`. Orbital keeps the token, encrypted, and renews it within the session length your Identity Center allows; when that runs out, **Sign in again**.
2. **Add a profile**: pick an account and a role (permission set) the sign-in has, and name it, e.g. `prod-readonly`. **Test** gets credentials the way a session would.
3. **Give sessions profiles** on New session, in a session's panel, or on a repo profile (`acme/infra-*` gets `sandbox-admin`, say). A new session gets AWS access only from its repo's profile or by hand.

What a session gets: for each of its profiles, that role's temporary credentials (an access key, secret and session token, valid for the role's session length, an hour by default), in `/session/.orb/aws/credentials` and `config`, with `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE` pointing there. Each profile is a named profile (`aws --profile prod-readonly`, Terraform's `profile = "prod-readonly"`), and the first is also the default. Orbital renews them about ten minutes before they expire, rewrites them when the session's profiles change, and removes them when the session stops or the profile is deleted, all without a restart. A command that runs longer than the credentials last can fail partway through, since most tools read the keys once when they start.

Keeping it safe:

- The SSO token, which could get credentials for every account and role you have, stays in Orbital. A session can only use the roles it was given, and only until their keys expire.
- An agent can do anything its role allows, so give sessions **read-only permission sets** by default, and a role that can change things only where you mean it to, ideally in a sandbox account.
- Claude on **Bedrock** puts `AWS_REGION` (and its access keys, if it uses keys) in the session's environment, and the AWS CLI prefers those to the credentials file: in such sessions, use `--profile <name>`.

Terraform isn't in the session image (its license); add it in your own image `FROM ghcr.io/vitafortis/orbital-session` (see [The session image](#the-session-image)).

## Linear

1. Create a personal API key in Linear (Settings → Security & access → Personal API keys) and paste it under **Automations**.
2. **Add rule**: pick the team, the label that hands an issue over (default `claude`), the repository, a profile or the model account, the GitHub account and the permission mode. The first message is a template with `{identifier}`, `{title}`, `{description}`, `{url}` and `{branch}`. Start it with a skill (`/my-skill {identifier}`) to run one.
3. Label an issue. Within a minute (or on **Check now**) a session starts on Linear's branch name for the issue, the issue moves to In Progress, and a comment links to the session. When Claude opens the pull request, a second comment links to it, and Linear's GitHub integration links the PR to the issue through the branch name and "Fixes ENG-123".

Issues that already had the label when you added the rule are skipped unless you switch on **Also start sessions for issues that already have the label**. At most three sessions start per check, so labelling a dozen issues at once doesn't swamp the host. Set **Settings → Public URL** if the links in comments should use a different address than the one you open Orbital at.

## Sessions

- **Permission modes**: *Ask*, *Accept edits*, *Plan*, *Auto*, or *Bypass*. Bypass skips every prompt; the container limits what Claude can reach, but it still has your GitHub token and network access.
- **Models** are picked by name and version: the newest of each line (Opus 5.5, Fable 5.1, Sonnet 5.5, Haiku 5.5), an exact version on Anthropic accounts and Vertex AI (Opus 4.8, Sonnet 4.6…), or any model ID. The model chip in a session's header switches it and offers to restart Claude on the newest conversation.
- **Session settings** (model account, GitHub account, model, permission mode, Remote Control) can change later. They apply the next time the agent starts: **Session → Continue newest conversation** restarts Claude in place.
- **Stop** removes the container; the repo, uncommitted changes and conversations stay. **Start** (or **Resume** in the overview) brings the session back with the current image and settings.
- **Git identity**: commits use the GitHub account's name and noreply address, or `Claude <noreply@anthropic.com>` for sessions without a GitHub account.
- **Conversations** in the session panel lists every saved conversation; **Resume** restarts Claude on that one.
- **Attach from the host**: the session panel shows the container name and a copyable `docker exec -it -u node orbital-<repo> tmux attach -t main`, for when you're on the server over SSH.
- **Delete** stops the session and removes its repo clone, home folder and conversations. Pushed commits stay on GitHub.

### The session image

`session/Dockerfile` builds on `node:24-trixie-slim` with Claude Code (npm, stable channel), git, gh, the AWS CLI, tmux, ripgrep, jq, python3 and build tools. With `--build-arg AGENTS="claude codex gemini"` it also installs Codex CLI and Gemini CLI; that build is published as `:latest-all`. Claude Code's auto-updater is off; the image is rebuilt weekly, and **Settings → Pull latest** fetches it (sessions use it from their next start).

To add languages or tools, build your own image `FROM ghcr.io/vitafortis/orbital-session` (or edit `session/Dockerfile` and use `compose.build.yaml`), and set it under **Settings → Session containers → Image**. Keep the `node` user (uid 1000) and the entrypoint. For example, with Terraform:

```dockerfile
FROM ghcr.io/vitafortis/orbital-session:latest
USER root
ARG TERRAFORM_VERSION=1.17.1
RUN arch=$(dpkg --print-architecture) \
	&& curl -fsSL "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_${arch}.zip" -o /tmp/tf.zip \
	&& unzip -q /tmp/tf.zip terraform -d /usr/local/bin && rm /tmp/tf.zip && terraform version
USER node
```

Settings also take a Docker network for session containers (to reach other services on your homelab by name), memory and CPU limits, and extra environment variables for every session (`KEY=value` lines, e.g. a proxy or a private registry).

## Configuration

Everything is configured in the UI. The container takes a few optional variables for things that must be known before the UI is up, or that you'd rather pin:

| Variable | Default | |
| --- | --- | --- |
| `ORB_ADMIN_EMAIL`, `ORB_ADMIN_PASSWORD`, `ORB_ADMIN_NAME` | | Create the local admin on first start instead of the setup screen |
| `ORB_SECRET_KEY` | random, in `/data/secret.key` | Encryption key for stored tokens |
| `ORB_AUTH` | | `disabled` turns sign-in off whatever the UI says (recovery) |
| `ORB_SESSION_IMAGE`, `ORB_AGENTS_IMAGE` | `ghcr.io/vitafortis/orbital-session:latest`, `…:latest-all` | Defaults for **Settings → Image** |
| `ORB_SESSION_NETWORK` | Docker's default bridge | Default for **Settings → Docker network** |
| `ORB_GITHUB_CLIENT_ID` | | Default for **Settings → GitHub OAuth app** |
| `ORB_SESSIONS_VOLUME` / `ORB_SESSIONS_HOST_PATH` | found by inspecting our own container | How session containers reach the `/sessions` data, when auto-detection can't tell |
| `ORB_SELF_CONTAINER` | the hostname | Our own container, if its hostname was changed |
| `ORB_INSTANCE` | `orbital` | Label on our containers, so two installs can share a Docker host |
| `ORB_DOCKER_HOST` | `unix:///var/run/docker.sock` | Docker endpoint (`tcp://host:2375` works too) |

### Upgrading from cc·modern or Orbit

Orbital used to be called cc·modern (and briefly Orbit), with `cc-modern` images, volumes and labels and `CCM_*` settings. To move an install over:

1. **Stop every session** first. Session containers are labelled with the old name, so Orbital doesn't recognise ones still running (their data is safe either way).
2. **Keep your volumes.** The new `compose.yaml` names them `orbital-data` and `orbital-sessions`; point it at the old ones instead (the data volume carries the compose project's prefix, usually the folder name, see `docker volume ls`):

   ```yaml
   volumes:
     orbital-data:
       external: true
       name: cc-modern_cc-modern-data
     orbital-sessions:
       external: true
       name: cc-modern-sessions
   ```

3. **Switch images** to `ghcr.io/vitafortis/orbital` and `…/orbital-session`. If Settings names `ghcr.io/vitafortis/cc-modern-session`, sessions use `orbital-session` (same tag) on their own. A custom session image saved in Settings stays as it is; rebuild it `FROM ghcr.io/vitafortis/orbital-session` so it has the renamed `orb-*` scripts.

Session containers named `claude-<repo>` become `orbital-<repo>` the next time each session starts. `CCM_*` variables still work, but rename them to `ORB_*`. On start, Orbital takes over `cc-modern.db` (as `orbital.db`) and renames each session's `.ccm` folder to `.orb`; stored tokens stay readable, and the browser keeps its theme, pins and panel layout. Everyone is signed out once, since the cookie was renamed too.

## Development

```sh
pnpm install
pnpm dev        # http://localhost:3050, using the local Docker socket
pnpm check      # svelte-check + TypeScript
pnpm test       # unit tests (node --test)
pnpm build && pnpm start
```

Outside Docker, session data lives in `./data/sessions` and session containers bind-mount it. Build the session image locally with `docker build -t orbital-session:dev session` and set `ORB_SESSION_IMAGE=orbital-session:dev`.

To try Linear rules without a workspace, point `ORB_LINEAR_API_URL` at a mock GraphQL server.

`pnpm e2e` runs a smoke test against a running instance (`ORB_URL`, `ORB_EMAIL`, `ORB_PASSWORD`): it starts a session on a public repo with a throwaway, signed-out Claude account, checks the clone, both terminals, stop and resume, then deletes everything it made.

Built with SvelteKit, Tailwind CSS and xterm.js, in the same style as [pg·modern](https://github.com/vitafortis/pg-modern) and [octo·modern](https://github.com/vitafortis/octo-modern).

## License

[Apache 2.0](LICENSE): use, modify and redistribute it, commercially or not, keeping the license and [NOTICE](NOTICE). Contributions are accepted under the same license.

Orbital is an independent project, not affiliated with or endorsed by Anthropic, OpenAI or Google. Claude is a trademark of Anthropic; Codex and Gemini belong to their owners. Brand logos come from [LobeHub Icons](https://github.com/lobehub/lobe-icons) (MIT) and [Simple Icons](https://simpleicons.org) (CC0) and only identify each service.
