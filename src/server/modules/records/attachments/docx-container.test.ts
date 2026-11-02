import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertDocxContainer } from './docx-container';
const file = () =>
  readFile(
    new URL(
      '../../../../../tests/fixtures/attachments/chinese-pages.docx',
      import.meta.url,
    ),
  );
describe('DOCX ZIP budget boundary', () => {
  it('validates real members without replacing Mammoth XML decoding', async () => {
    const bytes = await file();
    expect(() => assertDocxContainer(bytes, 1024 * 1024)).not.toThrow();
  });
  it('accepts stored members but rejects a normalized path alias before Mammoth chooses it', async () => {
    const stored = await readFile(
      new URL(
        '../../../../../tests/fixtures/attachments/stored.docx',
        import.meta.url,
      ),
    );
    expect(() => assertDocxContainer(stored, 1024 * 1024)).not.toThrow();
    const alias = await readFile(
      new URL(
        '../../../../../tests/fixtures/attachments/path-alias.docx',
        import.meta.url,
      ),
    );
    expect(() => assertDocxContainer(alias, 1024 * 1024)).toThrow(
      'invalid_content',
    );
  });
  it('rejects duplicate member names and CRC corruption before selecting content', async () => {
    const duplicate = await readFile(
      new URL(
        '../../../../../tests/fixtures/attachments/duplicate.docx',
        import.meta.url,
      ),
    );
    expect(() => assertDocxContainer(duplicate, 1024 * 1024)).toThrow(
      'invalid_content',
    );
    const bytes = Buffer.from(await file());
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const local = bytes.readUInt32LE(central + 42);
    bytes.writeUInt32LE(123, central + 16);
    bytes.writeUInt32LE(123, local + 14);
    expect(() => assertDocxContainer(bytes, 1024 * 1024)).toThrow(
      'invalid_content',
    );
  });
  it.each(['disk', 'zip64', 'encrypted', 'unsupported-compression'] as const)(
    'rejects an unsupported or inconsistent %s container',
    async (defect) => {
      const bytes = Buffer.from(await file());
      const end = bytes.length - 22,
        central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      if (defect === 'disk') bytes.writeUInt16LE(1, end + 4);
      if (defect === 'zip64') {
        bytes.writeUInt16LE(0xffff, end + 8);
        bytes.writeUInt16LE(0xffff, end + 10);
      }
      if (defect === 'encrypted') bytes.writeUInt16LE(1, central + 8);
      if (defect === 'unsupported-compression')
        bytes.writeUInt16LE(12, central + 10);
      expect(() => assertDocxContainer(bytes, 1024 * 1024)).toThrow(
        defect === 'zip64' ? 'resource_limit' : 'invalid_content',
      );
    },
  );
  it.each(['name', 'method', 'declared-size', 'disallowed-path'] as const)(
    'rejects central/local %s disagreement or aliasing',
    async (defect) => {
      const bytes = Buffer.from(await file());
      const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      const local = bytes.readUInt32LE(central + 42);
      if (defect === 'name') bytes[local + 30] = 0x21;
      if (defect === 'method') bytes.writeUInt16LE(0, central + 10);
      if (defect === 'declared-size') {
        bytes.writeUInt32LE(0, central + 24);
        bytes.writeUInt32LE(0, local + 22);
      }
      if (defect === 'disallowed-path') {
        const start = central + 46;
        bytes[start] = 0x2f;
        bytes[local + 30] = 0x2f;
      }
      expect(() => assertDocxContainer(bytes, 1024 * 1024)).toThrow(
        'invalid_content',
      );
    },
  );
  it('does not trust low declared sizes to bypass the actual inflate output cap', async () => {
    const bytes = Buffer.from(
      await readFile(
        new URL(
          '../../../../../tests/fixtures/attachments/compressed-large.docx',
          import.meta.url,
        ),
      ),
    );
    let at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    while (
      bytes
        .subarray(at + 46, at + 46 + bytes.readUInt16LE(at + 28))
        .toString() !== 'word/document.xml'
    )
      at +=
        46 +
        bytes.readUInt16LE(at + 28) +
        bytes.readUInt16LE(at + 30) +
        bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42);
    bytes.writeUInt32LE(0, at + 24);
    bytes.writeUInt32LE(0, local + 22);
    expect(() => assertDocxContainer(bytes, 2048)).toThrow('resource_limit');
  });
});
