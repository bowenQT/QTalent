import { inArray } from 'drizzle-orm';
import type { DbExecutor } from '../../../db/client';
import type { MaterialSource } from '../../../../contracts/sources';
import { materialParses } from '../schema';
import { auditEvents } from '../../../platform/audit/schema';
import { mediaMaterials } from './schema';
import {
  readMaterialParse,
  MaterialStoreError,
} from '../material-sources/store';

export interface MediaSourceProvenance {
  materials: (typeof mediaMaterials.$inferSelect)[];
  audit: Pick<
    typeof auditEvents.$inferSelect,
    'id' | 'action' | 'resourceId'
  >[];
  canonical: MaterialSource[];
}
/** Complete raw capture facts and verified immutable parses, never a read grant.
 * Caller must keep the SAME snapshot as inputs/graph/authority. Corrupt parses
 * contribute no readable canonical source; storage failures still propagate.
 */
export async function readMediaSourceProvenance(
  db: DbExecutor,
): Promise<{ mediaSourceProvenance?: MediaSourceProvenance }> {
  const materials = await db.select().from(mediaMaterials);
  const versions = [...new Set(materials.map((row) => row.originalVersionId))];
  const ids = [
    ...new Set(
      materials.flatMap((row) => (row.scopeAuditId ? [row.scopeAuditId] : [])),
    ),
  ];
  const audit = ids.length
    ? await db
        .select({
          id: auditEvents.id,
          action: auditEvents.action,
          resourceId: auditEvents.resourceId,
        })
        .from(auditEvents)
        .where(inArray(auditEvents.id, ids))
    : [];
  const parses = versions.length
    ? await db
        .select()
        .from(materialParses)
        .where(inArray(materialParses.originalVersionId, versions))
    : [];
  const canonical: MaterialSource[] = [];
  for (const parse of parses) {
    try {
      const value = await readMaterialParse(db, parse.id);
      if (value) canonical.push(...value.fragments);
    } catch (error) {
      if (
        !(error instanceof MaterialStoreError) ||
        error.code === 'storage_unavailable'
      )
        throw error;
    }
  }
  return { mediaSourceProvenance: { materials, audit, canonical } };
}
