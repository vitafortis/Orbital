# AWS

Sessions can use AWS (the AWS CLI, SDKs, Terraform) through IAM Identity Center (AWS SSO), without your AWS sign-in ever entering a session. A session gets only the roles you give it, as short-lived keys that Orbital keeps renewing. Admins set this up under **Settings → Accounts → AWS**.

## Set it up

1. **Sign in to AWS SSO** with your access portal URL (`https://<you>.awsapps.com/start`) and its region. Orbital shows a code: confirm it on the AWS page, as with `aws sso login`. Orbital keeps the token, encrypted, and renews it for as long as your Identity Center allows. When that runs out, **Sign in again** (it also shows in admins' To do).
2. **Add a profile**: pick an account and a role (permission set) the sign-in has, and name it, e.g. `prod-readonly`. **Test** gets credentials the way a session would.
3. **Give sessions profiles**: on New session, in a session's panel, or on a [repo profile](accounts.html#profiles) (`acme/infra-*` gets `sandbox-admin`, say). A new session gets AWS access only from its repo's profile, or when you pick one.

## What a session gets

For each of its profiles, that role's temporary credentials: an access key, secret and session token, valid for the role's session length (an hour by default).

- They're written to `/session/.orb/aws/credentials` and `config`, with `AWS_SHARED_CREDENTIALS_FILE` and `AWS_CONFIG_FILE` pointing there.
- Each profile is a named profile: `aws --profile prod-readonly`, or Terraform's `profile = "prod-readonly"`. The first is also the default.
- Orbital renews them about ten minutes before they expire, rewrites them when the session's profiles change, and removes them when the session stops or the profile is deleted. None of this needs a restart.
- A command that runs longer than the credentials last can fail partway through, since most tools read the keys once when they start.

The AWS CLI is in the session image. Terraform isn't (its license): add it in your own session image (see [Install](install.html#build-from-source)).

## Keep it safe

- The SSO token, which could get credentials for every account and role you have, stays in Orbital. A session can only use the roles it was given, and only until their keys expire.
- The agent can do anything its role allows. Give sessions read-only permission sets by default, and a role that can change things only where you mean it to, ideally in a sandbox account.

## Claude on Bedrock

Claude on Amazon Bedrock puts `AWS_REGION` (and its access keys, if the account uses keys) in the session's environment, and the AWS CLI prefers those to the credentials file. In such sessions, use `--profile <name>` with each command.
