import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  CrudPageComponent,
  DataTableComponent,
  CardListComponent,
  ConfirmationModalComponent,
  ButtonComponent,
} from '@common-daltime';
import type { ColumnDef } from '@common-daltime';
import { OrganizationService } from '../../../services/organization.service';
import type { Organization } from '../../../core/models/organization.model';

@Component({
  selector: 'app-organizations',
  imports: [
    DatePipe,
    CrudPageComponent,
    DataTableComponent,
    CardListComponent,
    ConfirmationModalComponent,
    ButtonComponent,
  ],
  templateUrl: './organizations.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrganizationsComponent {
  private readonly orgService = inject(OrganizationService);
  private readonly router = inject(Router);

  readonly organizations = signal<Organization[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly showModal = signal(false);
  readonly showDeleteModal = signal(false);
  readonly editingOrg = signal<Organization | null>(null);
  readonly deletingOrg = signal<Organization | null>(null);
  readonly saving = signal(false);

  readonly formName = signal('');
  readonly formAddress = signal('');

  readonly columns: ColumnDef[] = [
    { header: 'ID', cssClass: 'hidden xl:table-cell' },
    { header: 'Name' },
    { header: 'Address' },
    { header: 'Org Admins' },
    { header: 'Created' },
    { header: 'Actions', cssClass: 'text-right' },
  ];

  readonly trackById = (_index: number, org: Organization): string => org.org_id;

  constructor() {
    this.loadOrganizations();
  }

  loadOrganizations(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orgService.getAll().subscribe({
      next: (orgs) => {
        this.organizations.set(orgs);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load organizations');
        this.loading.set(false);
      },
    });
  }

  openCreateModal(): void {
    this.editingOrg.set(null);
    this.formName.set('');
    this.formAddress.set('');
    this.showModal.set(true);
  }

  openEditModal(org: Organization): void {
    this.editingOrg.set(org);
    this.formName.set(org.name);
    this.formAddress.set(org.address);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.editingOrg.set(null);
  }

  saveOrganization(): void {
    if (!this.formName().trim() || !this.formAddress().trim()) return;

    this.saving.set(true);
    const editing = this.editingOrg();

    if (editing) {
      this.orgService
        .update(editing.org_id, { name: this.formName(), address: this.formAddress() })
        .subscribe({
          next: () => {
            this.saving.set(false);
            this.closeModal();
            this.loadOrganizations();
          },
          error: () => {
            this.saving.set(false);
          },
        });
    } else {
      this.orgService.create({ name: this.formName(), address: this.formAddress() }).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeModal();
          this.loadOrganizations();
        },
        error: () => {
          this.saving.set(false);
        },
      });
    }
  }

  manageAdmins(org: Organization): void {
    this.router.navigate(['/web-admin/organizations', org.org_id, 'org-admins']);
  }

  openDeleteModal(org: Organization): void {
    this.deletingOrg.set(org);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.deletingOrg.set(null);
  }

  confirmDelete(): void {
    const org = this.deletingOrg();
    if (!org) return;

    this.saving.set(true);
    this.orgService.delete(org.org_id).subscribe({
      next: () => {
        this.saving.set(false);
        this.closeDeleteModal();
        this.loadOrganizations();
      },
      error: () => {
        this.saving.set(false);
      },
    });
  }
}
