import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LoggerService } from './logger.service';
import { AuthService } from '../auth/auth';
import { ImpersonationService } from '../services/impersonation.service';
import type { ClientLogBatch, ClientLogEntry } from '../models/client-log.model';

function createService(authenticated: boolean) {
  const isAuthenticatedSignal = signal(authenticated);
  const roleSignal = signal<string | null>('Manager');
  const orgId = signal<string | null>('org-1');
  const viewingAs = signal<{ userId: string } | null>(null);

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AuthService,
        useValue: { isAuthenticatedSignal, roleSignal, orgId, getAccessToken: () => 'test-token' },
      },
      { provide: ImpersonationService, useValue: { viewingAs } },
    ],
  });

  return { service: TestBed.inject(LoggerService), isAuthenticatedSignal };
}

function fetchedBatches(fetchMock: ReturnType<typeof vi.fn>): ClientLogBatch[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

/** Every constructed service queues one `session_start` entry immediately — filter it out when a
 * test only cares about entries it explicitly triggered. */
function nonSessionEntries(batch: ClientLogBatch): ClientLogEntry[] {
  return batch.entries.filter((e) => e.type !== 'session_start');
}

describe('LoggerService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('never sends while unauthenticated, even across flush intervals (D5: buffer, drop on no login)', () => {
    const { service } = createService(false);

    service.info('hello');
    vi.advanceTimersByTime(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a batch with context and entries once authenticated', () => {
    const { service } = createService(true);

    service.info('order placed');
    vi.advanceTimersByTime(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/shared/client-logs');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect((init.headers as Record<string, string>)['X-Correlation-Id']).toBeTruthy();

    const [batch] = fetchedBatches(fetchMock);
    expect(batch.context.client_session_id).toBeTruthy();
    expect(batch.context.platform).toBe('web');
    expect(batch.context.authenticated).toBe(true);
    expect(batch.context.role).toBe('Manager');
    expect(batch.context.org_id).toBe('org-1');
    expect(batch.context.app_version).toBeUndefined();

    const logEntry = nonSessionEntries(batch);
    expect(logEntry).toHaveLength(1);
    expect(logEntry[0]).toMatchObject({ type: 'log', level: 'info', message: 'order placed' });
  });

  it('queues a session_start entry with device/screen fields at construction', () => {
    const { service } = createService(true);
    void service; // constructed above; nothing else to trigger

    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    const sessionStart = batch.entries.find((e) => e.type === 'session_start');
    expect(sessionStart).toBeDefined();
    expect(sessionStart?.session?.user_agent).toBeTruthy();
    expect(sessionStart?.session?.screen).toEqual({ w: expect.any(Number), h: expect.any(Number) });
    expect(sessionStart?.session?.tz).toBeTruthy();
  });

  it('attaches viewport/breakpoint/orientation to every entry', () => {
    const { service } = createService(true);

    service.info('hello');
    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    for (const entry of batch.entries) {
      expect(entry.viewport).toEqual({ w: expect.any(Number), h: expect.any(Number) });
      expect(entry.breakpoint).toBeTruthy();
      expect(entry.orientation).toBeTruthy();
    }
  });

  it('logs a viewport_change entry when the breakpoint changes on resize (debounced)', () => {
    const { service } = createService(true);
    void service;

    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true });
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(250); // resize debounce

    vi.advanceTimersByTime(10_000); // flush interval
    const [batch] = fetchedBatches(fetchMock);
    expect(batch.entries.some((e) => e.type === 'viewport_change')).toBe(true);
  });

  it('does not log a viewport_change entry when resize fires but the breakpoint/orientation is unchanged', () => {
    const { service } = createService(true);
    void service;

    // Same breakpoint/orientation as the jsdom default — a no-op "resize".
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    expect(batch.entries.some((e) => e.type === 'viewport_change')).toBe(false);
  });

  it('flushes automatically once the queue reaches 10 entries', () => {
    const { service } = createService(true);

    for (let i = 0; i < 10; i++) service.debug(`entry ${i}`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [batch] = fetchedBatches(fetchMock);
    expect(batch.entries).toHaveLength(10);
  });

  it('caps log entries at 30/min, dropping the rest (session_start is not counted against the cap)', () => {
    const { service } = createService(true);

    for (let i = 0; i < 35; i++) service.debug(`entry ${i}`);
    vi.advanceTimersByTime(10_000);

    const logEntryCount = fetchedBatches(fetchMock)
      .flatMap((b) => b.entries)
      .filter((e) => e.type === 'log').length;
    expect(logEntryCount).toBe(30);
  });

  it('de-duplicates an identical consecutive error', () => {
    const { service } = createService(true);

    service.error('boom');
    service.error('boom');
    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    expect(nonSessionEntries(batch)).toHaveLength(1);
  });

  it('does not de-duplicate a different error following an identical one', () => {
    const { service } = createService(true);

    service.error('boom');
    service.error('boom');
    service.error('different');
    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    expect(nonSessionEntries(batch).map((e) => e.message)).toEqual([
      expect.stringContaining('boom'),
      expect.stringContaining('different'),
    ]);
  });

  it('truncates an oversized message to the contract limit', () => {
    const { service } = createService(true);

    service.info('x'.repeat(1000));
    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    const [logEntry] = nonSessionEntries(batch);
    expect(logEntry.message).toHaveLength(500);
  });

  it('never logs a raw error object, only its message/stack', () => {
    const { service } = createService(true);

    service.error('lookup failed', { token: 'secret-token', userId: 'u1' });
    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    const [logEntry] = nonSessionEntries(batch);
    expect(logEntry.message).not.toContain('secret-token');
    expect(logEntry.message).toContain('[object Object]');
  });

  it('does not duplicate the message when the label already matches the error text (AppErrorHandler\'s call shape)', () => {
    const { service } = createService(true);

    service.error('Unhandled error', new Error('phase 7 test'));
    vi.advanceTimersByTime(10_000);

    const [batch] = fetchedBatches(fetchMock);
    const [logEntry] = nonSessionEntries(batch);
    expect(logEntry.message).toBe('Unhandled error: phase 7 test');
  });

  it('flushes on visibilitychange going hidden', () => {
    const { service } = createService(true);
    service.info('about to hide');

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('flips from buffering to sending once the caller authenticates mid-session', () => {
    const { service, isAuthenticatedSignal } = createService(false);

    service.info('while logged out');
    vi.advanceTimersByTime(10_000);
    expect(fetchMock).not.toHaveBeenCalled();

    isAuthenticatedSignal.set(true);
    vi.advanceTimersByTime(10_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [batch] = fetchedBatches(fetchMock);
    const logEntry = nonSessionEntries(batch);
    expect(logEntry).toHaveLength(1);
    expect(logEntry[0].message).toBe('while logged out');
  });
});
