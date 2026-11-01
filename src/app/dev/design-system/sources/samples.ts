import {
  materialSourceSchema,
  sourceSchema,
  type MaterialSource,
  type SourceReadInput,
  type Source,
} from '@/contracts/sources';
import {
  fromMaterialSource,
  fromSource,
  type OriginalState,
  type ViewerSource,
} from '@/features/sources/viewer-model';

/**
 * 原件查看器样张：六种定位、代码出处、基线来源和「原件待接入」。全部是合成的演示材料，
 * 人名沿用原型的化名；来源先按契约校验再转成查看器的形状，和真实读取走同一条路。
 */
export const SAMPLE_VIEW = '/dev/design-system/sources/view';

export type SourceSample = {
  label: string;
  source: ViewerSource;
  original: OriginalState;
};

const p0 = (value: Source) => fromSource(sourceSchema.parse(value));
const material = (value: MaterialSource) =>
  fromMaterialSource(materialSourceSchema.parse(value));
const ids = (key: string) => ({
  fragmentId: `demo-frag-${key}`,
  originalVersionId: `demo-ver-${key}`,
});
const range = (text: string, quote: string) => {
  const start = text.indexOf(quote);
  return { start, end: start + quote.length };
};

const pdfPage =
  '复盘结论：排查缓存问题时先按请求链路缩小范围，再逐个验证假设。本周两次线上告警都在半小时内定位到具体服务。下周把这套排查步骤写进值班手册。';
const pdfQuote = '本周两次线上告警都在半小时内定位到具体服务';

const shot = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480"><rect width="360" height="480" fill="#f2f4f6"/><rect x="0" y="0" width="360" height="44" fill="#ffffff"/><text x="180" y="28" font-size="14" text-anchor="middle" fill="#242a30" font-family="sans-serif">路演群（演示）</text><g font-family="sans-serif" font-size="13" fill="#242a30"><rect x="16" y="64" width="250" height="56" rx="10" fill="#ffffff"/><text x="28" y="86" fill="#8a949f" font-size="11">群成员</text><text x="28" y="106">下午三点开始，按组顺序上台</text><rect x="16" y="184" width="320" height="76" rx="10" fill="#ffffff"/><text x="28" y="206" fill="#8a949f" font-size="11">叶青</text><text x="28" y="226">二组今天路演讲得很清楚，</text><text x="28" y="246">压测数据也对得上</text><rect x="94" y="300" width="250" height="56" rx="10" fill="#dfe8f0"/><text x="106" y="322" fill="#8a949f" font-size="11">群成员</text><text x="106" y="342">收到，晚上整理录屏</text></g></svg>`;

const samples: Record<string, SourceSample> = {
  document: {
    label: '文档段',
    source: p0({
      ...ids('document'),
      location: { kind: 'document', paragraph: '3' },
      excerpt: '剩余任务按方案 B 重新拆分为 5 个 Issue',
      originalTitle: 'Landing W2 周报',
      recordedByName: '叶青',
      sourceType: 'document',
      sourceCategory: 'original',
      demo: true,
    }),
    original: {
      status: 'ready',
      content: {
        kind: 'document',
        paragraphs: [
          {
            paragraph: '1',
            text: '本周目标：完成工单检索的召回改造，周五给客户演示。',
          },
          {
            paragraph: '2',
            text: '周二客户反馈搜索结果里出现内部标识，看不懂，原方案需要调整。',
          },
          {
            paragraph: '3',
            text: '剩余任务按方案 B 重新拆分为 5 个 Issue，原 #14、#15 关闭。',
          },
          {
            paragraph: '4',
            text: '方案 B 先改排序和展示文案，召回部分放到下周。',
          },
          {
            paragraph: '5',
            text: '客户的测试数据周四才能给到，演示前只有一天准备。',
          },
        ],
      },
    },
  },
  pdf: {
    label: 'PDF 页与文字范围',
    source: material({
      ...ids('pdf'),
      location: { kind: 'pdf', page: 3, textRange: range(pdfPage, pdfQuote) },
      excerpt: pdfQuote,
      sourceCategory: 'original',
      demo: true,
    }),
    original: {
      status: 'ready',
      content: {
        kind: 'pdf',
        pages: [
          {
            page: 2,
            text: '本周值班共收到 4 次告警，其中 2 次与缓存失效有关。',
          },
          { page: 3, text: pdfPage },
          {
            page: 4,
            text: '待办：补齐缓存命中率的监控面板，下周复盘时一起看。',
          },
        ],
      },
    },
  },
  spreadsheet: {
    label: '表格单元格',
    source: p0({
      ...ids('spreadsheet'),
      location: { kind: 'spreadsheet', sheet: '观察表', cell: 'C4' },
      excerpt: '主动补齐接口文档，联调时间缩短一半',
      originalTitle: '实训营观察表',
      recordedByName: null,
      sourceType: 'spreadsheet',
      sourceCategory: 'original',
      demo: true,
    }),
    original: {
      status: 'ready',
      content: {
        kind: 'spreadsheet',
        sheet: '观察表',
        cells: [
          { cell: 'A1', text: '学员' },
          { cell: 'B1', text: '周次' },
          { cell: 'C1', text: '突出表现' },
          { cell: 'D1', text: '待改进' },
          { cell: 'A2', text: '演示学员 01' },
          { cell: 'B2', text: 'W2' },
          { cell: 'C2', text: '需求变更后当天给出两个备选方案' },
          { cell: 'D2', text: '提交说明偏简略' },
          { cell: 'A3', text: '演示学员 02' },
          { cell: 'B3', text: 'W2' },
          { cell: 'C3', text: '排查问题先缩小范围' },
          { cell: 'D3', text: '' },
          { cell: 'A4', text: '演示学员 03' },
          { cell: 'B4', text: 'W3' },
          { cell: 'C4', text: '主动补齐接口文档，联调时间缩短一半' },
          { cell: 'D4', text: '评审时表达偏快' },
          { cell: 'A5', text: '演示学员 04' },
          { cell: 'B5', text: 'W3' },
          { cell: 'C5', text: '带新人走通部署流程' },
          { cell: 'D5', text: '测试覆盖偏少' },
        ],
      },
    },
  },
  presentation: {
    label: 'PPT 页',
    source: material({
      ...ids('presentation'),
      location: { kind: 'presentation', slide: 3 },
      excerpt: '搜索结果点击率从 21% 提升到 34%',
      sourceCategory: 'original',
      demo: true,
    }),
    original: {
      status: 'ready',
      content: {
        kind: 'presentation',
        slides: [
          { slide: 1, text: 'Milestone 述职\n工单检索课题 · 演示' },
          { slide: 2, text: '目标\n让客服在 3 次点击内找到相似工单' },
          {
            slide: 3,
            text: '结果\n搜索结果点击率从 21% 提升到 34%\n平均查找时间从 4 分钟降到 90 秒',
          },
          { slide: 4, text: '下一步\n接入多语言工单，补齐召回评测集' },
        ],
      },
    },
  },
  recording: {
    label: '录音时间点',
    source: p0({
      ...ids('recording'),
      location: { kind: 'recording', startMs: 192_000, endMs: 208_000 },
      excerpt: '第二天就拿了两个方案过来，每个方案的验收标准都写清楚了',
      originalTitle: 'W2 导师团复盘',
      recordedByName: '叶青',
      sourceType: 'recording',
      sourceCategory: 'original',
      demo: true,
    }),
    original: {
      status: 'ready',
      content: {
        kind: 'recording',
        playback: null,
        segments: [
          {
            startMs: 170_000,
            endMs: 191_000,
            speaker: '宋川 · 助教',
            text: '上周的方案评审大家都参加了，先说说方案变更这件事。',
          },
          {
            startMs: 192_000,
            endMs: 208_000,
            speaker: '叶青 · 导师',
            text: '知远没等我安排，第二天就拿了两个方案过来，每个方案的验收标准都写清楚了。',
          },
          {
            startMs: 209_000,
            endMs: 226_000,
            speaker: '宋川 · 助教',
            text: '后面重排任务也是他自己拆的，拆成了 5 个 Issue。',
          },
        ],
      },
    },
  },
  video: {
    label: '视频时间点',
    source: material({
      ...ids('video'),
      location: { kind: 'video', startMs: 725_000, endMs: 740_000 },
      excerpt: '客户追问延迟时，现场打开监控面板逐项解释',
      sourceCategory: 'original',
      demo: true,
    }),
    original: {
      status: 'ready',
      content: {
        kind: 'video',
        playback: null,
        segments: [
          {
            startMs: 700_000,
            endMs: 724_000,
            speaker: '客户',
            text: '高峰期的延迟大概是多少？',
          },
          {
            startMs: 725_000,
            endMs: 740_000,
            speaker: '演示讲解人',
            text: '客户追问延迟时，现场打开监控面板逐项解释，高峰期在 200 毫秒以内。',
          },
        ],
      },
    },
  },
  image: {
    label: '图片区域',
    source: material({
      ...ids('image'),
      location: {
        kind: 'image',
        region: { left: 0.04, top: 0.38, right: 0.94, bottom: 0.55 },
      },
      excerpt: '二组今天路演讲得很清楚，压测数据也对得上',
      sourceCategory: 'original',
      demo: true,
    }),
    original: {
      status: 'ready',
      content: {
        kind: 'image',
        image: {
          url: `data:image/svg+xml,${encodeURIComponent(shot)}`,
          width: 360,
          height: 480,
        },
      },
    },
  },
  code: {
    label: '代码出处',
    source: material({
      ...ids('code'),
      location: {
        kind: 'code',
        repository: 'git.example.com/demo/ticket-search',
        commit: '3f9c1e7b2d4085e6f1a9c3b7d2e4f6081a5c9d37',
        path: 'src/search/rank.ts',
        startLine: 12,
        endLine: 17,
      },
      excerpt: [
        'export function rank(hits: Hit[], query: Query) {',
        '  // 先按标题命中排，再按最近更新时间排',
        '  return hits',
        '    .map((hit) => ({ hit, score: titleScore(hit, query) }))',
        '    .sort((a, b) => b.score - a.score || b.hit.updatedAt - a.hit.updatedAt)',
        '    .map(({ hit }) => hit);',
      ].join('\n'),
      sourceCategory: 'submitted_code_snapshot',
      displayNotice: '提交的代码快照',
      demo: true,
    }),
    original: { status: 'not_connected' },
  },
  baseline: {
    label: '原型基线',
    source: p0({
      ...ids('baseline'),
      location: {
        kind: 'snapshot_field',
        fieldPath: 'events.demo.srcs.0',
        originalLocation: 'W4–W5 · 突出表现 · 第 46 行',
      },
      excerpt: '主动调研并验证了两种实现方案，给团队后续选型提供了参考',
      originalTitle: '第六期观察表',
      recordedByName: null,
      sourceType: 'prototype_snapshot',
      sourceCategory: 'prototype_baseline',
      displayNotice: '原型基线 2e51b50，评语按原意压缩',
      demo: true,
    }),
    original: { status: 'not_connected' },
  },
  'pdf-pending': {
    label: 'PDF 原件待接入',
    source: material({
      ...ids('pdf-pending'),
      location: { kind: 'pdf', page: 2, textRange: { start: 0, end: 12 } },
      excerpt: '值班手册的排查步骤已更新',
      sourceCategory: 'original',
      demo: true,
    }),
    original: { status: 'not_connected' },
  },
  'image-pending': {
    label: '图片原图待接入',
    source: material({
      ...ids('image-pending'),
      location: {
        kind: 'image',
        region: { left: 0.1, top: 0.2, right: 0.6, bottom: 0.45 },
      },
      excerpt: '周会白板上写着下周的三项优先级',
      sourceCategory: 'original',
      demo: true,
    }),
    original: { status: 'not_connected' },
  },
};

/** 样张里的「六种定位」与其他状态，按页面上列出的顺序。 */
export const sampleKeys = Object.keys(samples);

export function sample(key: string): SourceSample {
  const found = samples[key];
  if (!found) throw new Error(`Unknown source sample: ${key}`);
  return found;
}

/** 查看页按地址里的两个标识找样张；找不到就是链接失效，和真实页面一样不给内容。 */
export function findSample(input: SourceReadInput): SourceSample | null {
  return (
    Object.values(samples).find(
      (entry) =>
        entry.source.fragmentId === input.fragmentId &&
        entry.source.originalVersionId === input.originalVersionId,
    ) ?? null
  );
}
