import * as z from 'zod';

/**
 * The single-table key attributes every stored record carries.
 *
 * See `docs/dynamodb-entity-map.md`. These are stripped by `stripKeys()` before
 * a handler responds, so they appear on entity schemas but never on API schemas.
 */
export const SingleTableKeys = z.object({
  PK: z.string().meta({ description: 'Partition key — TYPE#<id>.' }),
  SK: z.string().meta({ description: 'Sort key — item type or TYPE#<id>.' }),
  GSI1PK: z.string().optional().meta({ description: 'GSI1 partition — entity type.' }),
  GSI1SK: z.string().optional().meta({ description: 'GSI1 sort — usually created_at.' }),
});

/** The key field names, as a tuple usable with `.omit()`. */
export const KEY_FIELDS = { PK: true, SK: true, GSI1PK: true, GSI1SK: true } as const;

/**
 * Derive the API-visible shape of a stored entity by removing key attributes.
 *
 * Using this instead of hand-writing a parallel response interface is what keeps
 * the stored shape and the wire shape from drifting: add a field to the entity
 * and it appears on the response automatically.
 */
export function apiShapeOf<T extends z.ZodObject<z.ZodRawShape>>(
  entity: T,
): z.ZodObject<Omit<T['shape'], keyof typeof KEY_FIELDS>> {
  // The explicit return type is load-bearing: left to inference, the generic
  // `.omit()` result degrades to an index-signature shape once emitted to `.d.ts`,
  // silently turning every `*ApiFields` / response type into `Record<string, unknown>`.
  return entity.omit(KEY_FIELDS) as unknown as z.ZodObject<
    Omit<T['shape'], keyof typeof KEY_FIELDS>
  >;
}

export type SingleTableKeys = z.infer<typeof SingleTableKeys>;
