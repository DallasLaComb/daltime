import { TestBed } from '@angular/core/testing';
import { AppErrorHandler } from './error-handler';
import { LoggerService } from './logger.service';

describe('AppErrorHandler', () => {
  const logger = { error: vi.fn() };

  beforeEach(() => {
    logger.error.mockClear();
    TestBed.configureTestingModule({
      providers: [AppErrorHandler, { provide: LoggerService, useValue: logger }],
    });
  });

  it('routes an Error instance to the logger with a fixed label (LoggerService appends the message itself)', () => {
    const handler = TestBed.inject(AppErrorHandler);
    const err = new Error('template threw');

    handler.handleError(err);

    expect(logger.error).toHaveBeenCalledWith('Unhandled error', err);
  });

  it('routes a non-Error thrown value the same way', () => {
    const handler = TestBed.inject(AppErrorHandler);

    handler.handleError('a rejected promise reason');

    expect(logger.error).toHaveBeenCalledWith('Unhandled error', 'a rejected promise reason');
  });
});
