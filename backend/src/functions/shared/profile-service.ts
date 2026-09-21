import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { stripKeys } from './dynamo.js';
import { ValidationError, ForbiddenError, NotFoundError } from './errors.js';
import { enrichSingleWithCognitoStatus } from './cognito.js';
import { logger } from './logger.js';

/** A profile record with the single-table keys removed, guaranteed to carry what enrichment needs. */
type StrippedProfile<R extends { email: string; status: string }> = Omit<
  R,
  'PK' | 'SK' | 'GSI1PK' | 'GSI1SK'
> & { email: string; status: string };

interface ProfileDb<R extends { email: string; status: string }> {
  getCallerLookup(userId: string): Promise<{ org_id: string } | null>;
  getRecord(orgId: string, userId: string): Promise<R | null>;
  updateRecord(
    orgId: string,
    userId: string,
    fields: { first_name?: string; last_name?: string; phone?: string },
    updatedAt: string,
  ): Promise<R | null>;
}

export function createProfileService<R extends { email: string; status: string }>(
  db: ProfileDb<R>,
) {
  async function resolveCallerOrg(sub: string): Promise<{ org_id: string }> {
    const lookup = await db.getCallerLookup(sub);
    if (!lookup) throw new ForbiddenError('Caller organization could not be resolved');
    return lookup;
  }

  return {
    async getProfile(callerSub: string, cognitoClient: CognitoIdentityProviderClient) {
      const { org_id } = await resolveCallerOrg(callerSub);
      const record = await db.getRecord(org_id, callerSub);
      if (!record) throw new NotFoundError('Profile not found');
      // Keep the record's full stripped type through enrichment (rather than narrowing it to
      // `{ email; status }`) so the result stays checkable against the contract response type.
      return enrichSingleWithCognitoStatus(stripKeys(record) as StrippedProfile<R>, cognitoClient);
    },

    async updateProfile(
      callerSub: string,
      body: { first_name?: string; last_name?: string; phone?: string },
    ) {
      const hasFields =
        body.first_name !== undefined || body.last_name !== undefined || body.phone !== undefined;
      if (!hasFields) throw new ValidationError('At least one field must be provided');

      if (body.first_name !== undefined && !body.first_name.trim()) {
        throw new ValidationError('first_name cannot be empty');
      }
      if (body.last_name !== undefined && !body.last_name.trim()) {
        throw new ValidationError('last_name cannot be empty');
      }

      const { org_id } = await resolveCallerOrg(callerSub);

      const fields: { first_name?: string; last_name?: string; phone?: string } = {};
      if (body.first_name !== undefined) fields.first_name = body.first_name.trim();
      if (body.last_name !== undefined) fields.last_name = body.last_name.trim();
      if (body.phone !== undefined) fields.phone = body.phone.trim();

      const updated = await db.updateRecord(org_id, callerSub, fields, new Date().toISOString());
      if (!updated) throw new NotFoundError('Profile not found');
      logger.info('profile updated', { user_id: callerSub, org_id });
      return stripKeys(updated);
    },
  };
}
