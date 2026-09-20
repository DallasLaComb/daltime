import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { SwapShiftsService, type SwapShift } from './swap-shifts.service';
import type { Shift } from '../../../core/models/shift.model';
import {
  ButtonComponent,
  LoadingSpinnerComponent,
  ErrorAlertComponent,
  EmptyStateComponent,
  ConfirmationModalComponent,
  StatusBadgeComponent,
} from '@common-daltime';

/** The two panels on this page. */
type ActiveTab = 'available' | 'mine';

/**
 * Color map for swap listing status badges.
 * Keys match the `status` values returned by the API ('open', 'claimed', 'cancelled').
 */
const SWAP_STATUS_COLOR_MAP: Record<string, string> = {
  open: 'badge-dt-warning',
  claimed: 'badge-dt-success',
  cancelled: 'badge-dt-secondary',
};

/**
 * Swap Shifts page for Employees.
 * Two tabs:
 *  - "Available to Take" — open listings from other employees; employee can claim any.
 *  - "My Posted Shifts" — all listings the caller has posted (any status); can cancel open ones.
 *
 * Both panels are loaded in a single GET request on mount and refreshed after
 * each mutating action (post, claim, cancel).
 */
@Component({
  selector: 'app-swap-shifts',
  imports: [
    ButtonComponent,
    LoadingSpinnerComponent,
    ErrorAlertComponent,
    EmptyStateComponent,
    ConfirmationModalComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './swap-shifts.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwapShiftsComponent {
  private readonly service = inject(SwapShiftsService);

  // ── Tab ────────────────────────────────────────────────────────────────────

  /** Currently active panel. Defaults to Available to Take. */
  protected readonly activeTab = signal<ActiveTab>('available');

  // ── List state ──────────────────────────────────────────────────────────────

  /** All available-to-take listings (other employees). Populated by load(). */
  protected readonly available = signal<SwapShift[]>([]);

  /** All listings the caller has posted (all statuses). Populated by load(). */
  protected readonly mine = signal<SwapShift[]>([]);

  /** True while the initial or refreshed GET is in flight. */
  protected readonly loading = signal(true);

  /** Error message when the GET /swap-shifts call fails. */
  protected readonly listError = signal<string | null>(null);

  // ── Swap status color map (used by app-status-badge in the template) ────────

  /** Color map keyed by swap status values; passed to app-status-badge. */
  protected readonly swapStatusColorMap = SWAP_STATUS_COLOR_MAP;

  // ── Action state — claim ────────────────────────────────────────────────────

  /** swapId targeted by the claim confirmation modal. */
  protected readonly claimTargetId = signal<string | null>(null);

  /** True while the POST .../claim request is in flight (drives modal saving state). */
  protected readonly claiming = signal(false);

  /** swapId being claimed; drives loading spinner on the specific card button. */
  protected readonly claimingId = signal<string | null>(null);

  /** Success message after a successful claim; cleared on next action. */
  protected readonly claimSuccess = signal<string | null>(null);

  /** Error message when a claim fails. */
  protected readonly claimError = signal<string | null>(null);

  // ── Action state — cancel ───────────────────────────────────────────────────

  /** swapId targeted by the cancel confirmation modal. */
  protected readonly cancelTargetId = signal<string | null>(null);

  /** True while the DELETE /swap-shifts/{id} request is in flight. */
  protected readonly cancelling = signal(false);

  /** Success message after a successful cancel; cleared on next action. */
  protected readonly cancelSuccess = signal<string | null>(null);

  /** Error message when a cancel fails. */
  protected readonly cancelError = signal<string | null>(null);

  // ── Post shift modal ────────────────────────────────────────────────────────

  /** True when the "Post a Shift" modal is open. */
  protected readonly postModalOpen = signal(false);

  /** Shifts fetched for the current month, shown in the shift picker. */
  protected readonly myShifts = signal<Shift[]>([]);

  /** True while fetching the caller's shifts for the picker. */
  protected readonly shiftsLoading = signal(false);

  /** Error message when fetching own shifts for the picker fails. */
  protected readonly shiftsError = signal<string | null>(null);

  /** The shift_id the employee has selected in the picker. */
  protected readonly selectedShiftId = signal<string | null>(null);

  /** True while the POST /swap-shifts request is in flight. */
  protected readonly posting = signal(false);

  /** Error message when the post fails. */
  protected readonly postError = signal<string | null>(null);

  /** Success message after a successful post. */
  protected readonly postSuccess = signal<string | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  /**
   * True when the claim confirmation modal should be shown.
   * Driven by claimTargetId being non-null.
   */
  protected readonly claimModalOpen = computed(() => this.claimTargetId() !== null);

  /**
   * True when the cancel confirmation modal should be shown.
   * Driven by cancelTargetId being non-null.
   */
  protected readonly cancelModalOpen = computed(() => this.cancelTargetId() !== null);

  /**
   * The shift object selected in the picker, or null if none selected.
   * Used in the confirmation label so the employee sees what they're posting.
   */
  protected readonly selectedShift = computed((): Shift | null => {
    const id = this.selectedShiftId();
    if (!id) return null;
    return this.myShifts().find((s) => s.shift_id === id) ?? null;
  });

  /**
   * Only published, future shifts can be posted for swap.
   * Filters the myShifts list client-side so the picker only shows eligible shifts.
   */
  protected readonly eligibleShifts = computed((): Shift[] => {
    const today = new Date().toISOString().slice(0, 10);
    return this.myShifts().filter((s) => s.status === 'published' && s.date >= today);
  });

  constructor() {
    // Load both panels on mount.
    this.load();
  }

  // ── Tab switching ──────────────────────────────────────────────────────────

  /**
   * Switches the active panel and clears stale banners from the previous panel.
   */
  protected setTab(tab: ActiveTab): void {
    this.activeTab.set(tab);
    this.claimSuccess.set(null);
    this.claimError.set(null);
    this.cancelSuccess.set(null);
    this.cancelError.set(null);
    this.postSuccess.set(null);
    this.postError.set(null);
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  /**
   * Fetches both panels (available + mine) in one GET request.
   * Called on mount and after every mutating action to keep lists fresh.
   */
  protected load(): void {
    this.loading.set(true);
    this.listError.set(null);
    this.service.list().subscribe({
      next: (res) => {
        this.available.set(res.available);
        this.mine.set(res.mine);
        this.loading.set(false);
      },
      error: () => {
        this.listError.set('Failed to load swap shifts. Please try again.');
        this.loading.set(false);
      },
    });
  }

  // ── Claim ──────────────────────────────────────────────────────────────────

  /**
   * Opens the claim confirmation modal for the given swap listing.
   * The actual POST is not sent until the employee confirms in the modal.
   */
  protected openClaimModal(swapId: string): void {
    this.claimTargetId.set(swapId);
    this.claimError.set(null);
    this.claimSuccess.set(null);
  }

  /** Closes the claim confirmation modal without sending a request. */
  protected closeClaimModal(): void {
    this.claimTargetId.set(null);
  }

  /**
   * Sends POST .../claim after the employee confirms in the modal.
   * Refreshes both panels after success so the listing disappears from Available.
   */
  protected confirmClaim(): void {
    const swapId = this.claimTargetId();
    if (!swapId) return;

    this.claiming.set(true);
    this.claimingId.set(swapId);
    this.service.claimShift(swapId).subscribe({
      next: () => {
        this.claiming.set(false);
        this.claimingId.set(null);
        this.claimTargetId.set(null);
        this.claimSuccess.set('Shift claimed successfully.');
        this.load();
      },
      error: (err: { status?: number }) => {
        this.claiming.set(false);
        this.claimingId.set(null);
        this.claimTargetId.set(null);
        if (err.status === 409) {
          this.claimError.set('This shift has already been claimed by someone else.');
        } else {
          this.claimError.set('Failed to claim the shift. Please try again.');
        }
      },
    });
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  /**
   * Opens the cancel confirmation modal for the given swap listing.
   * The actual DELETE is not sent until the employee confirms.
   */
  protected openCancelModal(swapId: string): void {
    this.cancelTargetId.set(swapId);
    this.cancelError.set(null);
    this.cancelSuccess.set(null);
  }

  /** Closes the cancel confirmation modal without sending a request. */
  protected closeCancelModal(): void {
    this.cancelTargetId.set(null);
  }

  /**
   * Sends DELETE /employee/swap-shifts/{swapId} after the employee confirms.
   * Refreshes both panels on success so the listing status updates.
   */
  protected confirmCancel(): void {
    const swapId = this.cancelTargetId();
    if (!swapId) return;

    this.cancelling.set(true);
    this.service.cancelShift(swapId).subscribe({
      next: () => {
        this.cancelling.set(false);
        this.cancelTargetId.set(null);
        this.cancelSuccess.set('Swap listing cancelled successfully.');
        this.load();
      },
      error: (err: { status?: number }) => {
        this.cancelling.set(false);
        if (err.status === 409) {
          this.cancelError.set('This listing has already been claimed and cannot be cancelled.');
        } else {
          this.cancelError.set('Failed to cancel the listing. Please try again.');
        }
        this.cancelTargetId.set(null);
      },
    });
  }

  // ── Post a Shift ───────────────────────────────────────────────────────────

  /**
   * Opens the "Post a Shift" modal and fetches the employee's shifts for the
   * current month to populate the picker.
   */
  protected openPostModal(): void {
    this.postModalOpen.set(true);
    this.selectedShiftId.set(null);
    this.postError.set(null);
    this.postSuccess.set(null);
    this.loadMyShifts();
  }

  /** Closes the post modal without submitting. */
  protected closePostModal(): void {
    this.postModalOpen.set(false);
    this.selectedShiftId.set(null);
  }

  /**
   * Loads the caller's published shifts for the current month into the picker.
   * Called only when the post modal opens to avoid unnecessary requests.
   */
  private loadMyShifts(): void {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    this.shiftsLoading.set(true);
    this.shiftsError.set(null);
    this.service.listMyShiftsForMonth(month).subscribe({
      next: (shifts) => {
        this.myShifts.set(shifts);
        this.shiftsLoading.set(false);
      },
      error: () => {
        this.shiftsError.set('Failed to load your shifts. Please try again.');
        this.shiftsLoading.set(false);
      },
    });
  }

  /**
   * Sets the shift_id the employee has selected in the picker.
   * Called from the template's shift-option click/keyboard handler.
   */
  protected selectShift(shiftId: string): void {
    this.selectedShiftId.set(shiftId);
  }

  /**
   * Submits POST /employee/swap-shifts with the selected shift_id.
   * 409 → specific "already posted" message.
   * On success, closes the modal and refreshes both panels.
   */
  protected submitPost(): void {
    const shiftId = this.selectedShiftId();
    if (!shiftId) return;

    this.posting.set(true);
    this.postError.set(null);
    this.service.postShift(shiftId).subscribe({
      next: () => {
        this.posting.set(false);
        this.postModalOpen.set(false);
        this.selectedShiftId.set(null);
        this.postSuccess.set('Shift posted for swap successfully.');
        this.load();
      },
      error: (err: { status?: number }) => {
        this.posting.set(false);
        if (err.status === 409) {
          this.postError.set('Shift is already posted for swap.');
        } else {
          this.postError.set('Failed to post the shift for swap. Please try again.');
        }
      },
    });
  }

  // ── Formatting helpers ──────────────────────────────────────────────────────

  /**
   * Converts HH:MM 24-hour time to a 12-hour display string.
   * e.g. "14:00" → "2:00 PM", "09:30" → "9:30 AM".
   */
  protected formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const period = h < 12 ? 'AM' : 'PM';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour} ${period}` : `${hour}:${String(m).padStart(2, '0')} ${period}`;
  }

  /**
   * Formats YYYY-MM-DD to a human-friendly string.
   * e.g. "2026-06-19" → "Thu, Jun 19"
   */
  protected formatDate(dateStr: string): string {
    const [y, mo, d] = dateStr.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString('default', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  /** TrackBy function for swap shift lists. */
  protected trackBySwapId(_index: number, swap: SwapShift): string {
    return swap.swap_id;
  }

  /** TrackBy function for the shift picker list. */
  protected trackByShiftId(_index: number, shift: Shift): string {
    return shift.shift_id;
  }
}
