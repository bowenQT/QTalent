/** Persisted identities of one fixture generation, from every file an importer
 * persists: the seed, all source rows (missing stages still register their row)
 * and the manifest's originals. `owned` belong to one generation and must never
 * be reused for changed content; `shared` are directory and rule facts several
 * generations point at, so a reused id must keep its name. */
export function seedIdentities(seed, sourceRows, manifest) {
  for (const file of [sourceRows, manifest])
    if (!file) throw new Error('source rows and manifest are required');
  if (manifest.fixtureVersion !== seed.fixtureVersion)
    throw new Error('manifest and seed are different generations');
  const owned = {
    batch: new Set([seed.batch.id]),
    mapping: new Set([seed.batch.mappingVersionId]),
    originalVersion: new Set(),
    case: new Set(),
    fragment: new Set(),
    judgment: new Set(),
    mark: new Set(),
    work: new Set(),
    team: new Set(),
  };
  const shared = { person: {}, cohort: {}, comparison: {} };
  const name = (kind, entity) => {
    shared[kind][entity.id] ??= entity.name;
    if (shared[kind][entity.id] !== entity.name)
      throw new Error(`one seed names ${kind} ${entity.id} twice`);
  };
  for (const unit of seed.cases) {
    owned.case.add(unit.id);
    owned.work.add(unit.work.workId);
    if (unit.work.teamId) owned.team.add(unit.work.teamId);
    name('person', unit.person);
    name('cohort', unit.cohort);
    name('comparison', unit.judgment);
    for (const side of ['front', 'back']) {
      const stage = unit[side];
      if (stage.state !== 'present') continue;
      owned.judgment.add(stage.judgment.judgmentId);
      name('person', stage.judgment.evaluator);
    }
  }
  for (const row of sourceRows)
    for (const side of ['front', 'back']) {
      owned.fragment.add(row[side].source.fragmentId);
      owned.originalVersion.add(row[side].source.originalVersionId);
    }
  for (const side of ['front', 'back'])
    owned.originalVersion.add(manifest.originals[side].originalVersionId);
  for (const mark of seed.manualComparabilityMarks) {
    owned.mark.add(mark.id);
    name('person', mark.markedBy);
  }
  return {
    fixtureVersion: seed.fixtureVersion,
    owned: Object.fromEntries(
      Object.entries(owned).map(([kind, ids]) => [kind, [...ids].sort()]),
    ),
    shared,
  };
}
