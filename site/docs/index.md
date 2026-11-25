# Introduction

Orbital runs Claude Code sessions on your own hardware. You pick a repository, and Claude Code starts in its own container on your server, with a terminal in the browser, a live overview of every session, and sessions you can stop and pick up again later. It also runs Claude on Bedrock, Vertex AI, Foundry or an LLM gateway, and OpenAI's Codex CLI and Google's Gemini CLI, in the same kind of container.

![A Claude Code session in Orbital: the terminal, with its summary, tasks, git state and conversations](../screenshots/session.png)

## How it works

```
 browser ──HTTP/SSE──▶ Orbital ──Docker API──▶ session container (one per session)
    │                   (SvelteKit)                 tini → tmux "main" → claude --name …
    └──WebSocket──────▶ terminal bridge ──docker exec -it──▶ tmux attach   (or bash, for the Shell tab)
```

- **One container per session.** Orbital clones the repo into a fresh container named `orbital-<repo>` (`orbital-<repo>-2` and so on for more sessions on the same repo) and starts the agent there. All sessions share one image.
- **tmux keeps it running.** The agent runs inside tmux, so closing the browser tab doesn't stop it, and several people can watch the same session. Each browser terminal is its own `docker exec` running `tmux attach`.
- **Containers are disposable.** Repos, home folders, logins and conversations live in the `orbital-sessions` volume. Stopping a session removes its container and keeps everything else. Starting it again continues the newest conversation.
- **The overview stays live.** Orbital checks each running session every few seconds and reads its conversation transcript from the volume. The browser gets the updates over one Server-Sent Events stream.

## Main ideas

**Sessions.** A session is a repo (or an empty folder), an agent, and the accounts it runs as. You start one from **New session**, with a first message or a skill such as `/code-review` on a pull request. See [Sessions](sessions.html).

**Personal and shared sessions.** A session belongs to the person who started it: they and admins control it. An admin can make a session **shared**: then every member can start, stop and type into it, and only admins change what it runs as. Sessions from before sign-in was turned on are shared.

**Yours and the organization's accounts.** Model accounts and GitHub connections belong either to the organization (admins manage them) or to one person (**Accounts → Yours**). Your own are sign-ins to your own plan or GitHub, and only sessions you start can use them. See [Model accounts](accounts.html) and [GitHub](github.html).

**Roles.** Admins do everything. Members start sessions and control their own and shared ones. Viewers watch and change nothing. What people see of each other's sessions is a setting. See [Sign-in and users](users.html).

## Where to go next

- [Install](install.html): Docker Compose, requirements and the first run.
- [Sessions](sessions.html): starting, using, sharing and stopping sessions.
- [Model accounts](accounts.html): Claude, cloud providers, Codex and Gemini, and profiles.
- [GitHub](github.html): tokens, GitHub Apps and Sign in with GitHub.
- [Sign-in and users](users.html): passwords, single sign-on, roles and who sees what.
- [Library](library.html): skills, MCP servers, Notion and the reply style.
- [Automations](automations.html): sessions started from Linear issues.
- [AWS](aws.html): short-lived AWS credentials through IAM Identity Center.
- [Security model](security.html): what runs where, and what each session can reach.
- [Configuration](configuration.html): environment variables.
