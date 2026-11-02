import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INTERVIEW_IMPORT_DEMO,
  interviewImportDemoRecords,
  prepareInterviewImportDemo,
} from './import';

const fixtures = 'tests/fixtures/bow-896';
async function releaseRoot(change?: 'missing' | 'tampered') {
  const root = await mkdtemp(join(tmpdir(), 'qtalent-906-'));
  await mkdir(join(root, fixtures, 'interview'), { recursive: true });
  await copyFile(
    join(fixtures, 'candidates.json'),
    join(root, fixtures, 'candidates.json'),
  );
  for (const { key } of INTERVIEW_IMPORT_DEMO.files) {
    if (change === 'missing' && key === 'professional') continue;
    const target = join(root, fixtures, 'interview', `${key}.pdf`);
    if (change === 'tampered' && key === 'professional')
      await writeFile(target, 'not the pinned bytes');
    else await copyFile(join(fixtures, 'interview', `${key}.pdf`), target);
  }
  return root;
}

describe('demo interview import preparation', () => {
  it('reads only pinned fixtures from the release tree, without .git', async () => {
    const records = interviewImportDemoRecords(
      await prepareInterviewImportDemo(await releaseRoot()),
    );
    expect(records.rows.map((r) => r.rowId)).toEqual([
      'campus-1',
      'professional-1',
      'score-missing-1',
      'unknown-interviewer-1',
    ]);
    for (const fragment of records.fragments) {
      expect(fragment).toMatchObject({
        sourceCategory: 'historical_evaluation',
        evaluationKind: 'interview',
        demo: true,
      });
      // The 897 location carries page and text range only, never the parser box.
      expect(Object.keys(fragment.location).sort()).toEqual([
        'kind',
        'page',
        'textRange',
      ]);
      expect(fragment.excerpt.trim()).not.toBe('');
    }
    expect(records.originals.every((o) => o.title.endsWith('（演示）'))).toBe(
      true,
    );
  }, 60_000);
  it.each([
    ['missing', 'fixture_missing'],
    ['tampered', 'fixture_digest_mismatch'],
  ] as const)('refuses a %s fixture before parsing', async (change, code) => {
    await expect(
      prepareInterviewImportDemo(await releaseRoot(change)),
    ).rejects.toMatchObject({ code });
  });
});
