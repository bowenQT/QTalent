import { describe, expect, it } from 'vitest';
import {
  extLabel,
  extensionOf,
  formatBytes,
  selectFiles,
  type FileSelectionRules,
} from './file-selection';

// 本次范围的清单只作测试数据；规则本身全部由调用方传入。
const rules: FileSelectionRules = {
  extensions: ['mp3', 'm4a', 'wav', 'aac', 'txt', 'docx', 'pdf'],
  acceptedLabel: 'MP3 / M4A / WAV / AAC / TXT / DOCX / PDF',
  maxBytes: 2 * 1024 ** 3,
  maxFiles: 10,
};

function file(name: string, size = 1024) {
  const created = new File(['x'], name);
  Object.defineProperty(created, 'size', { value: size });
  return created;
}

describe('selectFiles', () => {
  it('keeps the first files that fit and tells the caller how many were left out', () => {
    const files = Array.from({ length: 12 }, (_, i) => file(`a${i}.pdf`));
    const result = selectFiles(files, rules, 0);
    expect(result.accepted.map((f) => f.name)).toEqual(
      files.slice(0, 10).map((f) => f.name),
    );
    expect(result.overflow).toEqual({
      kept: 10,
      skipped: 2,
      message: '已加入前 10 个附件，其余 2 个请再选一次',
    });
  });

  it('counts files already in the list against the limit', () => {
    const files = [file('a.pdf'), file('b.pdf'), file('c.pdf')];
    const result = selectFiles(files, rules, 8);
    expect(result.accepted.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(result.overflow?.message).toBe(
      '已加入前 2 个附件，其余 1 个请再选一次',
    );
    expect(selectFiles(files, rules, 10).accepted).toEqual([]);
    expect(selectFiles(files, rules, 14).accepted).toEqual([]);
  });

  it('has no overflow when everything fits exactly', () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`a${i}.pdf`));
    expect(selectFiles(files, rules, 0).overflow).toBeNull();
  });

  it('rejects unsupported formats with the accepted list, matching case-insensitively', () => {
    const result = selectFiles(
      [file('方案.zip'), file('纪要.DOCX'), file('README')],
      rules,
      0,
    );
    expect(result.accepted.map((f) => f.name)).toEqual(['纪要.DOCX']);
    expect(
      result.rejected.map(({ reason, message }) => [reason, message]),
    ).toEqual([
      [
        'unsupported',
        '暂不支持 .zip 格式，可以上传 MP3 / M4A / WAV / AAC / TXT / DOCX / PDF',
      ],
      [
        'unsupported',
        '暂不支持没有扩展名的文件，可以上传 MP3 / M4A / WAV / AAC / TXT / DOCX / PDF',
      ],
    ]);
  });

  it('rejects only files strictly over the byte limit', () => {
    const result = selectFiles(
      [file('exact.pdf', 2 * 1024 ** 3), file('over.pdf', 2 * 1024 ** 3 + 1)],
      rules,
      0,
    );
    expect(result.accepted.map((f) => f.name)).toEqual(['exact.pdf']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({
      reason: 'too_large',
      message: '超过单个文件 2 GB 的上限，请压缩或拆分后再传',
    });
  });

  it('lets a rejected file use up a slot, so the rest are asked to be picked again', () => {
    const result = selectFiles(
      [file('a.zip'), file('b.pdf'), file('c.pdf')],
      { ...rules, maxFiles: 2 },
      0,
    );
    expect(result.rejected.map((r) => r.file.name)).toEqual(['a.zip']);
    expect(result.accepted.map((f) => f.name)).toEqual(['b.pdf']);
    expect(result.overflow).toMatchObject({ kept: 2, skipped: 1 });
  });

  it('follows whatever rules the caller passes', () => {
    const result = selectFiles(
      [file('a.pdf'), file('b.csv', 600)],
      { extensions: ['csv'], acceptedLabel: 'CSV', maxBytes: 500, maxFiles: 5 },
      0,
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'unsupported',
      'too_large',
    ]);
    expect(result.rejected[1].message).toBe(
      '超过单个文件 1 KB 的上限，请压缩或拆分后再传',
    );
  });
});

describe('file naming helpers', () => {
  it('formats sizes the way the prototype writes them', () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(182 * 1024 ** 2)).toBe('182 MB');
    expect(formatBytes(293 * 1024)).toBe('293 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });

  it('reads the extension from the last dot only', () => {
    expect(extensionOf('a.tar.GZ')).toBe('gz');
    expect(extensionOf('README')).toBe('');
    expect(extLabel('纪要.docx')).toBe('DOCX');
    expect(extLabel('x.markdown')).toBe('MARK');
    expect(extLabel('README')).toBe('?');
  });
});
