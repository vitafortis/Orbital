# Library

The Library is what every Claude session gets, set up once by an admin under **Settings → Library**: skills, MCP servers, and the reply style. Each person can also connect their own Notion, under **Settings → Accounts → Yours**. Library items apply to Claude Code sessions; Codex and Gemini sessions don't get them.

## Skills

A skill in the Library becomes a slash command in every Claude session, such as `/appsec-pr-review`. **Add a skill** takes it from one of two places:

- **Written here**: a command, a description and the skill's text. `$ARGUMENTS` is what follows the command, e.g. the pull request number from **Run a skill**.
- **From a repo**: a **Repository**, a **Branch** (empty: the default branch; a tag or commit works too), and the **Skill folder in the repo**: the folder with its `SKILL.md` (everything in the folder comes too), or a single `.md` file. Empty means `.claude/skills/<command>`. Pick the GitHub connection to read it with, or none for a public repo.

How skills reach sessions:

- They're installed into each Claude account's skills folder whenever one of its sessions starts. Repo skills are fetched first if their branch has moved.
- They come from the Library, not from the repo a session has checked out. A pull request under review can't change the skill reviewing it, and a skill kept in one repo works in sessions on any other.
- **For sessions on** limits a skill to some model accounts. Empty means all of them.
- The front matter's name is set to the command. If an account already has a skill of its own by the same name, made by hand, Orbital leaves it alone.
- They show under **Run a skill** in New session and in running sessions.

Skills from a repo are read with the organization's GitHub connections, so they keep working whoever starts the session.

## MCP servers

MCP servers give every Claude session the same tools. **Add a server**:

- **Notion**: an internal integration. In Notion, create the integration, copy its *Internal Integration Secret*, and share each page or database sessions may use with it. Sessions see only those pages, and act as the integration, not as you.
- **Command**: a stdio server, by command, arguments and environment variables.
- **URL**: an HTTP server, by URL and headers.

Secrets are stored encrypted. They reach a session as a file only the session's user can read, passed to Claude with `--mcp-config`. **For sessions on** limits a server to some model accounts. Changes apply when Claude next starts in a session.

## Reply style

Orbital asks Claude to lead with the outcome, then what needs you, then short details, so long conversations stay easy to follow. Edit it under **Reply style**, or go **Back to Orbital's**. It applies when Claude next starts in a session.

## Your Notion

Each person can connect their own Notion, under **Settings → Accounts → Yours → Notion → Connect my Notion**. Claude in the sessions you start then reaches Notion as you, through Notion's hosted MCP server: everything you can see, with edits under your name.

- You sign in on Notion's page and choose what to allow. Orbital runs the sign-in itself, so it returns to Orbital rather than to a container.
- Orbital keeps your tokens encrypted and renews them. A small relay in each session always uses the current token, so long sessions keep working.
- Only your sessions get it. Shared sessions and automations don't, since they don't run as anyone in particular.
- It applies when Claude next starts in your sessions. **Disconnect** removes it from your running sessions at once and asks Notion to revoke it.

For a team-wide Notion, use the Notion MCP server above instead.
