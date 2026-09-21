import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ScheduleViewMode = 'day' | 'week' | 'month' | 'availability' | 'fill-shift';

@Component({
  selector: 'app-schedule-view-toggle',
  templateUrl: './schedule-view-toggle.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `contents` lets the buttons flex directly inside the page's segmented-control wrapper.
  host: { class: 'dt-debug contents' },
})
export class ScheduleViewToggleComponent {
  viewMode = input<ScheduleViewMode>('week');
  showAvailability = input<boolean>(true);
  viewModeChange = output<ScheduleViewMode>();
}
