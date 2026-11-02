import { describe, expect, expectTypeOf, it } from 'vitest';
import { MAX_ATTACHMENTS } from '../../../../../contracts/media';
import {
  recordInputSchema,
  type RecordInput,
} from '../../../../../contracts/record';
import {
  mediaRecordOriginalInputSchema,
  storedRecordOriginalInputSchema,
  type MediaRecordOriginalInput,
  type StoredRecordOriginalInput,
} from './original-input';

const media: MediaRecordOriginalInput = {
  kind: 'media',
  operationId: 'operation-demo',
  materialIds: ['material-demo-a', 'material-demo-b'],
};
const text: RecordInput = {
  operation_id: ' operation-demo ',
  text: ' \n合成材料内容。\r\n ',
  attachmentIds: [' attachment-demo '],
  personId: ' person-demo ',
  projectId: null,
};

describe('internal media original input', () => {
  it('stores only material identities without inventing text, scope or defaults', () => {
    expect(mediaRecordOriginalInputSchema.parse(media)).toEqual(media);
    expect(storedRecordOriginalInputSchema.parse(media)).toEqual(media);
    expect(recordInputSchema.safeParse(media).success).toBe(false);
    expectTypeOf<StoredRecordOriginalInput>().toEqualTypeOf<
      RecordInput | MediaRecordOriginalInput
    >();
  });

  it('keeps bounded identifiers unchanged rather than normalizing their identity', () => {
    const input = {
      kind: 'media',
      operationId: 'o'.repeat(200),
      materialIds: ['m'.repeat(200), ' material-demo '],
    };
    expect(mediaRecordOriginalInputSchema.parse(input)).toEqual(input);
  });

  it('accepts the existing batch file limit and rejects one more material', () => {
    const input = {
      ...media,
      materialIds: Array.from(
        { length: MAX_ATTACHMENTS },
        (_, index) => `material-demo-${index}`,
      ),
    };
    expect(mediaRecordOriginalInputSchema.parse(input)).toEqual(input);
    expect(storedRecordOriginalInputSchema.parse(input)).toEqual(input);
    const oversized = {
      ...input,
      materialIds: [...input.materialIds, 'material-demo-extra'],
    };
    expect(mediaRecordOriginalInputSchema.safeParse(oversized).success).toBe(
      false,
    );
    expect(storedRecordOriginalInputSchema.safeParse(oversized).success).toBe(
      false,
    );
  });

  it.each(['', ' ', '\t\r\n', 'x'.repeat(201), null, 1])(
    'rejects invalid operation and material IDs: %j',
    (id) => {
      for (const input of [
        { ...media, operationId: id },
        { ...media, materialIds: [id] },
      ]) {
        expect(mediaRecordOriginalInputSchema.safeParse(input).success).toBe(
          false,
        );
        expect(storedRecordOriginalInputSchema.safeParse(input).success).toBe(
          false,
        );
      }
    },
  );

  it.each([
    [],
    ['material-demo', 'material-demo'],
    [' material-demo ', ' material-demo '],
    null,
    'material-demo',
  ])(
    'rejects empty, duplicate or malformed material lists: %j',
    (materialIds) => {
      expect(
        storedRecordOriginalInputSchema.safeParse({ ...media, materialIds })
          .success,
      ).toBe(false);
    },
  );

  it.each(['kind', 'operationId', 'materialIds'] as const)(
    'requires %s rather than supplying a default',
    (field) => {
      const input: Partial<MediaRecordOriginalInput> = { ...media };
      delete input[field];
      expect(storedRecordOriginalInputSchema.safeParse(input).success).toBe(
        false,
      );
    },
  );

  it.each([
    { text: 'not user text' },
    { source: null },
    { sourceContexts: [] },
    { permissions: ['record:write'] },
    { authorized: true },
    { actorId: 'actor-demo' },
    { personId: 'person-demo' },
    { personIds: ['person-demo'] },
    { category: 'original' },
    { occurredOn: '2026-11-01' },
    { boundAt: '2026-11-01T00:00:00Z' },
    { unexpected: undefined },
    text,
  ])('rejects text, source, scope and authority claims: %j', (extra) => {
    const input = { ...media, ...extra };
    expect(mediaRecordOriginalInputSchema.safeParse(input).success).toBe(false);
    expect(storedRecordOriginalInputSchema.safeParse(input).success).toBe(
      false,
    );
  });
});

describe('unchanged legacy text branch', () => {
  it('uses the original strict schema itself, not a broadened copy', () => {
    expect(storedRecordOriginalInputSchema.options[0]).toBe(recordInputSchema);
    expect(storedRecordOriginalInputSchema.options[1]).toBe(
      mediaRecordOriginalInputSchema,
    );
  });

  it.each([
    text,
    { ...text, attachmentIds: [], personId: null, projectId: ' project-demo ' },
    {
      ...text,
      operation_id: 'o'.repeat(201),
      attachmentIds: [' duplicate ', 'duplicate'],
    },
  ])(
    'preserves every text output and leaves source input untouched: %j',
    (input) => {
      const before = structuredClone(input);
      const expected = recordInputSchema.parse(input);
      expect(storedRecordOriginalInputSchema.parse(input)).toEqual(expected);
      expect(input).toEqual(before);
    },
  );

  it.each([
    { operation_id: '' },
    { operation_id: ' \n ' },
    { text: '' },
    { text: ' \t\r\n ' },
    { text: null },
    { attachmentIds: [' '] },
    { attachmentIds: null },
    { personId: '' },
    { projectId: ' ' },
    { actorId: 'actor-demo' },
    { kind: 'text' },
    { source: null },
    { materialIds: ['material-demo'] },
    { permissions: ['record:write'] },
  ])(
    'does not rescue invalid legacy input through the media branch: %j',
    (change) => {
      const input = { ...text, ...change };
      expect(recordInputSchema.safeParse(input).success).toBe(false);
      expect(storedRecordOriginalInputSchema.safeParse(input).success).toBe(
        false,
      );
    },
  );

  it.each([
    'operation_id',
    'text',
    'attachmentIds',
    'personId',
    'projectId',
  ] as const)('keeps the required legacy field %s', (field) => {
    const input: Partial<RecordInput> = { ...text };
    delete input[field];
    expect(recordInputSchema.safeParse(input).success).toBe(false);
    expect(storedRecordOriginalInputSchema.safeParse(input).success).toBe(
      false,
    );
  });

  it.each([null, undefined, [], 1, 'text'])(
    'rejects non-object stored inputs: %j',
    (input) => {
      expect(storedRecordOriginalInputSchema.safeParse(input).success).toBe(
        false,
      );
    },
  );
});
