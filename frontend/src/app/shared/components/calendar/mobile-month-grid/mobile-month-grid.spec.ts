import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MobileMonthGridComponent } from './mobile-month-grid';
import type { DayIndicators } from '../calendar.utils';

describe('MobileMonthGridComponent', () => {
  let fixture: ComponentFixture<MobileMonthGridComponent>;
  let el: HTMLElement;

  function render(inputs: {
    month?: Date;
    selected?: Date | null;
    indicators?: DayIndicators;
  }): void {
    fixture = TestBed.createComponent(MobileMonthGridComponent);
    fixture.componentRef.setInput('month', inputs.month ?? new Date(2026, 8, 1));
    if (inputs.selected !== undefined) fixture.componentRef.setInput('selected', inputs.selected);
    if (inputs.indicators) fixture.componentRef.setInput('indicators', inputs.indicators);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  const cell = (day: number): HTMLButtonElement =>
    el.querySelector(`[data-testid="mobile-day-cell-${day}"]`) as HTMLButtonElement;

  it('renders one tappable cell per day of the month with no fixed min-width', () => {
    render({});
    expect(el.querySelectorAll('[data-testid^="mobile-day-cell-"]')).toHaveLength(30); // September
    expect(el.innerHTML).not.toContain('min-w-[');
    expect(el.innerHTML).not.toContain('overflow-x');
  });

  it('emits the tapped date', () => {
    render({});
    const emitted: Date[] = [];
    fixture.componentInstance.dateSelected.subscribe((d) => emitted.push(d));

    cell(16).click();

    expect(emitted).toHaveLength(1);
    expect([emitted[0].getFullYear(), emitted[0].getMonth(), emitted[0].getDate()]).toEqual([
      2026, 8, 16,
    ]);
  });

  it('marks the selected day with aria-pressed', () => {
    render({ selected: new Date(2026, 8, 9) });
    expect(cell(9).getAttribute('aria-pressed')).toBe('true');
    expect(cell(10).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows at most three dots and a "+" when there are more', () => {
    const indicators: DayIndicators = new Map([
      ['2026-09-05', ['morning', 'afternoon', 'night', 'unfilled', 'unfilled']],
      ['2026-09-06', ['morning']],
    ]);
    render({ indicators });

    expect(cell(5).querySelectorAll('.rounded-full.h-1\\.5')).toHaveLength(3);
    expect(cell(5).textContent).toContain('+');
    expect(cell(6).querySelectorAll('.rounded-full.h-1\\.5')).toHaveLength(1);
    expect(cell(6).textContent).not.toContain('+');
  });

  it('describes each day for screen readers, including unfilled slots', () => {
    render({ indicators: new Map([['2026-09-16', ['morning', 'unfilled']]]) });
    expect(cell(16).getAttribute('aria-label')).toBe(
      'Wednesday, September 16, 1 shift, 1 not scheduled',
    );
    expect(cell(17).getAttribute('aria-label')).toBe('Thursday, September 17, no shifts');
  });

  it('flags today with aria-current', () => {
    const today = new Date();
    render({ month: today });
    expect(cell(today.getDate()).getAttribute('aria-current')).toBe('date');
  });

  it('explains the hollow rings only when the month contains them', () => {
    render({});
    expect(el.querySelector('[data-testid="mobile-month-legend"]')).toBeNull();

    render({
      indicators: new Map([
        ['2026-09-05', ['morning', 'unfilled']],
        ['2026-09-06', ['unassigned']],
      ]),
    });
    const legend = el.querySelector('[data-testid="mobile-month-legend"]')!;
    expect(legend.textContent).toContain('No employee');
    expect(legend.textContent).toContain('Not scheduled');
  });
});
