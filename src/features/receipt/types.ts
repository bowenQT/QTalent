import type { MaterialBatchReceipt } from '@/contracts/materials';
import type {
  RecordSaveInput,
  RecordSaveResult,
  RecordUndoInput,
  RecordUndoResult,
} from '@/contracts/record';

/** 材料从哪个入口交进来；回执和确认都回到这一页。 */
export type ReceiptEntry = 'web' | 'wecom' | 'mcp' | 'mobile';

export type ReceiptPerson = {
  name: string;
  hue: number;
  photo: string | null;
  /** 头像下的一行，例如所在课题或组织简称。 */
  meta: string;
  demo: boolean;
};

/**
 * 回执页读到的一份内容。`receipt` 是 897 冻结的批次快照，原样使用；其余是页面读取在服务端
 * 按当前权限补齐的展示信息（批次标题、入口、提交人、人名、维度名，以及每件事由谁确认）。
 * 真实路由由 `server/queries/receipt-page.ts` 补齐，开发样张由替身给出。
 */
export type ReceiptView = {
  receipt: MaterialBatchReceipt;
  title: string;
  entry: ReceiptEntry;
  /** MCP 入口调用的工具名，其他入口为 null。 */
  tool: string | null;
  submittedBy: string;
  /** ISO 时间。 */
  submittedAt: string;
  people: Record<string, ReceiptPerson>;
  dimensions: Record<string, string>;
  /**
   * 每件待确认的事由谁确认：`mine` 表示当前查看人可以确认。服务端按当前评价关系给出，
   * 只是入口提示；真正能否保存仍由保存动作判断。
   */
  confirmers: Record<string, { mine: boolean; name: string }>;
};

export type ReceiptReadResult =
  | { status: 'success'; view: ReceiptView }
  | { status: 'forbidden' | 'not_found'; message: string }
  /** 这次没读到（不是没有权限）：页面保留当前内容。 */
  | { status: 'unavailable' };

/** 回执页的服务端动作：读回执、按 844 逐件保存确认、5 秒内撤销。 */
export type ReceiptActions = {
  read: (batchId: string) => Promise<ReceiptReadResult>;
  /** `unavailable`：保存这次中断了（例如读不全来源），改动留在页面上。 */
  save: (
    input: RecordSaveInput,
  ) => Promise<RecordSaveResult | { status: 'unavailable' }>;
  undo: (input: RecordUndoInput) => Promise<RecordUndoResult>;
};
