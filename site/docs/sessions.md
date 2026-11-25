# Sessions

A session is one agent working in one container: a repository (or an empty folder), the model account it runs as, and the GitHub connection it pushes with. This page covers starting sessions, working in them, and how they're shared.

## Start a session

**New session** (in the sidebar, or the button on the Sessions page) has two modes:

- **Work on a task**: the agent starts with your **First message**, or at the prompt if you leave it empty.
- **Run a skill**: the agent starts with a skill or slash command, such as `/code-review 234`. Pick the **Command** and give its **Arguments**. Skills from the [Library](library.html) and the account's own skills are listed.

![New session: the repo, a pull request to check out, and the session's account, model and permissions](../screenshots/new.png)

### The repository

- **Existing**: type `owner/name` or pick from every repo your GitHub connections can see. Pull requests and branches complete as you type, so a repo with hundreds of them stays quick to search.
- **Check out a pull request**: the session clones that pull request's branch, so commits push straight to it. For a pull request from a fork, it fetches `pull/<n>/head`.
- **Start from branch** and **New branch**: clone a branch, and optionally create a new one to work on. **Suggest** proposes a name.
- **New on GitHub**: the session creates the repo first, private or public, under you or an organization the chosen connection can reach.
- **No repo**: an empty folder with git ready, named after the session. The agent can publish it later with `gh repo create`.

### Account, model and permissions

- **Account**: the model account it runs as: the organization's, or one of yours (marked *yours*). See [Model accounts](accounts.html).
- **Profile**: a profile matching the repo fills in the account, model and permissions; you can still change them. See [Profiles](accounts.html#profiles).
- **Model**: a model alias, an exact version, or any model ID.
- **Permissions**: *Ask*, *Accept edits*, *Plan*, *Auto* or *Bypass*. Bypass skips every prompt: the container limits what the agent reaches, but it still has the session's GitHub token and network access.
- **Remote Control**: sessions on a Claude subscription also appear at claude.ai/code and in the Claude app, under the session's name.
- **Shared with everyone** (admins): starts it as a shared session. See [Shared sessions](#shared-sessions).

On the Sessions page, **Review a PR** opens New session in skill mode with `/code-review`, ready for a pull request.

## Work in a session

![A Claude Code session on a phone, with the key bar](../screenshots/phone-session.png)

- **The terminal** shows the agent's screen. You type straight into it. On phones, a key bar adds Esc, Tab, ⇧Tab, arrows, Ctrl+C, End and Enter. On Windows and Linux, Ctrl+V pastes and Ctrl+C copies a selection.
- **Shell** opens a second terminal in the same container, a plain bash shell.
- **Read** shows the conversation formatted from Claude Code's transcript: the latest turn in full, earlier turns folded to your prompt and their outcome, what's new since you last looked, search, and a box to reply. It's made for reading on a phone.
- **Questions and links.** When the agent asks something (a permission prompt, a question with options), the options show above the terminal as buttons. Links on screen show above the terminal with Open and Copy buttons, even long ones that wrap over many lines.
- **Attach files** by pasting or dropping them on the terminal, or with the paperclip. Orbital saves them in the session, outside the repo, and pastes their paths into the prompt.
- **The panel** on the right shows the session's summary, tasks, git state, conversations and settings. **Resume** next to a conversation restarts the agent on that one.
- **Run a skill** (Session menu) types a skill or command into a running Claude session.
- **Attach from the host**: the panel shows the container name and a copyable `docker exec … tmux attach` command, for when you're on the server over SSH.

### What it runs as

Under the session's header, a line shows what the session runs as: its model account, its GitHub connection, Notion and AWS profiles, and for each whether it's the organization's or the owner's own. When you watch someone else's session, the line says so, and lists which of their own sign-ins it uses.

### To do

When the agent needs you to do something it can't (sign in somewhere, run a command on your machine, approve something), it adds an item to **To do** with Orbital's own tool, including the exact command. Each item has Copy and, for commands meant for the session, **Run in Shell**. You can add your own items. With **Tell the session when I tick** on, ticking an item sends the session "Done: …" so it carries on.

The sidebar's To do badge counts the open items across your sessions. Orbital adds its own items for admins: a model account or AWS sign-in to renew, and people asking for access.

## Stop, start and restart

- **Stop** removes the container. The repo, uncommitted changes and conversations stay.
- **Start** (or **Resume** on the Sessions page) brings it back with the current image and settings, continuing the newest conversation.
- **Session → Continue newest conversation** restarts the agent in place, for example after changing its model or account. **New conversation** starts fresh in the same repo and branch.
- **Delete** stops the session and removes its clone, home folder and conversations. Pushed commits stay on GitHub.

Changes to a session's account, GitHub connection, model, permissions or Remote Control apply the next time the agent starts. A new GitHub connection or AWS profile takes effect at once, without a restart.

### Expiry

Expiry keeps sessions short-lived. A running session that's idle for a set time stops, and a stopped session is deleted a set time later, with its clone and conversations. Idle means no new conversation and nothing typed in its terminals; a session whose agent is working is never idle. Pushed commits stay on GitHub.

It's set at three levels, and the most specific one wins:

1. **Defaults**, under **Settings → General → Expiry** (admins): one pair for **sessions people start**, and one for **sessions automations start**, so triggered sessions can come and go quickly while people's stay around.
2. **A Linear rule** can set its own, for the sessions it starts (see [Automations](automations.html)).
3. **A session** can set its own: under **Expiry** on New session, or in the session's panel, by whoever can change what it runs as. Empty follows the defaults; `0` means never.

Hours and days take fractions: `0.25` hours is 15 minutes. Sessions show when they'll stop or be deleted.

## Shared sessions

A session is either personal or shared.

- **Personal**: the person who started it, and admins, control it.
- **Shared**: the organization's. Every member can start, stop, rename and type into it. Only admins change what it runs as (account, GitHub connection, AWS, model, permissions), share or unshare it, or delete it. A shared session uses only the organization's accounts, and nobody's own Notion goes with it.

Sessions from before sign-in was turned on, and sessions started by [automations](automations.html), are shared. Admins can share a session from its panel (**Shared with everyone**). If it runs on someone's own account or GitHub sign-in, switch it to one of the organization's first.

Members who run a shared session can open its Shell, and that shell has the session's credentials. Share sessions with broad credentials with care.

## Who sees which sessions

What members and viewers see of a session someone else started is set under **Settings → Sign-in & users → Other people's sessions**:

| Setting | What they see |
| --- | --- |
| **Names and status** (default) | Who started it, its repo and whether it's working. Not its terminal, conversations, files or To do. |
| **Watch everything** | Its terminal (read-only), conversations, files and To do. |
| **Nothing** | Other people's sessions don't show up. |

Whatever the setting, admins see everything, shared sessions are everyone's to see, and a session's owner can turn on **Everyone can watch** in its panel. Watching attaches to tmux read-only: nothing you type reaches the session, and the window size stays the owner's.

In the sidebar, shared sessions have an icon and other people's show their initial. The Sessions page has **Mine / Everyone**: *Mine* is your sessions and shared ones.
