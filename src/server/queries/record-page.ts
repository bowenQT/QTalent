import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { unstable_rethrow } from 'next/navigation';
import { createClock } from '../../lib/clock';
import { getDatabase, type DbExecutor } from '../db/client';
import { getEnv } from '../env';
import { organizations, people } from '../modules/directory';
import {
  readEffectiveRuleVersion,
  readTalentEvaluationRules,
} from '../modules/evaluation-system';
import { getRecordPage } from './record-arrange';

export type RecordPagePerson = {
  id: string;
  name: string;
  hue: number;
  photo: string | null;
  orgShort: string;
};
export type RecordPageData =
  | {
      status: 'ok';
      people: RecordPagePerson[];
      projects: { id: string; name: string }[];
      dimensions: { id: string; name: string }[];
    }
  | { status: 'forbidden' | 'unavailable' };

/**
 * The record page read. Whom the account may record and which projects it may name are
 * BOW-845's `page()` answer on the server; this only adds what the page shows next to
 * those ids (organization short name, avatar hue and photo) and the dimension names of
 * the anchor rules in force today. It widens nothing: ids outside `page()` are not read.
 */
export async function getRecordPageData(): Promise<RecordPageData> {
  try {
    return await readPageData();
  } catch (error) {
    // Sign-in redirects and other Next control flow pass through; a failed read is
    // what the page states as "暂时打不开".
    unstable_rethrow(error);
    return { status: 'unavailable' };
  }
}

async function readPageData(): Promise<RecordPageData> {
  const page = await getRecordPage({});
  if (page.status === 'forbidden' || page.status === 'not_found')
    return { status: 'forbidden' };
  if (page.status !== 'success') return { status: 'unavailable' };
  const { context } = page;
  const db = getDatabase();
  const ids = context.people.map((person) => person.id);
  const rows = ids.length
    ? await db
        .select({
          id: people.id,
          hue: people.hue,
          photo: people.photo,
          orgShort: organizations.shortName,
        })
        .from(people)
        .innerJoin(organizations, eq(organizations.id, people.organizationId))
        .where(inArray(people.id, ids))
    : [];
  const shown = new Map(rows.map((row) => [row.id, row]));
  return {
    status: 'ok',
    people: context.people.flatMap((person) => {
      const row = shown.get(person.id);
      return row
        ? [
            {
              id: person.id,
              name: person.label,
              hue: row.hue,
              photo: row.photo,
              orgShort: row.orgShort,
            },
          ]
        : [];
    }),
    projects: context.projects.map((project) => ({
      id: project.id,
      name: project.label,
    })),
    dimensions: await currentDimensions(db),
  };
}

/** Dimensions that have anchors in the version effective on the business day. */
async function currentDimensions(db: DbExecutor) {
  const at = createClock(getEnv().APP_ENV).now().toISOString();
  const effective = await readEffectiveRuleVersion(db, {
    category: 'dimension_anchors',
    at,
  });
  if (effective.status !== 'success') return [];
  const rules = await readTalentEvaluationRules(db);
  const members = new Set(
    rules.anchors
      .filter((anchor) => anchor.ruleVersionId === effective.version.versionId)
      .map((anchor) => anchor.dimensionId),
  );
  return rules.dimensions
    .filter((dimension) => members.has(dimension.id))
    .map((dimension) => ({ id: dimension.id, name: dimension.name }));
}

/**
 * Anchor texts per dimension for the rule versions a draft froze. Anchors are rule
 * content, the same for every person; the per-family professional anchors (gap G6) are
 * not modeled, so `family` stays null.
 */
export async function readRecordAnchors(ruleVersions: string[]) {
  if (ruleVersions.length === 0) return [];
  const rules = await readTalentEvaluationRules(getDatabase());
  return rules.anchors
    .filter((anchor) => ruleVersions.includes(anchor.ruleVersionId))
    .map((anchor) => ({
      dimensionId: anchor.dimensionId,
      ruleVersion: anchor.ruleVersionId,
      value: anchor.value,
      text: anchor.text,
    }));
}
