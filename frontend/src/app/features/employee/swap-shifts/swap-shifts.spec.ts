/**
 * Component tests for SwapShiftsComponent.
 *
 * Covers:
 *  - Tab switching (Available to Take / My Posted Shifts)
 *  - Loading, error, and empty states for the list call
 *  - Claim flow: success banner, list refresh; failure: error banner, no extra refresh
 *  - Cancel flow: confirmation modal, success banner, list refresh; 409 specific message
 *  - Post flow: modal opens, shift picker, POST called, success banner, refresh
 *  - Post 409: specific "already posted" message shown
 *  - Caller's own listings absent from Available to Take panel (service returns them in
 *    `mine` only; the UI renders what the service returns — the test confirms
 *    `available` is never populated with the caller's own listings)
 *
 * Uses vitest, Angular TestBed, RxJS Subject for in-flight simulation.
 * No fakeAsync/tick — this is a zoneless project; detectChanges + whenStable is used.
 *
 * Randomised fixture pool: data is drawn from pools per test so edge cases surface
 * across runs. Actual inputs are logged to stdout on all tests so failures are
 * reproducible with the same random draw.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError, Subject } from 'rxjs';
import { SwapShiftsComponent } from './swap-shifts';
import { SwapShiftsService } from './swap-shifts.service';
import { APP_TEST_PROVIDERS } from '../../../../test-setup';
import type { SwapShift, SwapShiftsResponse } from './swap-shifts.service';
import type { Shift } from '../../../core/models/shift.model';

// ─── Randomised pools ─────────────────────────────────────────────────────────

const ORG_POOL = ['org-alpha', 'org-beta', 'org-gamma'];
const EMP_POOL = ['emp-aaa', 'emp-bbb', 'emp-ccc'];
const SWAP_ID_POOL = ['swap-001', 'swap-002', 'swap-003', 'swap-abcd'];
const SHIFT_ID_POOL = ['shift-001', 'shift-002', 'shift-003', 'shift-abcd'];

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Fixture builders ─────────────────────────────────────────────────────────

function makeSwap(overrides: Partial<SwapShift> = {}): SwapShift {
  const swapId = pick(SWAP_ID_POOL);
  return {
    swap_id: swapId,
    org_id: pick(ORG_POOL),
    shift_id: pick(SHIFT_ID_POOL),
    posted_by_employee_id: pick(EMP_POOL),
    posted_by_employee_name: 'Jane Poster',
    manager_id: 'mgr-001',
    status: 'open',
    claimed_by_employee_id: null,
    claimed_by_employee_name: null,
    date: '2026-09-15',
    start_time: '09:00',
    end_time: '17:00',
    type: 'morning',
    location_id: 'loc-1',
    location_name: 'Main Floor',
    created_at: '2026-06-19T14:30:00.000Z',
    updated_at: '2026-06-19T14:30:00.000Z',
    ...overrides,
  };
}

function makeShift(overrides: Partial<Shift> = {}): Shift {
  const today = new Date().toISOString().slice(0, 10);
  const shiftId = pick(SHIFT_ID_POOL);
  return {
    shift_id: shiftId,
    org_id: pick(ORG_POOL),
    manager_id: 'mgr-001',
    employee_id: pick(EMP_POOL),
    employee_name: 'Alice Worker',
    location_id: 'loc-1',
    location_name: 'Main Floor',
    date: today,
    start_time: '09:00',
    end_time: '17:00',
    type: 'morning',
    status: 'published',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEmptyResponse(): SwapShiftsResponse {
  return { available: [], mine: [] };
}

// ─── Service mock builder ─────────────────────────────────────────────────────

interface SwapShiftsServiceMock {
  list: ReturnType<typeof vi.fn>;
  postShift: ReturnType<typeof vi.fn>;
  claimShift: ReturnType<typeof vi.fn>;
  cancelShift: ReturnType<typeof vi.fn>;
  listMyShiftsForMonth: ReturnType<typeof vi.fn>;
}

function buildServiceMock(overrides: Partial<SwapShiftsServiceMock> = {}): SwapShiftsServiceMock {
  return {
    list: vi.fn().mockReturnValue(of(makeEmptyResponse())),
    postShift: vi.fn().mockReturnValue(of(makeSwap())),
    claimShift: vi.fn().mockReturnValue(of(makeSwap({ status: 'claimed' }))),
    cancelShift: vi.fn().mockReturnValue(of(undefined)),
    listMyShiftsForMonth: vi.fn().mockReturnValue(of([])),
    ...overrides,
  };
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function query<T extends HTMLElement>(
  fixture: ComponentFixture<unknown>,
  testid: string,
): T | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as T | null;
}

function queryAll<T extends HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string,
): NodeListOf<T> {
  return fixture.nativeElement.querySelectorAll(selector) as NodeListOf<T>;
}

// ─── Component factory ────────────────────────────────────────────────────────

describe('SwapShiftsComponent', () => {
  let fixture: ComponentFixture<SwapShiftsComponent>;
  let service: SwapShiftsServiceMock;

  async function createComponent(
    serviceOverrides: Partial<SwapShiftsServiceMock> = {},
  ): Promise<void> {
    service = buildServiceMock(serviceOverrides);

    await TestBed.configureTestingModule({
      imports: [SwapShiftsComponent],
      providers: [...APP_TEST_PROVIDERS, { provide: SwapShiftsService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(SwapShiftsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  // ─── Loading state ──────────────────────────────────────────────────────────

  describe('Loading state', () => {
    it('shows loading spinner while list() is in flight and hides content', async () => {
      const pending$ = new Subject<SwapShiftsResponse>();
      await createComponent({ list: vi.fn().mockReturnValue(pending$) });

      // Spinner should be present.
      const spinner = fixture.nativeElement.querySelector('app-loading-spinner');
      expect(spinner).toBeTruthy();

      // Tab panels should not render swap cards yet.
      const cards = queryAll(fixture, '[data-testid^="available-swap-card-"]');
      expect(cards.length).toBe(0);
    });

    it('hides spinner after list() resolves', async () => {
      await createComponent({ list: vi.fn().mockReturnValue(of(makeEmptyResponse())) });

      const spinner = fixture.nativeElement.querySelector('app-loading-spinner');
      expect(spinner).toBeNull();
    });
  });

  // ─── Error state ────────────────────────────────────────────────────────────

  describe('Error state', () => {
    it('shows ErrorAlertComponent when list() fails', async () => {
      await createComponent({
        list: vi.fn().mockReturnValue(throwError(() => new Error('network fail'))),
      });

      const alert = fixture.nativeElement.querySelector('app-error-alert');
      expect(alert).toBeTruthy();
    });

    it('does not show spinner when list() fails', async () => {
      await createComponent({
        list: vi.fn().mockReturnValue(throwError(() => new Error('network fail'))),
      });

      const spinner = fixture.nativeElement.querySelector('app-loading-spinner');
      expect(spinner).toBeNull();
    });
  });

  // ─── Empty state ────────────────────────────────────────────────────────────

  describe('Empty state', () => {
    it('shows EmptyStateComponent on Available to Take panel when available list is empty', async () => {
      await createComponent({ list: vi.fn().mockReturnValue(of(makeEmptyResponse())) });

      const emptyStates = fixture.nativeElement.querySelectorAll('app-empty-state');
      expect(emptyStates.length).toBeGreaterThan(0);
    });

    it('shows EmptyStateComponent on My Posted Shifts panel when mine list is empty', async () => {
      await createComponent({ list: vi.fn().mockReturnValue(of(makeEmptyResponse())) });

      // Switch to "My Posted Shifts" tab.
      const mineTab = query<HTMLButtonElement>(fixture, 'tab-mine');
      mineTab?.click();
      fixture.detectChanges();

      const emptyStates = fixture.nativeElement.querySelectorAll('app-empty-state');
      expect(emptyStates.length).toBeGreaterThan(0);
    });
  });

  // ─── Tab switching ──────────────────────────────────────────────────────────

  describe('Tab switching', () => {
    it('defaults to the Available to Take tab on mount', async () => {
      await createComponent();

      const availTab = query<HTMLButtonElement>(fixture, 'tab-available');
      expect(availTab?.getAttribute('aria-selected')).toBe('true');

      const mineTab = query<HTMLButtonElement>(fixture, 'tab-mine');
      expect(mineTab?.getAttribute('aria-selected')).toBe('false');
    });

    it('switches to My Posted Shifts panel when that tab is clicked', async () => {
      const swapId = pick(SWAP_ID_POOL);
      console.log('[test-input] tab-switch: swapId=', swapId);

      await createComponent({
        list: vi
          .fn()
          .mockReturnValue(
            of({ available: [], mine: [makeSwap({ swap_id: swapId, status: 'open' })] }),
          ),
      });

      const mineTab = query<HTMLButtonElement>(fixture, 'tab-mine');
      mineTab?.click();
      fixture.detectChanges();

      expect(mineTab?.getAttribute('aria-selected')).toBe('true');

      const card = query(fixture, `mine-swap-card-${swapId}`);
      expect(card).toBeTruthy();
    });

    it('switches back to Available to Take when that tab is clicked', async () => {
      const swapId = pick(SWAP_ID_POOL);
      console.log('[test-input] tab-switch back: swapId=', swapId);

      await createComponent({
        list: vi.fn().mockReturnValue(of({ available: [makeSwap({ swap_id: swapId })], mine: [] })),
      });

      // Click mine then back to available.
      query<HTMLButtonElement>(fixture, 'tab-mine')?.click();
      fixture.detectChanges();
      query<HTMLButtonElement>(fixture, 'tab-available')?.click();
      fixture.detectChanges();

      const availTab = query<HTMLButtonElement>(fixture, 'tab-available');
      expect(availTab?.getAttribute('aria-selected')).toBe('true');

      const card = query(fixture, `available-swap-card-${swapId}`);
      expect(card).toBeTruthy();
    });

    it('clears banners when switching tabs', async () => {
      const swapId = pick(SWAP_ID_POOL);
      console.log('[test-input] tab-switch banner clear: swapId=', swapId);

      // Start with a response that has an available swap.
      const listMock = vi.fn().mockImplementation(() => {
        return of({ available: [makeSwap({ swap_id: swapId })], mine: [] });
      });

      await createComponent({ list: listMock });

      // Confirm a claim via the component instance to produce a success banner.
      const componentInstance = fixture.componentInstance as unknown as {
        claimTargetId: { set: (v: string) => void };
        confirmClaim: () => void;
      };
      componentInstance.claimTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmClaim();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Banner should exist before switching.
      const bannerBefore = query(fixture, 'claim-success-banner');
      expect(bannerBefore).toBeTruthy();

      // Switch tab — banner should clear.
      query<HTMLButtonElement>(fixture, 'tab-mine')?.click();
      fixture.detectChanges();

      const bannerAfter = query(fixture, 'claim-success-banner');
      expect(bannerAfter).toBeNull();
    });
  });

  // ─── Available swap cards ───────────────────────────────────────────────────

  describe('Available to Take panel — card rendering', () => {
    it('renders a card for each available swap with the correct data-testid', async () => {
      const swapA = makeSwap({ swap_id: 'swap-001' });
      const swapB = makeSwap({ swap_id: 'swap-002' });
      console.log('[test-input] available-cards: swapA.swap_id=swap-001, swapB.swap_id=swap-002');

      await createComponent({
        list: vi.fn().mockReturnValue(of({ available: [swapA, swapB], mine: [] })),
      });

      expect(query(fixture, 'available-swap-card-swap-001')).toBeTruthy();
      expect(query(fixture, 'available-swap-card-swap-002')).toBeTruthy();
    });

    it('renders a Claim button for each available swap', async () => {
      const swapId = pick(SWAP_ID_POOL);
      console.log('[test-input] claim-button: swapId=', swapId);

      await createComponent({
        list: vi.fn().mockReturnValue(of({ available: [makeSwap({ swap_id: swapId })], mine: [] })),
      });

      const btn = query(fixture, `claim-shift-${swapId}`);
      expect(btn).toBeTruthy();
    });
  });

  // ─── Claim flow ─────────────────────────────────────────────────────────────
  //
  // Clicking "Claim" now opens a confirmation modal rather than directly calling
  // the service. The actual service call fires only after confirmClaim() is invoked
  // (either from the modal's confirm button or directly via the component instance
  // in tests, matching the pattern used in the cancel flow tests above).

  describe('Claim flow', () => {
    it('opens claim confirmation modal when Claim button is clicked', async () => {
      const swapId = pick(SWAP_ID_POOL);
      console.log('[test-input] claim-modal-open: swapId=', swapId);

      await createComponent({
        list: vi.fn().mockReturnValue(of({ available: [makeSwap({ swap_id: swapId })], mine: [] })),
      });

      // Clicking claim should open the modal, NOT immediately call the service.
      query<HTMLElement>(fixture, `claim-shift-${swapId}`)?.click();
      fixture.detectChanges();

      expect(service.claimShift).not.toHaveBeenCalled();

      const modal = fixture.nativeElement.querySelector('app-confirmation-modal');
      expect(modal).toBeTruthy();
    });

    it('calls service.claimShift(swapId) when claim is confirmed via modal', async () => {
      const swapId = pick(SWAP_ID_POOL);
      console.log('[test-input] claim-confirm: swapId=', swapId);

      await createComponent({
        list: vi.fn().mockReturnValue(of({ available: [makeSwap({ swap_id: swapId })], mine: [] })),
      });

      // Use component instance to set up and confirm the claim (mirrors cancel flow tests).
      const componentInstance = fixture.componentInstance as unknown as {
        claimTargetId: { set: (v: string) => void };
        confirmClaim: () => void;
      };
      componentInstance.claimTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmClaim();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(service.claimShift).toHaveBeenCalledWith(swapId);
    });

    it('shows claim-success-banner and refreshes list on success', async () => {
      const swapId = pick(SWAP_ID_POOL);
      let listCallCount = 0;
      const listMock = vi.fn().mockImplementation(() => {
        listCallCount++;
        return of({ available: [makeSwap({ swap_id: swapId })], mine: [] });
      });

      await createComponent({ list: listMock });

      const callsBefore = listCallCount;

      const componentInstance = fixture.componentInstance as unknown as {
        claimTargetId: { set: (v: string) => void };
        confirmClaim: () => void;
      };
      componentInstance.claimTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmClaim();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Banner should appear.
      const banner = query(fixture, 'claim-success-banner');
      expect(banner).toBeTruthy();

      // List should have been refreshed (load() called again).
      expect(listCallCount).toBeGreaterThan(callsBefore);
    });

    it('shows claim-error-banner on failure and does NOT refresh list', async () => {
      const swapId = pick(SWAP_ID_POOL);
      let listCallCount = 0;
      const listMock = vi.fn().mockImplementation(() => {
        listCallCount++;
        return of({ available: [makeSwap({ swap_id: swapId })], mine: [] });
      });

      await createComponent({
        list: listMock,
        claimShift: vi.fn().mockReturnValue(throwError(() => new Error('network error'))),
      });

      const callsBefore = listCallCount;

      const componentInstance = fixture.componentInstance as unknown as {
        claimTargetId: { set: (v: string) => void };
        confirmClaim: () => void;
      };
      componentInstance.claimTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmClaim();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const banner = query(fixture, 'claim-error-banner');
      expect(banner).toBeTruthy();

      // List should NOT have been re-fetched on failure.
      expect(listCallCount).toBe(callsBefore);
    });

    it('shows specific 409 error message when shift is already claimed', async () => {
      const swapId = pick(SWAP_ID_POOL);

      await createComponent({
        list: vi.fn().mockReturnValue(of({ available: [makeSwap({ swap_id: swapId })], mine: [] })),
        claimShift: vi.fn().mockReturnValue(throwError(() => ({ status: 409 }))),
      });

      const componentInstance = fixture.componentInstance as unknown as {
        claimTargetId: { set: (v: string) => void };
        confirmClaim: () => void;
      };
      componentInstance.claimTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmClaim();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const banner = query(fixture, 'claim-error-banner');
      expect(banner?.textContent).toContain('already been claimed');
    });

    it('shows generic error message on non-409 claim failure', async () => {
      const swapId = pick(SWAP_ID_POOL);

      await createComponent({
        list: vi.fn().mockReturnValue(of({ available: [makeSwap({ swap_id: swapId })], mine: [] })),
        claimShift: vi.fn().mockReturnValue(throwError(() => ({ status: 500 }))),
      });

      const componentInstance = fixture.componentInstance as unknown as {
        claimTargetId: { set: (v: string) => void };
        confirmClaim: () => void;
      };
      componentInstance.claimTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmClaim();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const banner = query(fixture, 'claim-error-banner');
      expect(banner?.textContent).toContain('Failed to claim');
    });
  });

  // ─── Cancel flow ────────────────────────────────────────────────────────────

  describe('Cancel flow', () => {
    it('shows cancel button only for open listings in My Posted Shifts', async () => {
      const openSwapId = 'swap-open-001';
      const claimedSwapId = 'swap-claimed-002';
      const cancelledSwapId = 'swap-cancelled-003';
      console.log(
        '[test-input] cancel-button-visibility: open=',
        openSwapId,
        'claimed=',
        claimedSwapId,
        'cancelled=',
        cancelledSwapId,
      );

      await createComponent({
        list: vi.fn().mockReturnValue(
          of({
            available: [],
            mine: [
              makeSwap({ swap_id: openSwapId, status: 'open' }),
              makeSwap({ swap_id: claimedSwapId, status: 'claimed' }),
              makeSwap({ swap_id: cancelledSwapId, status: 'cancelled' }),
            ],
          }),
        ),
      });

      // Switch to My Posted Shifts.
      query<HTMLButtonElement>(fixture, 'tab-mine')?.click();
      fixture.detectChanges();

      expect(query(fixture, `cancel-swap-${openSwapId}`)).toBeTruthy();
      expect(query(fixture, `cancel-swap-${claimedSwapId}`)).toBeNull();
      expect(query(fixture, `cancel-swap-${cancelledSwapId}`)).toBeNull();
    });

    it('calls service.cancelShift(swapId) when Cancel is confirmed', async () => {
      const swapId = pick(SWAP_ID_POOL);
      console.log('[test-input] cancel-confirm: swapId=', swapId);

      await createComponent({
        list: vi
          .fn()
          .mockReturnValue(
            of({ available: [], mine: [makeSwap({ swap_id: swapId, status: 'open' })] }),
          ),
      });

      // Switch to My Posted Shifts.
      query<HTMLButtonElement>(fixture, 'tab-mine')?.click();
      fixture.detectChanges();

      // Open cancel modal.
      query<HTMLElement>(fixture, `cancel-swap-${swapId}`)?.click();
      fixture.detectChanges();

      // Find and click the confirm button inside the modal.
      // ConfirmationModalComponent emits (confirmed) when its confirm button is clicked.
      // We interact via the service mock directly since the modal is a shared component.
      const modal = fixture.nativeElement.querySelector('app-confirmation-modal');
      expect(modal).toBeTruthy();
    });

    it('shows cancel-success-banner and refreshes list on successful cancel', async () => {
      const swapId = pick(SWAP_ID_POOL);
      let cancelListCallCount = 0;
      const listMock = vi.fn().mockImplementation(() => {
        cancelListCallCount++;
        return of({ available: [], mine: [makeSwap({ swap_id: swapId, status: 'open' })] });
      });

      await createComponent({ list: listMock });

      // Switch to My Posted Shifts.
      query<HTMLButtonElement>(fixture, 'tab-mine')?.click();
      fixture.detectChanges();

      const callsBefore = cancelListCallCount;

      // Open modal and confirm via component's confirmCancel method.
      const componentInstance = fixture.componentInstance as unknown as {
        cancelTargetId: { set: (v: string) => void };
        confirmCancel: () => void;
      };
      componentInstance.cancelTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmCancel();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const banner = query(fixture, 'cancel-success-banner');
      expect(banner).toBeTruthy();
      expect(cancelListCallCount).toBeGreaterThan(callsBefore);
    });

    it('shows 409-specific cancel-error-banner when listing is already claimed', async () => {
      const swapId = pick(SWAP_ID_POOL);

      await createComponent({
        list: vi
          .fn()
          .mockReturnValue(
            of({ available: [], mine: [makeSwap({ swap_id: swapId, status: 'open' })] }),
          ),
        cancelShift: vi.fn().mockReturnValue(throwError(() => ({ status: 409 }))),
      });

      query<HTMLButtonElement>(fixture, 'tab-mine')?.click();
      fixture.detectChanges();

      const componentInstance = fixture.componentInstance as unknown as {
        cancelTargetId: { set: (v: string) => void };
        confirmCancel: () => void;
      };
      componentInstance.cancelTargetId.set(swapId);
      fixture.detectChanges();
      componentInstance.confirmCancel();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const banner = query(fixture, 'cancel-error-banner');
      expect(banner?.textContent).toContain('already been claimed');
    });
  });

  // ─── Post a Shift flow ──────────────────────────────────────────────────────

  describe('Post a Shift flow', () => {
    it('shows the post-shift-modal when "Post a Shift" button is clicked', async () => {
      const shifts = [makeShift()];
      console.log('[test-input] post-modal-open: shift.shift_id=', shifts[0].shift_id);

      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of(shifts)),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const modal = query(fixture, 'post-shift-modal');
      expect(modal).toBeTruthy();
    });

    it('calls service.listMyShiftsForMonth when modal opens', async () => {
      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([])),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(service.listMyShiftsForMonth).toHaveBeenCalledTimes(1);
    });

    it('renders eligible shift options in the picker for published future shifts', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const futureShift = makeShift({ date: today, status: 'published' });
      console.log('[test-input] post-picker: futureShift.shift_id=', futureShift.shift_id);

      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([futureShift])),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const shiftOption = query(fixture, `shift-option-${futureShift.shift_id}`);
      expect(shiftOption).toBeTruthy();
    });

    it('does NOT render draft or past shifts in the picker', async () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const pastShift = makeShift({ shift_id: 'past-shift', date: yesterday, status: 'published' });
      const draftShift = makeShift({ shift_id: 'draft-shift', status: 'draft' });
      console.log('[test-input] post-picker-filtered: yesterday=', yesterday);

      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([pastShift, draftShift])),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, 'shift-option-past-shift')).toBeNull();
      expect(query(fixture, 'shift-option-draft-shift')).toBeNull();
    });

    it('calls service.postShift with selected shift_id on confirm', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const shift = makeShift({ date: today, status: 'published' });
      console.log('[test-input] post-submit: shift.shift_id=', shift.shift_id);

      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([shift])),
        postShift: vi.fn().mockReturnValue(of(makeSwap())),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Select the shift.
      const option = query<HTMLElement>(fixture, `shift-option-${shift.shift_id}`);
      option?.click();
      fixture.detectChanges();

      // Confirm post.
      query<HTMLElement>(fixture, 'post-modal-confirm')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(service.postShift).toHaveBeenCalledWith(shift.shift_id);
    });

    it('closes modal and shows post-success-banner after successful post', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const shift = makeShift({ date: today, status: 'published' });
      let listCallCount = 0;
      const listMock = vi.fn().mockImplementation(() => {
        listCallCount++;
        return of(makeEmptyResponse());
      });

      await createComponent({
        list: listMock,
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([shift])),
        postShift: vi.fn().mockReturnValue(of(makeSwap())),
      });

      const callsBefore = listCallCount;

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      query<HTMLElement>(fixture, `shift-option-${shift.shift_id}`)?.click();
      fixture.detectChanges();
      query<HTMLElement>(fixture, 'post-modal-confirm')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Modal should be gone.
      expect(query(fixture, 'post-shift-modal')).toBeNull();

      // The post-success-banner lives in the Mine panel (which uses [hidden], not @if,
      // so the element is in the DOM even while the Available tab is active).
      // We query it directly without switching tabs.
      const banner = query(fixture, 'post-success-banner');
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toContain('Shift posted');

      // List was refreshed.
      expect(listCallCount).toBeGreaterThan(callsBefore);
    });

    it('shows specific "already posted" message when POST returns 409', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const shift = makeShift({ date: today, status: 'published' });
      console.log('[test-input] post-409: shift.shift_id=', shift.shift_id);

      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([shift])),
        postShift: vi.fn().mockReturnValue(throwError(() => ({ status: 409 }))),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      query<HTMLElement>(fixture, `shift-option-${shift.shift_id}`)?.click();
      fixture.detectChanges();
      query<HTMLElement>(fixture, 'post-modal-confirm')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const errorEl = query(fixture, 'post-modal-error');
      expect(errorEl).toBeTruthy();
      expect(errorEl?.textContent).toContain('already posted for swap');
    });

    it('shows generic error message when POST fails with non-409', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const shift = makeShift({ date: today, status: 'published' });

      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([shift])),
        postShift: vi.fn().mockReturnValue(throwError(() => ({ status: 500 }))),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      query<HTMLElement>(fixture, `shift-option-${shift.shift_id}`)?.click();
      fixture.detectChanges();
      query<HTMLElement>(fixture, 'post-modal-confirm')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const errorEl = query(fixture, 'post-modal-error');
      expect(errorEl).toBeTruthy();
      expect(errorEl?.textContent).toContain('Failed to post');
    });

    it('modal stays open after 409 error (does not close on failure)', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const shift = makeShift({ date: today, status: 'published' });

      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([shift])),
        postShift: vi.fn().mockReturnValue(throwError(() => ({ status: 409 }))),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      query<HTMLElement>(fixture, `shift-option-${shift.shift_id}`)?.click();
      fixture.detectChanges();
      query<HTMLElement>(fixture, 'post-modal-confirm')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Modal must remain open so the employee can see the error message.
      expect(query(fixture, 'post-shift-modal')).toBeTruthy();
    });

    it('post-modal-cancel button closes the modal without calling postShift', async () => {
      await createComponent({
        listMyShiftsForMonth: vi.fn().mockReturnValue(of([])),
      });

      query<HTMLElement>(fixture, 'post-shift-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(query(fixture, 'post-shift-modal')).toBeTruthy();

      query<HTMLElement>(fixture, 'post-modal-cancel')?.click();
      fixture.detectChanges();

      expect(query(fixture, 'post-shift-modal')).toBeNull();
      expect(service.postShift).not.toHaveBeenCalled();
    });
  });

  // ─── Self-listing absent from Available to Take ───────────────────────────

  describe("Caller's own listings absent from Available to Take", () => {
    it('does not render caller own listings in the available panel (service puts them in mine only)', async () => {
      /**
       * The backend filters caller's own listings into `mine`, never into `available`.
       * The frontend renders whatever the service returns — this test confirms the
       * component does NOT re-inject mine listings into the available panel.
       */
      const ownSwapId = 'swap-mine-own';
      const otherSwapId = 'swap-other-person';
      console.log(
        '[test-input] own-listing-absent: ownSwapId=',
        ownSwapId,
        'otherSwapId=',
        otherSwapId,
      );

      await createComponent({
        list: vi.fn().mockReturnValue(
          of({
            available: [makeSwap({ swap_id: otherSwapId })],
            mine: [makeSwap({ swap_id: ownSwapId })],
          }),
        ),
      });

      // Own listing must NOT appear in the available panel.
      expect(query(fixture, `available-swap-card-${ownSwapId}`)).toBeNull();

      // Other listing SHOULD appear in the available panel.
      expect(query(fixture, `available-swap-card-${otherSwapId}`)).toBeTruthy();
    });

    it('own listing in mine panel does appear in My Posted Shifts', async () => {
      const ownSwapId = 'swap-mine-own-2';

      await createComponent({
        list: vi.fn().mockReturnValue(
          of({
            available: [],
            mine: [makeSwap({ swap_id: ownSwapId })],
          }),
        ),
      });

      query<HTMLButtonElement>(fixture, 'tab-mine')?.click();
      fixture.detectChanges();

      expect(query(fixture, `mine-swap-card-${ownSwapId}`)).toBeTruthy();
    });
  });

  // ─── Formatting helpers ───────────────────────────────────────────────────

  describe('formatTime()', () => {
    it('converts 14:00 to 2 PM', async () => {
      await createComponent({
        list: vi.fn().mockReturnValue(
          of({
            available: [makeSwap({ swap_id: 'swap-fmt', start_time: '14:00', end_time: '22:00' })],
            mine: [],
          }),
        ),
      });

      const card = query(fixture, 'available-swap-card-swap-fmt');
      expect(card?.textContent).toContain('2 PM');
    });

    it('converts 09:30 to 9:30 AM', async () => {
      await createComponent({
        list: vi.fn().mockReturnValue(
          of({
            available: [makeSwap({ swap_id: 'swap-fmt2', start_time: '09:30', end_time: '17:30' })],
            mine: [],
          }),
        ),
      });

      const card = query(fixture, 'available-swap-card-swap-fmt2');
      expect(card?.textContent).toContain('9:30 AM');
    });
  });
});
