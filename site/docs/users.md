# Sign-in and users

Admins decide how people sign in, and what they may do once they're in, under **Settings → Sign-in & users**. Orbital supports a password, single sign-on with any OpenID Connect provider, and a reverse proxy that signs people in. Roles and rules decide who gets in and with what access. The local admin made at setup always works, so a broken single sign-on setup can't lock you out.

## Ways to sign in

- **Require sign-in.** Off: anyone who can reach Orbital uses it as the admin. Only use that behind a proxy that already signs people in, on a network you trust. `ORB_AUTH=disabled` does the same and overrides the UI, for recovery.
- **Password sign-in.** The email and password form on the sign-in page.
- **Single sign-on (OpenID Connect).** A *Sign in with…* button for Authentik, Authelia, Keycloak, Pocket ID, Zitadel, Google, Entra ID and others. At your provider, create a confidential web client with the redirect URI shown on the page (`https://<orbital>/api/auth/oidc/callback`). Then enter the issuer URL (**Test** checks it), client ID and secret. Groups come from the `groups` claim, or another one you name (`realm_access.roles` for Keycloak). Orbital uses the authorization code flow with PKCE.
- **Reverse proxy sign-in (forward auth).** When Authelia, Authentik's proxy outpost, oauth2-proxy, Tailscale and the like sign people in in front of Orbital, it trusts `Remote-Email`, `Remote-Name` and `Remote-Groups` (names configurable), but only from the proxy addresses you list. Make sure the proxy strips those headers from incoming requests, and that Orbital's port isn't reachable around it.

Behind a TLS reverse proxy, set **Settings → General → Public URL**, so the single sign-on redirect uses the address people use.

## Who gets in, and with which role

For single sign-on and proxy users, rules decide who may sign in and their role:

- **Allowed emails and groups.** Emails (`sam@example.com`), domains (`@example.com`) or `*`, and group names. With none, everyone your provider lets through can sign in. Admins can always sign in.
- **Admin emails and groups**, then **member emails and groups**.
- **Everyone else who's allowed in** gets the default role: *member* or *viewer*.

The rules apply at every sign-in, so someone added to or removed from a group gets the new role the next time they sign in. Each user in the list shows why they have their role, e.g. *From sign-in rules: member, by group eng*.

## Roles

| | Admin | Member | Viewer |
| --- | :---: | :---: | :---: |
| See sessions they're allowed to see, and watch them | ✓ | ✓ | ✓ |
| Start sessions | ✓ | ✓ | |
| Control their own sessions (type, stop, start, restart, delete) | ✓ | ✓ | |
| Control shared sessions (type, stop, start, rename) | ✓ | ✓ | |
| Change what a shared session runs as, share or delete it | ✓ | | |
| Control anyone's session | ✓ | | |
| Add their own model sign-ins and GitHub connections | ✓ | ✓ | |
| The organization's accounts, GitHub, profiles, AWS, Library, Automations, General | ✓ | | |
| Sign-in, users and roles | ✓ | | |

Orbital enforces these on the server, not only in the pages: an API request someone's role doesn't allow is refused. Members see **Settings → Accounts** (their own) and **Your profile**. Viewers see only **Your profile**.

### Setting a role by hand

An admin can change anyone's role in the users list. For a single sign-on user, a role set by hand **stays**: the sign-in rules no longer change it, and the user shows *Set by hand*. **Follow the rules** goes back to what the rules say. There is always at least one admin.

### A role for a while

**For a while…** on a user raises them temporarily: member for 8 hours or 7 days, or admin for 1, 8 or 24 hours. It shows as a badge (*Admin until Tue 8:05 PM*) and ends on its own, or with **End now**. Someone who is an admin only for a while can't change roles, users or sign-in settings, so they can't make it last.

### Asking for access

Viewers see **Ask for member access**, and members **Ask to be an admin**, with an optional note: on New session, and under **Settings → Your profile**. The request appears in admins' To do and at the top of **Sign-in & users**, where an admin approves it for good, for a while, or declines.

## Other people's sessions

**Other people's sessions** decides what members and viewers see of a session someone else started: **Names and status** (the default), **Watch everything**, or **Nothing**. Admins see everything, shared sessions are everyone's, and an owner can let everyone watch their session. See [Who sees which sessions](sessions.html#who-sees-which-sessions).

## Sign-in methods

A user can have a password, single sign-on, or both.

- **Single sign-on links by the provider's ID**, not by email. When someone's email changes at your provider, they stay the same Orbital user, and Orbital takes the new email at their next sign-in.
- **A password user who signs in with single sign-on** under the same email is linked, and keeps their password.
- **Link my single sign-on** (under **Your profile**) links your SSO account to the user you're signed in as, even if the emails differ.
- **Your profile** shows your sign-in methods. You can set a first password without a current one, and unlink single sign-on if you have a password. With single sign-on linked, your email comes from your provider.

Admins manage each user's email and sign-in methods with the key icon in the users list: change their email, set a password (which signs them out everywhere) or remove it, and unlink single sign-on. Orbital refuses changes that would leave someone with no way to sign in, and always keeps one admin with a password.

## Single sign-on only

Once everyone signs in through single sign-on, turn **Password sign-in** off. Orbital then refuses password sign-in for everyone except admins. Admins can still sign in with a password at `/login?local`, for when single sign-on is down. Keep at least one admin with a password for that.

## Users

People appear under **Users** the first time they sign in, with how they sign in (*Password*, *SSO*, or both) and when they last did. Removing someone signs them out. A single sign-on user who is still allowed comes back as a new user at their next sign-in.

![Sign-in & users: what people see of other people's sessions, an access request, and the users with their roles](../screenshots/sign-in.png)
