# Security model

Orbital runs AI agents with real credentials on your own Docker host. This page says what runs where, what each session can reach, and how to set Orbital up for a company.

## Orbital controls Docker

Orbital needs the Docker socket to create, start and stop session containers. Access to the Docker socket is effectively root on the host. Anyone who can start sessions can run code in a container on that host. That's the point of Orbital, so treat sign-in to Orbital accordingly:

- Keep it on your LAN or a VPN, or behind single sign-on.
- Give people the lowest role that works for them (see [Roles](users.html#roles)).
- Use a dedicated Docker host for Orbital, not one that runs other important services.

## What a session can reach

Each session runs in its own container, as the `node` user, with only its own folders from the sessions volume:

- its repo clone and home folder;
- its model account's folder (login, settings, conversations), which the account's other sessions share;
- its `/session/.orb` folder, where Orbital writes what it needs: the GitHub token, AWS credentials, MCP server settings and your Notion token, if those apply. Secret files are readable only by the session's user.

It does not get the Docker socket, Orbital's database or encryption key, other sessions' folders, a GitHub App's private key, or the AWS SSO token. Credentials it does get are short-lived where the provider allows: GitHub App tokens last an hour and AWS keys a role's session length, and Orbital renews both while the session runs.

The agent inside can use everything its session has, including its network access. With the *Bypass* permission mode it does so without asking. Choose credentials for a session as if you were handing them to the agent, because you are.

## Stored secrets

Tokens, keys and passwords Orbital stores (model account secrets, GitHub tokens and app keys, AWS and Notion sign-ins, MCP server secrets) are encrypted with AES-256-GCM. The key is `ORB_SECRET_KEY`, or a random key in `/data/secret.key`. Secrets are never sent back to the browser: forms show only that a secret is set. Passwords are stored as hashes.

## Personal and organization credentials

- **The organization's** model accounts and GitHub connections are managed by admins. Members can use them for sessions by name, without seeing their settings.
- **A person's own** sign-ins (Claude, ChatGPT or Google plan, GitHub, Notion) are theirs alone. Only sessions they start use them, and nobody else, admins included, can use them or see what they reach. Admins can remove them.
- **Shared sessions** use only the organization's accounts, and nobody's own Notion.
- **Automations** run as nobody in particular, so they use only the organization's accounts.

One thing to know: members can open the Shell in a shared session, and that shell has the session's credentials (its GitHub token, AWS profiles). Share a session with broad credentials only with people who should have them.

## Roles are enforced on the server

The pages hide what your role can't do, and the server refuses it anyway: every API request, every terminal connection and the live session stream check the role and whose a session or account is. Watching a session attaches to tmux read-only. Someone who is an admin only for a while can't change roles or sign-in. See [Sign-in and users](users.html).

## Recommended setup for a company

1. **Single sign-on only.** Set up OpenID Connect, then turn **Password sign-in** off. Keep one admin with a password for when single sign-on is down (`/login?local`).
2. **Default role: Viewer.** Make the people who should start sessions members through a group rule, and admins through a smaller one. Raise people for a while when they need more, instead of for good.
3. **Other people's sessions: Names and status.** People see that a session exists, not what's in it, unless its owner lets everyone watch.
4. **Session expiry.** Under **Settings → General**, stop idle sessions after a few hours and delete stopped ones after a few days.
5. **GitHub Apps instead of personal tokens** for the organization, with the narrowest permissions that work (read-only for review sessions). Let people sign in with GitHub for work that should be under their own name.
6. **Read-only AWS roles** by default, and write roles only in sandbox accounts.
7. **Back up** both volumes, and keep `ORB_SECRET_KEY` or `/data/secret.key` somewhere safe.
