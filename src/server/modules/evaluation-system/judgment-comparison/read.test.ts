import { describe, expect, it, vi } from 'vitest';
import { readJudgmentComparison } from './read';
import type { ComparisonReadPorts } from './ports';
import { access, dataset } from './test-fixtures';

function ports(): ComparisonReadPorts {
  const data = dataset();
  return {
    loadCurrentAccess: vi.fn(async () => access(data)),
    loadBatch: vi.fn(async () => data),
  };
}
describe('判断对照只读端口编排', () => {
  it('验证公共输入，客户端不能提供身份/授权/时间', async () => {
    const p = ports();
    const input = { batchId: 'batch', audience: 'hr' };
    expect(await readJudgmentComparison(input, p)).toMatchObject({
      status: 'validation_error',
      input,
    });
    expect(p.loadCurrentAccess).not.toHaveBeenCalled();
    expect(p.loadBatch).not.toHaveBeenCalled();
  });
  it('未认证先拒绝，当前身份每次重载；旧会话授权不缓存', async () => {
    const p = ports();
    expect((await readJudgmentComparison({ batchId: 'batch' }, p)).status).toBe(
      'success',
    );
    vi.mocked(p.loadCurrentAccess).mockResolvedValue(null);
    expect(await readJudgmentComparison({ batchId: 'batch' }, p)).toMatchObject(
      { status: 'forbidden' },
    );
    expect(p.loadCurrentAccess).toHaveBeenCalledTimes(2);
    expect(p.loadBatch).toHaveBeenCalledTimes(1);
  });
  it.each(['rater', 'manager'] as const)(
    '%s不能使用其他评价人过滤器探测数字',
    async (audience) => {
      const p = ports();
      vi.mocked(p.loadCurrentAccess).mockResolvedValue(
        access(dataset(), audience),
      );
      expect(
        await readJudgmentComparison({ batchId: 'batch', evaluatorId: 'b' }, p),
      ).toMatchObject({ status: 'forbidden' });
      expect(p.loadBatch).not.toHaveBeenCalled();
    },
  );
  it('未知/范围外批次由可信端口统一隐藏；不接受返回别的批次', async () => {
    const p = ports();
    vi.mocked(p.loadBatch).mockResolvedValue(null);
    expect(await readJudgmentComparison({ batchId: 'batch' }, p)).toMatchObject(
      { status: 'not_found' },
    );
    vi.mocked(p.loadBatch).mockResolvedValue(dataset());
    expect(
      await readJudgmentComparison({ batchId: 'another' }, p),
    ).toMatchObject({ status: 'not_found' });
  });
  it('当前身份传入批次授权端口，真正计算输出而非搬运汇总', async () => {
    const p = ports();
    const result = await readJudgmentComparison({ batchId: 'batch' }, p);
    expect(p.loadBatch).toHaveBeenCalledWith('batch', access(dataset()));
    expect(result).toMatchObject({
      status: 'success',
      page: { audience: 'hr', counts: { clear: { frontHigher: 3 } } },
    });
  });
  it('已授权但未知档位返回待核对，不把unknown当反向证据', async () => {
    const p = ports();
    const data = dataset();
    if (data.cases[0].front.state === 'present')
      data.cases[0].front.judgment.grade = '未知';
    vi.mocked(p.loadBatch).mockResolvedValue(data);
    expect(await readJudgmentComparison({ batchId: 'batch' }, p)).toMatchObject(
      { status: 'validation_error' },
    );
    if (data.cases[0].front.state === 'present') {
      data.cases[0].front.judgment.grade = '高分档';
      data.cases[0].front.judgment.row.personId = 'another';
    }
    expect(await readJudgmentComparison({ batchId: 'batch' }, p)).toMatchObject(
      { status: 'validation_error' },
    );
  });
  it('持久读取失败向上传递，不伪装为成功空集', async () => {
    const p = ports();
    const failure = new Error('demo read failed');
    vi.mocked(p.loadBatch).mockRejectedValue(failure);
    await expect(readJudgmentComparison({ batchId: 'batch' }, p)).rejects.toBe(
      failure,
    );
  });
});
