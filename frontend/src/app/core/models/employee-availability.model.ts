import type { ApiSchema } from '../api/api-client';

/** Wire shapes come from the generated contract (`contracts/openapi.json`); do not hand-edit. */
export type DayOfWeek = ApiSchema<'DayOfWeek'>;
export type TimeSlot = ApiSchema<'TimeSlot'>;
export type DayAvailability = ApiSchema<'DayAvailability'>;
export type WeeklySchedule = ApiSchema<'WeeklySchedule'>;
export type DateOverrides = ApiSchema<'DateOverrides'>;
export type EmployeeAvailabilityResponse = ApiSchema<'EmployeeAvailabilityResponse'>;
export type EmployeeAvailabilityOverridesResponse =
  ApiSchema<'EmployeeAvailabilityOverridesResponse'>;
