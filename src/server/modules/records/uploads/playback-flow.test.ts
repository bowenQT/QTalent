import { expect, it } from 'vitest';
import { sourceReferenceSchema } from '../../../../contracts/sources';
import { readTalentSource } from '../../../authz/talent';
import { fixture } from '../../../../../tests/fixtures/upload-fake';
import { createUploadService } from './service';
import {
  createOriginalAuthorizer,
  type OriginalAccessSnapshot,
} from './access';
import { createOriginalReader } from './read';

it('plays a classified profile recording citation through current mentor authorization and the merged Kodo fake', async () => {
  const f = fixture();
  // A real one-second mono PCM WAV, synthetic silence only.
  const wav = Buffer.alloc(44 + 16000 * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const service = createUploadService(f.options);
  const grant = await service.request('uploader-account', {
    ...f.request,
    purpose: 'audio',
    filename: 'demo.wav',
    declaredMediaType: 'audio/wav',
    declaredBytes: wav.length,
  });
  await f.put(grant.objectKey, wav, 'audio/wav');
  const completed = await service.complete('uploader-account', {
    uploadId: grant.uploadId,
    receiptRef: 'notice',
    operationId: 'finish',
    expectedRevision: 1,
  });
  expect(completed.source).toBeNull();
  // This represents the later processor's classified output. Upload completion
  // never creates these identities, words, or timestamps.
  const reference = sourceReferenceSchema.parse({
    originalVersionId: completed.originalVersionId,
    fragmentId: 'classified-demo-fragment',
    location: { kind: 'recording', startMs: 0, endMs: 1000 },
  });
  if (reference.location.kind !== 'recording')
    throw new Error('Expected a recording fixture');
  const recordingLocation = reference.location;
  const snapshot: OriginalAccessSnapshot = {
    complete: true,
    records: [],
    context: {
      account: {
        id: 'mentor-account',
        personId: 'mentor',
        isSystemAdmin: false,
      },
      now: '2026-10-25',
      people: [
        { id: 'demo-person-1', noReview: false },
        { id: 'hidden-person', noReview: false },
      ],
      grants: [
        {
          accountId: 'mentor-account',
          role: 'mentor',
          scope: 'cohort',
          cohortId: 'demo-cohort',
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      assignments: [
        {
          personId: 'mentor',
          studentId: 'demo-person-1',
          cohortId: 'demo-cohort',
          kind: 'mentor',
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      enrollments: [],
      projects: [],
      members: [],
    },
    sources: [
      {
        ...reference,
        location: recordingLocation,
        subjects: [{ personId: 'demo-person-1', cohortId: 'demo-cohort' }],
        kind: 'evaluation',
        excerpt: '演示：一秒合成静音。',
      },
    ],
  };
  const visibleCitation = await readTalentSource(
    async () => snapshot,
    reference,
  );
  expect(visibleCitation).toMatchObject(reference);
  const reader = createOriginalReader({
    ...f.options,
    policy: {
      ...f.options.policy,
      canReadOriginal: createOriginalAuthorizer(async () => snapshot),
    },
  });
  const playback = await reader.grant('mentor-account', {
    fragmentId: visibleCitation!.fragmentId,
    originalVersionId: visibleCitation!.originalVersionId,
  });
  const token = new URL(playback.url, 'https://app.invalid').searchParams.get(
    'ticket',
  )!;
  const response = await reader.open('mentor-account', token);
  expect(response.headers.get('content-type')).toBe('audio/wav');
  expect(response.headers.get('content-disposition')).toContain('inline;');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(wav);
  // A different fragment in the same original becomes hidden. A still-valid
  // ticket and a tiny byte range do not bypass whole-original authorization.
  snapshot.sources.push({
    ...snapshot.sources[0],
    fragmentId: 'hidden-fragment',
    subjects: [{ personId: 'hidden-person', cohortId: 'other-cohort' }],
  });
  await expect(
    reader.open('mentor-account', token, 'bytes=0-43'),
  ).rejects.toMatchObject({ status: 'not_found' });
});
