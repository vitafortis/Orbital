# Automations

Automations start sessions without anyone clicking **New session**. Today that means Linear: label an issue, and a session starts on its own branch, works on it, and comments back on the issue. Admins set them up under **Settings → Automations**.

![Editing a Linear rule: team, label, repository, profile and first message](../screenshots/automations-rule.png)

## Linear

### Connect Linear

1. In Linear, create a personal API key: **Settings → Security & access → Personal API keys**.
2. Paste it under **Settings → Automations → Linear** and **Connect**.

Orbital asks Linear for new issues every minute, so nothing on your network has to be reachable from outside. **Check now** checks at once.

### Add a rule

**Add rule** says which issues start sessions, and how:

- **Linear team** and **When an issue has the label**: an issue in that team getting the label hands it over. The default label is `claude`.
- **Start a session on**: the repository, and optionally **From branch**.
- **GitHub account**: the connection the session uses, or none for a public repo.
- **Profile**: *None* uses the account and permissions below, *Match the repo* uses the matching [profile](accounts.html#profiles) (else the rule's own), or pick one profile.
- **First message**: a template with `{identifier}`, `{title}`, `{description}`, `{url}` and `{branch}`. Start it with a skill, such as `/my-skill {identifier}`, to run one.

Rules use only the organization's model accounts and GitHub connections, since their sessions don't run as any one person. Their sessions are [shared](sessions.html#shared-sessions).

### What happens

1. You label an issue. Within a minute, a session starts on Linear's branch name for the issue, with the issue as the first message.
2. Orbital moves the issue to In Progress and comments with a link to the session.
3. When the agent opens a pull request, Orbital comments again with a link to it. Linear's GitHub integration links the pull request to the issue through the branch name.

Issues that already had the label when you added the rule are skipped, unless you turn on **Also start sessions for issues that already have the label**. At most three sessions start per check, so labelling a dozen issues at once doesn't swamp the host. **Recent issues** lists what the rules picked up and the sessions they started.

Set **Settings → General → Public URL** if the links in comments should use a different address than the one you open Orbital at.

## Planned

Notifications to Slack, such as when a pull request review finishes, and incoming webhooks are planned.
