# Model accounts

A model account is what a session's agent runs as: a Claude plan, an API key, Claude on your cloud, or OpenAI and Google through their own CLIs. Accounts are either the organization's, set up by admins for everyone's sessions, or one person's own sign-in. You manage them under **Settings → Accounts**.

## Kinds of account

**Add account** (or **Add a sign-in**, for your own) groups every kind by vendor.

| Kind | Runs | How you connect it | Remote Control |
| --- | --- | --- | --- |
| **Claude subscription** | Claude Code | Sign in from a terminal in the browser with your Pro or Max plan. | ✓ |
| **Long-lived token** | Claude Code | Run `claude setup-token` anywhere and paste the `sk-ant-oat…` token. Billed to your plan. | ✗ |
| **Anthropic API key** | Claude Code | Paste a Claude Console key. Billed per use. | ✗ |
| **Amazon Bedrock** | Claude Code | A region, and a Bedrock API key or an access key and secret. | ✗ |
| **Google Vertex AI** | Claude Code | A project, a region and a service account key (JSON). | ✗ |
| **Microsoft Foundry** | Claude Code | Your Azure Foundry resource name and API key. | ✗ |
| **LLM gateway** | Claude Code | An Anthropic-compatible base URL (LiteLLM, Portkey…) and its credential. | ✗ |
| **ChatGPT plan** | Codex CLI | Sign in from the browser with a device code, with your ChatGPT Plus, Pro or Business plan. | ✗ |
| **OpenAI API key** | Codex CLI | Paste an OpenAI API key. Billed per use. | ✗ |
| **Google account** | Gemini CLI | Sign in from a terminal in the browser with your Google account. | ✗ |
| **Gemini API key** | Gemini CLI | Paste a key from Google AI Studio. | ✗ |

![Adding a model account: every provider, grouped](../screenshots/accounts-add.png)

Bedrock, Vertex, Foundry and gateway accounts take optional model IDs for the opus, sonnet and haiku aliases, for providers that name models differently.

### Signing in from the browser

For the sign-in kinds (Claude subscription, ChatGPT plan, Google account), **Sign in** opens a terminal running the agent's own login in a short-lived container. Open the link it shows, approve, and paste the code back if it asks. **Continue sign-in** picks up one you left open.

**Check** makes sure an account works, and the account shows *Signed in*, *Not signed in*, *Ready* or *Not working*. When a sign-in runs out, it appears in the To do list of whoever can fix it.

### Sessions share their account's setup

Every session of an account shares that account's configuration, the way terminals on one machine share `~/.claude`: its login, settings, memory and conversations folder. Settings you change in one session (`/config`, MCP servers, memory) apply to its other sessions.

## Yours and the organization's

Each account belongs either to the organization or to one person.

![Accounts → Organization: model accounts, profiles and GitHub connections](../screenshots/accounts.png)

**Yours** (top of **Settings → Accounts**, for everyone who starts sessions):

- Sign-ins to your own plan only: **Claude subscription**, **Long-lived token**, **ChatGPT plan** or **Google account**. API keys and cloud accounts bill the organization, so admins add those.
- Only you see them, and only sessions you start can use them. New session marks them *yours*.
- Admins see that they exist and whose they are, under *People's own*, and can remove them. They can't use them or sign them in.

**Organization** (admins only):

- Any kind of account.
- Members pick them by name when they start a session, without seeing their settings or emails.
- Profiles, shared sessions and automations use only the organization's accounts, because they don't run as any one person.

Accounts that existed before people could have their own are the organization's.

## Profiles

A profile maps repos to an account, a model and a permission mode, so you don't pick them every time. Admins manage them under **Settings → Accounts → Profiles**.

- Patterns are `owner/name` with `*` for anything (`acme/*`, `*-infra`, `*`), matched without regard to case.
- The first matching profile in the list wins. The arrows change the order, and **Try a repo** shows which profile a repo would get.
- **New session** applies the matching profile as soon as you pick the repo, or the one you choose. The fields stay editable.
- A profile can also give its repos' sessions [AWS profiles](aws.html).
- [Linear rules](automations.html) can use a profile too.

## Codex and Gemini sessions

Claude Code only runs Claude models, so OpenAI and Google models run through their vendors' own agents, Codex CLI and Gemini CLI, in the same kind of container, terminal and tmux.

- They use the session image with those CLIs added (`ghcr.io/vitafortis/orbital-session:latest-all`, under **Settings → General → Image for Codex and Gemini sessions**). It's pulled the first time an OpenAI or Google account starts a session.
- The terminal, live state, git status, stop and continue all work as for Claude.
- The Read tab, conversation list, summaries, skills and Remote Control are Claude Code features, so they only show for Claude sessions.
- Permission modes map to each agent's own. Codex gets full access to its container (the container is the sandbox) and asks before commands unless set to Bypass.
- A session keeps its agent. Its account can change to another account of the same agent.

## Remote Control

Remote Control needs a full claude.ai sign-in, so only **Claude subscription** accounts have it. The first time a subscription session starts with it, Claude Code asks you to confirm once in the session's terminal. Turn it on by default for new sessions under **Settings → General**.
