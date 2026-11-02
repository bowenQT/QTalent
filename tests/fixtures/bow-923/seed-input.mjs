import { batch, CONTRACT_SHA, FIXTURE_VERSION } from './scene.mjs';

/** Input projection only: never dereference data.expected or a case's outcome. */
export function createSeedInput(data) {
  return {
    fixtureVersion: FIXTURE_VERSION,
    demo: true,
    contractSha: CONTRACT_SHA,
    notice:
      '待独立演示导入器消费的输入，不是数据库已导入的证据；人工标记为独立合成事实，不含对照计算结果。',
    batch: structuredClone(batch),
    selectionReviews: data.frontRows.map((row) => ({
      personId: row[0],
      originalGrades: data.standard.reviewPoints.map((point, index) => ({
        reviewPointId: point.id,
        grade: row[index + 6],
      })),
    })),
    manualComparabilityMarks: structuredClone(data.manualComparability.marks),
    cases: data.cases.map((unit) =>
      Object.fromEntries(
        Object.keys(unit)
          .filter((key) => key !== 'outcome')
          .map((key) => [key, structuredClone(unit[key])]),
      ),
    ),
  };
}
