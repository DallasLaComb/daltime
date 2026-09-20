import type { ShiftType } from '@daltime/contracts';

/**
 * Types for the generate-dummy-data feature.
 * These are local to this slice — the request body comes from the contract
 * (`@daltime/contracts`) and the availability/shift types that actually get
 * written to DynamoDB are imported from shared models.
 */

/**
 * Per-org data discovery bundle — everything the service layer needs before
 * it can generate availability records and open shifts for an org.
 */
export interface OrgBundle {
  org_id: string;
  /** Sorted ascending by email — index 0 is the zero-availability employee. */
  employee_emails_sorted: string[];
  /**
   * Map of employee_id → email so we can identify the zero-availability
   * employee by email sort and then look up the corresponding employee_id.
   */
  employee_email_to_id: Record<string, string>;
  manager_id: string;
  locations: Array<{ location_id: string; location_name: string }>;
}

/** Open shift time presets used when generating dummy data. */
export interface ShiftPreset {
  start_time: string;
  end_time: string;
  type: ShiftType;
}
