import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MobileDayListComponent, type MobileDayGroup } from './mobile-day-list';

const DAYS: MobileDayGroup[] = [
  { dateKey: '2026-09-15', label: 'Tue, Sep 15', isToday: false, count: 0 },
  { dateKey: '2026-09-16', label: 'Wed, Sep 16', isToday: true, count: 2 },
];

@Component({
  imports: [MobileDayListComponent],
  template: `
    <app-mobile-day-list [days]="days">
      <ng-template let-day>
        <p data-testid="body">body for {{ day.dateKey }}</p>
      </ng-template>
    </app-mobile-day-list>
  `,
})
class HostComponent {
  days = DAYS;
}

describe('MobileDayListComponent', () => {
  function render(): HTMLElement {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('renders one section per day and projects the body template with the day as context', () => {
    const el = render();
    const bodies = Array.from(el.querySelectorAll('[data-testid="body"]')).map((b) =>
      b.textContent?.trim(),
    );
    expect(el.querySelectorAll('[data-testid="mobile-day-section"]')).toHaveLength(2);
    expect(bodies).toEqual(['body for 2026-09-15', 'body for 2026-09-16']);
  });

  it('shows a pluralised shift count in each header', () => {
    const headers = Array.from(render().querySelectorAll('[data-testid="mobile-day-header"]'));
    expect(headers.map((h) => h.querySelector('h3')?.textContent?.trim())).toEqual([
      'Tue, Sep 15',
      'Wed, Sep 16',
    ]);
    expect(headers.map((h) => h.querySelector('span')?.textContent?.trim())).toEqual([
      '0 shifts',
      '2 shifts',
    ]);
  });

  it("marks today's header with aria-current", () => {
    const headers = render().querySelectorAll('[data-testid="mobile-day-header"]');
    expect(headers[0].getAttribute('aria-current')).toBeNull();
    expect(headers[1].getAttribute('aria-current')).toBe('date');
  });
});
