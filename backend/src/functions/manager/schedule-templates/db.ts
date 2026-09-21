import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, GSI1_INDEX, TABLE_NAME, getMetadataRecord } from '../../shared/dynamo.js';
import type { ScheduleTemplateRecord } from '@daltime/contracts';

export async function getCallerLookup(
  userId: string,
): Promise<{ org_id: string; manager_id: string } | null> {
  return getMetadataRecord(userId);
}

export async function listTemplates(managerId: string): Promise<ScheduleTemplateRecord[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: GSI1_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `MANAGER#${managerId}`,
        ':prefix': 'TEMPLATE#',
      },
    }),
  );
  return (result.Items ?? []) as ScheduleTemplateRecord[];
}

export async function getTemplate(
  orgId: string,
  templateId: string,
): Promise<ScheduleTemplateRecord | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `SCHEDULE_TEMPLATE#${templateId}` },
    }),
  );
  return (result.Item as ScheduleTemplateRecord) ?? null;
}

export async function createTemplate(item: ScheduleTemplateRecord): Promise<void> {
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}

export async function updateTemplate(
  orgId: string,
  templateId: string,
  fields: { name?: string; shift_blocks?: ScheduleTemplateRecord['shift_blocks'] },
  updatedAt: string,
): Promise<ScheduleTemplateRecord | null> {
  const names: Record<string, string> = { '#updated_at': 'updated_at' };
  const values: Record<string, unknown> = { ':updated_at': updatedAt };
  const parts: string[] = ['#updated_at = :updated_at'];

  if (fields.name !== undefined) {
    names['#name'] = 'name';
    values[':name'] = fields.name;
    parts.push('#name = :name');
  }
  if (fields.shift_blocks !== undefined) {
    names['#shift_blocks'] = 'shift_blocks';
    values[':shift_blocks'] = fields.shift_blocks;
    parts.push('#shift_blocks = :shift_blocks');
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `SCHEDULE_TEMPLATE#${templateId}` },
      UpdateExpression: `SET ${parts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }),
  );
  return (result.Attributes as ScheduleTemplateRecord) ?? null;
}

export async function deleteTemplate(orgId: string, templateId: string): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: `ORG#${orgId}`, SK: `SCHEDULE_TEMPLATE#${templateId}` },
    }),
  );
}

export async function createShiftNeeded(item: Record<string, unknown>): Promise<void> {
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
}
