/** 选文件时的校验规则。允许的格式、数量和大小全部由调用方传入，这里不写死任何业务清单。 */
export type FileSelectionRules = {
  /** 允许的扩展名，小写、不带点，例如 `docx`。 */
  extensions: readonly string[];
  /** 允许的格式在提示里的写法，例如「MP3 / M4A / TXT」。 */
  acceptedLabel: string;
  /** 单个文件的字节上限。 */
  maxBytes: number;
  /** 列表最多容纳几个文件（含已在列表里的）。 */
  maxFiles: number;
};

export type FileRejectReason = 'unsupported' | 'too_large';

export type RejectedFile = {
  file: File;
  reason: FileRejectReason;
  /** 不带文件名的原因，可直接放进该文件那一行；提示里需要文件名时由调用方拼。 */
  message: string;
};

export type FileSelection = {
  accepted: File[];
  rejected: RejectedFile[];
  /** 超出数量上限时有值；`message` 可直接交给 Toast。 */
  overflow: { kept: number; skipped: number; message: string } | null;
};

const KB = 1024;
const MB = KB ** 2;
const GB = KB ** 3;

function trimmed(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 字节数的展示写法：2×1024³ 写作「2 GB」，182×1024² 写作「182 MB」。 */
export function formatBytes(bytes: number) {
  if (bytes >= GB) return `${trimmed(bytes / GB)} GB`;
  if (bytes >= MB) return `${trimmed(bytes / MB)} MB`;
  return `${Math.max(1, Math.round(bytes / KB))} KB`;
}

/** 文件名的小写扩展名；没有扩展名时是空字符串。 */
export function extensionOf(name: string) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** 文件条目左侧的格式角标：大写，最多 4 个字符，没有扩展名时是「?」。 */
export function extLabel(name: string) {
  return extensionOf(name).toUpperCase().slice(0, 4) || '?';
}

/**
 * 按调用方给的规则切分一次选择的文件。先按剩余名额截取前面的文件，再逐个检查格式与大小，
 * 所以被拒绝的文件也占用名额，其余超出的文件交给调用方提示「请再选一次」。
 */
export function selectFiles(
  files: readonly File[],
  rules: FileSelectionRules,
  currentCount: number,
): FileSelection {
  const room = Math.max(rules.maxFiles - currentCount, 0);
  const considered = files.slice(0, room);
  const skipped = files.length - considered.length;
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  for (const file of considered) {
    const ext = extensionOf(file.name);
    if (!rules.extensions.includes(ext)) {
      const what = ext ? `暂不支持 .${ext} 格式` : '暂不支持没有扩展名的文件';
      rejected.push({
        file,
        reason: 'unsupported',
        message: `${what}，可以上传 ${rules.acceptedLabel}`,
      });
    } else if (file.size > rules.maxBytes) {
      rejected.push({
        file,
        reason: 'too_large',
        message: `超过单个文件 ${formatBytes(rules.maxBytes)} 的上限，请压缩或拆分后再传`,
      });
    } else accepted.push(file);
  }
  return {
    accepted,
    rejected,
    overflow:
      skipped > 0
        ? {
            kept: considered.length,
            skipped,
            message: `已加入前 ${considered.length} 个附件，其余 ${skipped} 个请再选一次`,
          }
        : null,
  };
}
