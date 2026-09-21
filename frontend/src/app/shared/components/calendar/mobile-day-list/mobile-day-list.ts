import {
  ChangeDetectionStrategy,
  Component,
  TemplateRef,
  contentChild,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

/** One section of the list. The page decides what goes in the body via the projected template. */
export interface MobileDayGroup {
  dateKey: string;
  /** e.g. "Wed, Sep 16" */
  label: string;
  isToday: boolean;
  /** Shown as "3 shifts" beside the label. */
  count: number;
}

/**
 * Vertical agenda for a range of days (the phone version of the week view): a sticky header per day and,
 * beneath it, whatever the page projects in `<ng-template let-day>` — each role keeps its own shift cards
 * and actions. Nothing scrolls sideways.
 */
@Component({
  selector: 'app-mobile-day-list',
  imports: [NgTemplateOutlet],
  templateUrl: './mobile-day-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'dt-debug block' },
})
export class MobileDayListComponent {
  readonly days = input.required<MobileDayGroup[]>();

  protected readonly body = contentChild.required(TemplateRef);
}
