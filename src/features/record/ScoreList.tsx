'use client';
import type { RecordBatchDraft } from '@/contracts/record';
import type { LoadSource } from '@/features/sources/SourceCite';
import type { EditState } from './build-save-input';
import { copy } from './copy';
import type { SaveProblems } from './errors';
import { ScoreRow } from './ScoreRow';
import {
  scoreKey,
  type DimensionOption,
  type PersonOption,
  type ScoreKey,
} from './types';

/** 右栏锚点面板当前对着哪一行、哪一分。 */
export type AnchorFocus = {
  personId: string;
  dimensionId: string;
  hit: number | null;
};

/** 分数区：按人分组，每人每个维度一行。多人记录各自打分，不把一个人的分复制给另一个人。 */
export function ScoreList({
  draft,
  edit,
  people,
  dimensions,
  saved,
  pickDisabled,
  problems,
  loadSource,
  inputFragmentId,
  onPick,
  onReason,
  onPreview,
}: {
  draft: RecordBatchDraft;
  edit: EditState;
  people: readonly PersonOption[];
  dimensions: readonly DimensionOption[];
  /** 已保存：所有建议分都是确认过的，整块只读。 */
  saved: boolean;
  pickDisabled: boolean;
  problems?: SaveProblems | null;
  loadSource: LoadSource;
  inputFragmentId?: string;
  onPick: (key: ScoreKey, value: number) => void;
  onReason: (key: ScoreKey, reason: string) => void;
  onPreview: (focus: AnchorFocus | null) => void;
}) {
  const { personIds } = draft;
  const grouped = personIds.length > 1;
  const rowsOf = (personId: string) =>
    draft.scores
      .filter((score) => score.personId === personId)
      .map((score) => {
        const key = scoreKey(score.personId, score.dimensionId);
        const editing = edit.scores[key];
        return (
          <ScoreRow
            key={key}
            dimension={
              dimensions.find((d) => d.id === score.dimensionId)?.name ??
              copy.score.unknownDimension
            }
            score={score}
            value={editing?.value ?? null}
            confirmed={saved || Boolean(editing?.touched)}
            reason={editing?.reason ?? ''}
            readOnly={saved}
            pickDisabled={pickDisabled}
            problem={problems?.scores[key]}
            loadSource={loadSource}
            inputFragmentId={inputFragmentId}
            onPick={(value) => onPick(key, value)}
            onReason={(reason) => onReason(key, reason)}
            onPreview={(hit) =>
              onPreview({
                personId: score.personId,
                dimensionId: score.dimensionId,
                hit,
              })
            }
          />
        );
      });
  return (
    <div className="n-event__scores" id="scores">
      {grouped
        ? personIds.map((personId) => {
            const name =
              people.find((person) => person.id === personId)?.name ??
              copy.header.unknownPerson;
            const rows = rowsOf(personId);
            return (
              <div
                key={personId}
                role="group"
                aria-label={name}
                style={{ display: 'grid', gap: 'var(--s-2)' }}
              >
                <b className="n-event__who">{name}</b>
                {rows.length === 0 ? (
                  <p className="nt-muted">{copy.score.groupEmpty}</p>
                ) : (
                  rows
                )}
              </div>
            );
          })
        : personIds.flatMap(rowsOf)}
    </div>
  );
}
