import { ErrorHandler, Injectable, inject } from '@angular/core';
import { LoggerService } from './logger.service';

/** Global `ErrorHandler`: routes every uncaught error (component, template, async) to the logger. */
@Injectable()
export class AppErrorHandler implements ErrorHandler {
  private readonly logger = inject(LoggerService);

  handleError(error: unknown): void {
    // `LoggerService.error` already appends the error's own message/stack — pass a fixed label here
    // so it isn't duplicated (an Error's `.message` would otherwise appear on both sides of the colon).
    this.logger.error('Unhandled error', error);
  }
}
