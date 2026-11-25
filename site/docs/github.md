# GitHub

Sessions use a GitHub connection to clone private repos, push branches and open pull requests with `gh`. A connection is a token, a person's GitHub sign-in, or a GitHub App installation. Public repos work without any. You manage connections under **Settings → Accounts**.

## Kinds of connection

Each connection shows what it is:

| Badge | What it is | Reaches |
| --- | --- | --- |
| **Fine-grained token**, **Personal token** | A fine-grained personal access token made for a user. | The repositories and permissions chosen for it. |
| **Org token · acme** | A fine-grained token made for an organization. | That organization's repos only. |
| **Classic token** | A classic personal access token. | Whatever its user can reach, within its scopes. |
| **GitHub sign-in** | Someone signed in with GitHub. | Whatever that person can reach. |
| **GitHub App · acme** | A GitHub App installation, acting as the app's bot. | The repos the app is installed on, with the app's permissions. |

GitHub Apps also show their access: **Can push**, **Review only** (can read code and comment on pull requests, not push) or **Read only**. Sessions on a connection that can't push are told so at the start, so the agent doesn't spend turns trying. Several connections can share one GitHub login, each with its own name ("Acme org", "Read-only").

### Tokens

**Add a token**:

- **Fine-grained**: give it the repos you want, with *Contents* and *Pull requests* read and write. Add *Workflows* to push workflow changes.
- **Classic**: scopes `repo`, `read:org` and `workflow`.

Rename a token, or swap in a new one when it expires, with the pencil. Sessions and automations using it keep working.

### Sign in with GitHub

**Sign in with GitHub** appears once an admin sets a client ID under **Settings → General → GitHub sign-in**. It can be an OAuth app or a GitHub App, with *Enable Device Flow* checked; no callback URL is needed. You enter a code on GitHub, and sessions act as you.

A GitHub App's sign-ins expire after 8 hours. Give its client secret in the same setting, and Orbital renews them.

### GitHub Apps

For organizations that allow GitHub Apps but not personal tokens, add the app itself, and sessions act as its bot. Admins do this under **Organization → GitHub → Add a GitHub App**:

1. On GitHub: **Settings → Developer settings → GitHub Apps → New GitHub App**, under the organization or yourself. No webhook is needed.
2. Repository permissions: *Contents*, *Pull requests* and *Workflows* read and write, and *Metadata* read. Add *Administration* to create repos. For reviews only, read access is enough, but those sessions can't push.
3. Generate a private key, then **Install App** on the organization and pick its repos.
4. In Orbital, enter the **App ID or Client ID** and choose the `.pem` file.

Orbital adds one connection per installation. It keeps the key encrypted and uses it to get an hour-long installation token, which it renews, also inside running sessions. The key never reaches a session.

## Yours and the organization's

Like model accounts, each connection belongs to the organization or to one person.

- **Yours** (under **Accounts → Yours → GitHub**): **Sign in with GitHub**, or a token. Only you see them, and only sessions you start use them. Commits and pull requests are yours.
- **The organization's** (admins): GitHub Apps and organization tokens, for everyone's sessions, shared sessions and automations. Members pick them by name.

Admins see that people have their own connections, and can remove them, but can't use them or see what they reach.

## Which connection a session uses

New session asks every connection you can use whether it can open the repo, and picks the one to use first:

1. Connections that can open the repo.
2. Among those, connections GitHub reports write access for, since sessions push.
3. Then the stricter one: fine-grained tokens before sign-ins and classic tokens, less access before more, fewer repos before more.

You can pick another under **GitHub token**. A connection that can't open the repo says why.

In the session, git and `gh` sign in as that connection with no setup: `git clone`, `pull` and `push` (SSH remotes go over https), and `gh pr create`. The token lives in `/session/.orb` and stays current: pick another connection in the session's panel, or replace an expired token, and the next push uses it without a restart. Commits use the connection's name and GitHub noreply address.

## Troubleshooting

**Check access** on a connection asks GitHub what it can see, for a repo you name.

**"GitHub turned the app down … Bad credentials"** when adding a GitHub App. GitHub gives the same answer for every kind of bad app sign-in, so Orbital checks which it is:

- **The server's clock.** GitHub only accepts an app's sign-in within about a minute of its own time. If the message says the server's clock is ahead or behind, set the time on the Docker host (NTP) and try again.
- **The App ID or key.** If the clock agrees, check that the number is this app's App ID or Client ID, and that the key's fingerprint in the message is listed under *Private keys* on the app's settings page.

**The app was turned down for a repo.** The app isn't installed on that repo, or lacks a permission. Check the installation's repository list and the app's permissions on GitHub.
