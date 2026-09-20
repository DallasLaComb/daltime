import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { USER_STATUS_COLOR_MAP, getUserStatusLabel } from '../../../core/utils/user-status';
import {
  CrudPageComponent,
  DataTableComponent,
  CardListComponent,
  StatusBadgeComponent,
  SearchBarComponent,
} from '@common-daltime';
import type { ColumnDef } from '@common-daltime';
import {
  WebAdminEmployeesService,
  type WebAdminEmployeeResponse,
} from '../../../services/web-admin-employees.service';

@Component({
  selector: 'app-web-admin-employees',
  imports: [
    DatePipe,
    RouterLink,
    CrudPageComponent,
    DataTableComponent,
    CardListComponent,
    StatusBadgeComponent,
    SearchBarComponent,
  ],
  templateUrl: './employees.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WebAdminEmployeesComponent {
  private readonly employeesService = inject(WebAdminEmployeesService);

  readonly allEmployees = signal<WebAdminEmployeeResponse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly query = signal('');

  readonly employees = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.allEmployees();
    return this.allEmployees().filter(
      (e) =>
        `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.org_name.toLowerCase().includes(q),
    );
  });

  readonly columns: ColumnDef[] = [
    { header: 'Name' },
    { header: 'Email' },
    { header: 'Organization' },
    { header: 'Status' },
    { header: 'Joined' },
  ];

  readonly trackById = (_index: number, emp: WebAdminEmployeeResponse): string => emp.employee_id;

  readonly statusColorMap = USER_STATUS_COLOR_MAP;

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.employeesService.getAll().subscribe({
      next: (employees) => {
        this.allEmployees.set(employees);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load employees');
        this.loading.set(false);
      },
    });
  }

  readonly statusLabel = getUserStatusLabel;

  onSearch(q: string): void {
    this.query.set(q);
  }
}
