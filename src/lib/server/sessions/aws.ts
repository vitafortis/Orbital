/**
 * A session's AWS credentials, as the standard AWS files in its .orb folder (/session/.orb/aws
 * in the container), which the AWS CLI, the SDKs and Terraform all read:
 *
 *   credentials   one [name] section per AWS profile, the first also as [default]
 *   config        each profile's region
 *
 * Only role credentials go in: one account and role per profile, expiring within the role's
 * session length. They're renewed before they expire while the session runs, rewritten when
 * the session's profiles change, and removed when it stops or a profile is deleted.
 */
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { credentialsDue, profileCredentials } from '../aws.ts';
import { getAwsProfile, listSessions } from '../store.ts';
import type { Session, SessionAws } from '#lib/types.ts';
import { metaDir } from './storage.ts';

const IN_CONTAINER = '/session/.orb/aws';

/** Environment for session containers: where AWS tools find the session's credentials. */
export const AWS_ENV = [`AWS_SHARED_CREDENTIALS_FILE=${IN_CONTAINER}/credentials`, `AWS_CONFIG_FILE=${IN_CONTAINER}/config`];

// What each session was last given, for the session panel.
const delivered = new Map<string, SessionAws[]>();
// Sessions that failed are retried at most once a minute.
const lastTry = new Map<string, number>();

export function sessionAws(id: string): SessionAws[] {
	return delivered.get(id) ?? [];
}

function write(path: string, text: string) {
	writeFileSync(path, text, { mode: 0o600 });
	chmodSync(path, 0o600);
}

/** Writes the session's credential files (or removes them: stopped, or no profiles). */
export async function writeAwsCredentials(s: Pick<Session, 'id' | 'awsProfileIds'>, opts: { remove?: boolean } = {}) {
	const dir = join(metaDir(s.id), 'aws');
	const profiles = opts.remove ? [] : s.awsProfileIds.map((id) => getAwsProfile(id)).filter((p) => !!p);
	if (!profiles.length) {
		rmSync(dir, { recursive: true, force: true });
		delivered.delete(s.id);
		return;
	}
	if (!existsSync(metaDir(s.id))) return;
	lastTry.set(s.id, Date.now());
	const status: SessionAws[] = [];
	const creds: string[] = [];
	const config: string[] = [];
	for (const [i, p] of profiles.entries()) {
		try {
			const c = await profileCredentials(p);
			const keys = `aws_access_key_id = ${c.accessKeyId}\naws_secret_access_key = ${c.secretAccessKey}\naws_session_token = ${c.sessionToken}\n`;
			const names = i === 0 ? ['default', p.name] : [p.name];
			for (const n of names) {
				creds.push(`[${n}]\n${keys}`);
				config.push(`[${n === 'default' ? 'default' : `profile ${n}`}]\nregion = ${p.region}\n`);
			}
			status.push({ profileId: p.id, name: p.name, expiresAt: new Date(c.expiresAt).toISOString(), error: null });
		} catch (err) {
			status.push({ profileId: p.id, name: p.name, expiresAt: null, error: err instanceof Error ? err.message : String(err) });
		}
	}
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	write(join(dir, 'credentials'), creds.join('\n'));
	write(join(dir, 'config'), config.join('\n'));
	delivered.set(s.id, status);
}

const live = (s: Session) => s.status === 'running' || s.status === 'starting';

/** Renews credentials that are about to expire, in every running session (from the live poll). */
export async function renewAwsCredentials() {
	for (const s of listSessions()) {
		if (!live(s) || !s.awsProfileIds.length) continue;
		const failed = sessionAws(s.id).some((a) => a.error);
		const due = s.awsProfileIds.some((id) => credentialsDue(id));
		if ((due || failed) && Date.now() - (lastTry.get(s.id) ?? 0) > 60_000) await writeAwsCredentials(s).catch(() => {});
	}
}

/** After a profile or sign-in changes or goes: running sessions using it get rewritten files. */
export async function refreshAwsCredentials(match: (s: Session) => boolean) {
	for (const s of listSessions()) if (live(s) && match(s)) await writeAwsCredentials(s).catch(() => {});
}
