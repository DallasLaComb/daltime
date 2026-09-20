import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { MarkOneNotificationPathParams } from '@daltime/contracts';
import { getCallerSub } from '../auth.js';
import { ok, badRequest, setRequestOrigin } from '../response.js';
import { mapHandlerError } from '../errors.js';
import { parseWithContract } from '../contract-validation.js';
import { listNotifications, markOneAsRead, markAllAsRead } from './service.js';
import type { MarkAllNotificationsReadResponse, NotificationListResponse, NotificationResponse } from '@daltime/contracts';

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  const method = event.requestContext.http.method;
  const notificationId = event.pathParameters?.notificationId;

  if (method === 'OPTIONS') {
    setRequestOrigin(event.headers?.['origin']);
    return ok('');
  }

  setRequestOrigin(event.headers?.['origin']);

  const callerSub = getCallerSub(event);

  try {
    if (method === 'GET') return ok<NotificationListResponse>(await listNotifications(callerSub));

    if (method === 'PATCH') {
      if (notificationId !== undefined) {
        const { notificationId: validatedId } = parseWithContract(
          MarkOneNotificationPathParams,
          { notificationId },
        );
        return ok<NotificationResponse>(await markOneAsRead(callerSub, validatedId));
      }
      const markedCount = await markAllAsRead(callerSub);
      return ok<MarkAllNotificationsReadResponse>({ success: true, marked_count: markedCount });
    }

    return badRequest(`Unhandled route: ${method} ${event.rawPath}`);
  } catch (err) {
    return mapHandlerError(err, 'shared notifications handler');
  }
};
