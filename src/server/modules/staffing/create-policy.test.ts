import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeMembers, fingerprintSubmission } from './create-policy';
test('owner is a member exactly once, duplicate members deduplicate', () => {
  assert.deepEqual(normalizeMembers('p1', ['p1', 'p2', 'p2']), ['p1', 'p2']);
});
test('owner may remain unset', () => {
  assert.deepEqual(normalizeMembers(null, []), []);
});
test('request fingerprint ignores member ordering but preserves changed content', () => {
  const input = {
    name: '项目',
    type: '专项',
    status: '进行中',
    goal: '目标',
    ownerId: null,
    memberIds: ['p1', 'p2'],
  };
  assert.equal(
    fingerprintSubmission(input),
    fingerprintSubmission({ ...input, memberIds: ['p2', 'p1'] }),
  );
  assert.notEqual(
    fingerprintSubmission(input),
    fingerprintSubmission({ ...input, name: '另一个' }),
  );
});
