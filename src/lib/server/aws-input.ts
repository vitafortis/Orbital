import { BadRequest, str } from './http.ts';
import { checkRegion, listAwsRoles } from './aws.ts';
import { getAwsLogin, listAwsProfiles, type AwsProfileInput } from './store.ts';

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** An AWS profile as entered: a name sessions can use, and an account and role the sign-in really has. */
export async function parseAwsProfileInput(b: Record<string, unknown>, id?: string): Promise<AwsProfileInput> {
	const name = str(b, 'name', { required: true, max: 63 })!;
	if (!PROFILE_NAME.test(name) || name === 'default') throw new BadRequest('A profile name is letters, digits, dots, dashes and underscores (not "default"), e.g. prod-readonly');
	if (listAwsProfiles().some((p) => p.name === name && p.id !== id)) throw new BadRequest(`There's already a profile named ${name}`);
	const loginId = str(b, 'loginId', { required: true })!;
	if (!getAwsLogin(loginId)) throw new BadRequest('Pick an AWS sign-in');
	const accountId = str(b, 'accountId', { required: true, max: 12 })!;
	const roleName = str(b, 'roleName', { required: true, max: 128 })!;
	if (!(await listAwsRoles(loginId, accountId)).includes(roleName)) throw new BadRequest(`The sign-in has no role ${roleName} in account ${accountId}`);
	return {
		name,
		loginId,
		accountId,
		accountName: str(b, 'accountName', { max: 200 }) ?? null,
		roleName,
		region: checkRegion(str(b, 'region', { required: true, max: 30 })!)
	};
}
