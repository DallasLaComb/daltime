import type {
  EmployeeAvailabilityRecord,
  EmployeeAvailabilityOverridesRecord,
} from '@daltime/contracts';

export type {
  DayOfWeek,
  TimeSlot,
  DayAvailability,
  WeeklySchedule,
  DateOverrides,
  UpsertAvailabilityBody,
  UpsertOverridesBody,
} from '@daltime/contracts';

/** Availability items stored in DynamoDB. Shapes owned by `@daltime/contracts`. */
export type EmployeeAvailability = EmployeeAvailabilityRecord;
export type EmployeeAvailabilityOverrides = EmployeeAvailabilityOverridesRecord;
