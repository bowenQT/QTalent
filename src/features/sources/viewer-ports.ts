import type {
  MaterialSourceReadResult,
  SourceReadInput,
  SourceReadResult,
} from '@/contracts/sources';
import {
  fromMaterialSource,
  fromSource,
  type OriginalContent,
  type OriginalState,
  type ViewerSource,
} from './viewer-model';

/** 873 授权读取整份原件的结果；可见一处引用不代表能读整份。 */
export type OriginalOpen =
  | { status: 'ready'; content: OriginalContent }
  | { status: 'restricted' }
  | { status: 'failed' };

/**
 * 原件查看页的读取端口。页面按这里的顺序读：先按两个标识读出处，再按种类打开原件。
 * 还没接通的读取写 null，页面照实显示「待接入」，不拿样张内容代替。
 */
export type SourceViewerPorts = {
  /** P0 出处读取（已接通）：服务端授权并记审计。 */
  readSource: (input: SourceReadInput) => Promise<SourceReadResult>;
  /** BOW-897 材料出处读取：PDF、演示文稿、视频、图片与代码；由 866 / 873 接通。 */
  readMaterialSource:
    ((input: SourceReadInput) => Promise<MaterialSourceReadResult>) | null;
  /** BOW-873 原件读取：返回短时有效的读取地址或解析后的全文；只在出处读取通过后调用。 */
  openOriginal: ((source: ViewerSource) => Promise<OriginalOpen>) | null;
};

export type ViewerRead =
  | { status: 'success'; source: ViewerSource; original: OriginalState }
  | { status: 'forbidden' | 'conflict' | 'not_found' };

// 代码出处只有提交的摘录，基线来源只有快照：两者不打开原件。
const opensOriginal = (source: ViewerSource) =>
  source.location.kind !== 'code' && source.location.kind !== 'snapshot_field';

/**
 * 读出处并打开原件。P0 读取找不到时再查材料出处：同一对标识只属于其中一种，两边都
 * 找不到才算链接失效。任何一步被拒都不带来源内容返回。
 */
export async function readForViewer(
  ports: SourceViewerPorts,
  input: SourceReadInput,
): Promise<ViewerRead> {
  let source: ViewerSource;
  const read = await ports.readSource(input);
  if (read.status === 'success') source = fromSource(read.source);
  else if (read.status !== 'not_found' || !ports.readMaterialSource)
    return failure(read);
  else {
    const material = await ports.readMaterialSource(input);
    if (material.status !== 'success') return failure(material);
    source = fromMaterialSource(material.source);
  }

  if (!ports.openOriginal || !opensOriginal(source))
    return { status: 'success', source, original: { status: 'not_connected' } };
  let original: OriginalState;
  try {
    original = await ports.openOriginal(source);
  } catch {
    // 原件读取出错不影响已授权的出处：提取照常显示，原件一侧写打不开。
    original = { status: 'failed' };
  }
  return { status: 'success', source, original };
}

function failure(
  result: Exclude<
    SourceReadResult | MaterialSourceReadResult,
    { status: 'success' }
  >,
): ViewerRead {
  // 校验失败只会是地址被改坏，对外和找不到一样。
  return {
    status: result.status === 'validation_error' ? 'not_found' : result.status,
  };
}
