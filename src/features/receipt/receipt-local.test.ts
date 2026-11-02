import { describe, expect, it } from 'vitest';
import type { MaterialBatchReceipt } from '@/contracts/materials';
import { recordBatchDraftFixture } from '@/contracts/materials.fixtures';
import {
  cardState,
  emptyLocal,
  eventKey,
  reconcile,
  savedElsewhere,
  type LocalState,
  type SavedRecord,
} from './receipt-local';
import { suggestedValues } from './receipt-model';

const draft = recordBatchDraftFixture;
const id = draft.draftId;

function snapshot(
  state: 'pending' | 'settled' | 'absent',
  eventId = 'ev-1',
): MaterialBatchReceipt {
  return {
    draftSet:
      state === 'pending'
        ? {
            batchId: 'b',
            revision: 3,
            drafts: [{ ...draft, revision: 3 }],
            duplicateCandidates: [],
          }
        : null,
    confirmedDrafts:
      state === 'settled'
        ? [
            {
              draftId: id,
              revision: 2,
              events: [{ personId: 'demo-person', eventId }],
            },
          ]
        : [],
  } as unknown as MaterialBatchReceipt;
}

const save: SavedRecord = {
  draft,
  values: { ...suggestedValues(draft), x: 5 } as SavedRecord['values'],
  reason: '两人合作',
  by: '叶青',
  on: '09-03',
  saveId: 'save-1',
  events: eventKey([{ personId: 'demo-person', eventId: 'ev-1' }]),
  receipt: {
    revision: 2,
    events: [{ personId: 'demo-person', eventId: 'ev-1' }],
  },
};
const signed = { [save.events]: save };
const withOp = (op: NonNullable<LocalState['items'][string]['op']>) => ({
  items: { [id]: { op } },
  signed,
  latest: {},
});
const unknown = withOp({
  kind: 'unknown',
  at: 1,
  save,
  busy: false,
  verify: true,
  failed: false,
});

describe('reconcile：只有能说明操作的成功读取才清掉它', () => {
  it('操作之前就发起的读取说明不了它', () => {
    const local = withOp({ kind: 'saved', at: 2, save });
    expect(reconcile(local, 2, snapshot('pending'))).toEqual(local);
  });

  it('快照里看不到这件事：不算说明，操作留着', () => {
    expect(reconcile(unknown, 2, snapshot('absent'))).toEqual(unknown);
  });

  it('保存后读到已确认：清掉操作；读到待确认：清掉操作，保存的分和理由留作编辑输入', () => {
    const local = withOp({ kind: 'saved', at: 1, save });
    expect(reconcile(local, 2, snapshot('settled')).items).toEqual({});
    expect(reconcile(local, 2, snapshot('pending')).items[id]).toEqual({
      edit: { values: save.values, reason: save.reason },
    });
  });

  it('撤销后读到已确认（别处重新保存）：清掉操作和编辑输入，以快照为准', () => {
    const local: LocalState = {
      items: {
        [id]: {
          op: { kind: 'undone', at: 1, draft, saveId: 'save-1' },
          edit: { values: save.values, reason: save.reason },
        },
      },
      signed,
      latest: {},
    };
    expect(reconcile(local, 2, snapshot('settled', 'ev-2')).items).toEqual({});
  });

  it('Codex 场景一：结果不知道的撤销，只有成功读取能清；读取失败时页面不调用 reconcile，卡片一直待核实', () => {
    expect(cardState(unknown, id, snapshot('settled')).kind).toBe('unknown');
    expect(reconcile(unknown, 2, snapshot('pending')).items[id]).toEqual({
      edit: { values: save.values, reason: save.reason },
    });
  });

  it('Codex 场景二：快照确认后别处撤销、改分重存，新的事件编号对不上本页保存，只显示摘要', () => {
    let local: LocalState = withOp({ kind: 'saved', at: 1, save });
    local = reconcile(local, 2, snapshot('settled'));
    expect(cardState(local, id, snapshot('settled'))).toEqual({
      kind: 'settled',
      signed: save,
    });
    local = reconcile(local, 3, snapshot('pending'));
    expect(cardState(local, id, snapshot('pending')).kind).toBe('pending');
    local = reconcile(local, 4, snapshot('settled', 'ev-2'));
    expect(cardState(local, id, snapshot('settled', 'ev-2'))).toEqual({
      kind: 'settled',
      signed: null,
    });
  });

  it('没有本地记录时，快照决定一切', () => {
    expect(cardState(emptyLocal, id, snapshot('absent')).kind).toBe('none');
    expect(cardState(emptyLocal, id, snapshot('settled'))).toEqual({
      kind: 'settled',
      signed: null,
    });
  });
});

describe('撤销结果到达时，快照是否已前进（复用 matchesSave）', () => {
  it('快照里的已确认就是这次保存：没有前进，撤销结果采用', () => {
    expect(savedElsewhere(snapshot('settled'), save)).toBe(false);
  });
  it('快照里还没有这件事的确认（读取没跟上或已回到待确认）：不算前进', () => {
    expect(savedElsewhere(snapshot('pending'), save)).toBe(false);
    expect(savedElsewhere(snapshot('absent'), save)).toBe(false);
  });
  it('别处又确认过：事件编号或版本对不上就算前进，撤销结果丢弃', () => {
    expect(savedElsewhere(snapshot('settled', 'ev-2'), save)).toBe(true);
    expect(
      savedElsewhere(snapshot('settled'), {
        ...save,
        receipt: { ...save.receipt, revision: 1 },
      }),
    ).toBe(true);
  });
});
