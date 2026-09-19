import type { NotificationRecord } from '@daltime/contracts';
import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-vitest/extend';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../../../src/functions/shared/dynamo.js';
import {
  queryNotificationsByUser,
  queryUnreadNotificationsByUser,
  getNotification,
  putNotification,
  updateNotificationRead,
} from '../../../../src/functions/shared/notifications/db.js';

const ddbMock = mockClient(docClient as unknown as DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

const sub = 'user-sub-123';

const sampleRecord: NotificationRecord = {
  PK: `USER#${sub}`,
  SK: 'NOTIFICATION#2025-01-01T00:00:00.000Z#raw-id-1',
  notification_id: '2025-01-01T00:00:00.000Z#raw-id-1',
  recipient_sub: sub,
  type: 'INFO',
  message: 'hello',
  read: false,
  created_at: '2025-01-01T00:00:00.000Z',
};

describe('queryNotificationsByUser()', () => {
  it('issues a Query scoped to USER#<sub> with begins_with NOTIFICATION#, newest first', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [sampleRecord] });

    const result = await queryNotificationsByUser(sub);

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': `USER#${sub}`,
        ':prefix': 'NOTIFICATION#',
      },
      ScanIndexForward: false,
    });
    expect(result).toEqual([sampleRecord]);
  });

  it('does not include a FilterExpression (unlike the unread variant)', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    await queryNotificationsByUser(sub);
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input).not.toHaveProperty('FilterExpression');
  });

  it('returns [] when Items is undefined', async () => {
    ddbMock.on(QueryCommand).resolves({});
    const result = await queryNotificationsByUser(sub);
    expect(result).toEqual([]);
  });

  it('scopes strictly to the given sub — never queries another user partition', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [sampleRecord] });
    await queryNotificationsByUser('attacker-sub');
    const call = ddbMock.commandCalls(QueryCommand)[0];
    expect(call.args[0].input.ExpressionAttributeValues?.[':pk']).toBe('USER#attacker-sub');
    expect(call.args[0].input.ExpressionAttributeValues?.[':pk']).not.toBe(`USER#${sub}`);
  });
});

describe('queryUnreadNotificationsByUser()', () => {
  it('issues a Query with FilterExpression read = false', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [sampleRecord] });

    const result = await queryUnreadNotificationsByUser(sub);

    expect(ddbMock).toHaveReceivedCommandWith(QueryCommand, {
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      FilterExpression: '#read = :unread',
      ExpressionAttributeNames: { '#read': 'read' },
      ExpressionAttributeValues: {
        ':pk': `USER#${sub}`,
        ':prefix': 'NOTIFICATION#',
        ':unread': false,
      },
      ScanIndexForward: false,
    });
    expect(result).toEqual([sampleRecord]);
  });

  it('returns [] when Items is undefined', async () => {
    ddbMock.on(QueryCommand).resolves({});
    const result = await queryUnreadNotificationsByUser(sub);
    expect(result).toEqual([]);
  });
});

describe('getNotification()', () => {
  it('issues a GetItem scoped to PK=USER#<sub>, SK=<sk>', async () => {
    ddbMock.on(GetCommand).resolves({ Item: sampleRecord });

    const result = await getNotification(sub, sampleRecord.SK);

    expect(ddbMock).toHaveReceivedCommandWith(GetCommand, {
      TableName: process.env.TABLE_NAME,
      Key: { PK: `USER#${sub}`, SK: sampleRecord.SK },
    });
    expect(result).toEqual(sampleRecord);
  });

  it('returns null when Item is absent (e.g. SK belongs to a different user partition)', async () => {
    ddbMock.on(GetCommand).resolves({});
    const result = await getNotification(sub, sampleRecord.SK);
    expect(result).toBeNull();
  });

  it('never substitutes another user sub into the Key even if sk contains another user marker', async () => {
    ddbMock.on(GetCommand).resolves({});
    await getNotification(sub, 'NOTIFICATION#2025-01-01T00:00:00.000Z#someone-elses-raw-id');
    expect(ddbMock).toHaveReceivedCommandWith(GetCommand, {
      TableName: process.env.TABLE_NAME,
      Key: { PK: `USER#${sub}`, SK: 'NOTIFICATION#2025-01-01T00:00:00.000Z#someone-elses-raw-id' },
    });
  });
});

describe('putNotification()', () => {
  it('issues a PutItem with the exact record', async () => {
    ddbMock.on(PutCommand).resolves({});

    await putNotification(sampleRecord);

    expect(ddbMock).toHaveReceivedCommandWith(PutCommand, {
      TableName: process.env.TABLE_NAME,
      Item: sampleRecord,
    });
  });
});

describe('updateNotificationRead()', () => {
  it('issues an UpdateItem scoped to PK=USER#<sub>, SK=<sk>, setting read=true', async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateNotificationRead(sub, sampleRecord.SK);

    expect(ddbMock).toHaveReceivedCommandWith(UpdateCommand, {
      TableName: process.env.TABLE_NAME,
      Key: { PK: `USER#${sub}`, SK: sampleRecord.SK },
      UpdateExpression: 'SET #read = :read',
      ExpressionAttributeNames: { '#read': 'read' },
      ExpressionAttributeValues: { ':read': true },
    });
  });
});
