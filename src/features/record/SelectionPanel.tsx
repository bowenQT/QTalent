'use client';
import { useState } from 'react';
import { Check } from '@/components/ui/Check';
import { Chips } from '@/components/ui/Chips';
import { copy } from './copy';
import type { SelectionState } from './record-flow';
import type { PersonOption } from './types';

type Candidate = { id: string; label: string };
const NO_PROJECT = '';

/** 服务端给出的候选与原因原样展示；候选只含当前账号有权的人，页面不另行拼。 */
function collect(
  selection: SelectionState,
  people: readonly PersonOption[],
): { candidates: Candidate[]; reasons: string[]; chosen: string[] } {
  const candidates: Candidate[] = [];
  const reasons: string[] = [];
  const chosen: string[] = [];
  const add = (candidate: Candidate) => {
    if (!candidates.some((c) => c.id === candidate.id))
      candidates.push(candidate);
  };
  for (const entry of selection.people) {
    if (entry.state === 'resolved') {
      add({
        id: entry.id,
        label:
          people.find((p) => p.id === entry.id)?.name ??
          copy.header.unknownPerson,
      });
      chosen.push(entry.id);
    } else if (entry.state === 'needs_selection') {
      entry.candidates.forEach(add);
      reasons.push(entry.reason);
    }
  }
  return { candidates, reasons, chosen };
}

export function SelectionPanel({
  selection,
  people,
  busy,
  onSubmit,
}: {
  selection: SelectionState;
  people: readonly PersonOption[];
  busy: boolean;
  onSubmit: (choice: { personIds: string[]; projectId: string | null }) => void;
}) {
  const { candidates, reasons, chosen } = collect(selection, people);
  const [picked, setPicked] = useState<string[]>(chosen);
  const project = selection.project;
  const [projectId, setProjectId] = useState<string | null>(
    project.state === 'resolved'
      ? project.id
      : project.state === 'none'
        ? NO_PROJECT
        : null,
  );
  const projectOptions =
    project.state === 'needs_selection'
      ? [
          ...project.candidates.map((c) => ({ value: c.id, label: c.label })),
          { value: NO_PROJECT, label: copy.selection.noProject },
        ]
      : [];
  const ready =
    picked.length > 0 &&
    (project.state !== 'needs_selection' || projectId !== null);
  const peopleNeeded = selection.people.some(
    (p) => p.state === 'needs_selection',
  );
  return (
    <div className="n-selection" role="group" aria-label={copy.selection.title}>
      <h3 className="n-event__title">{copy.selection.title}</h3>
      {reasons.map((reason) => (
        <p key={reason} className="nt-muted">
          {reason}
        </p>
      ))}
      {peopleNeeded || candidates.length > 0 ? (
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--s-3)' }}>
          <legend className="nt-muted">{copy.selection.peopleLabel}</legend>
          {/* 一位候选人一行，复选框和名字的对应关系清楚（设计系统的选择列表间距）。 */}
          <div className="n-choices">
            {candidates.map((candidate) => (
              <Check
                key={candidate.id}
                checked={picked.includes(candidate.id)}
                disabled={busy}
                onChange={(event) =>
                  setPicked((ids) =>
                    event.target.checked
                      ? [...ids, candidate.id]
                      : ids.filter((id) => id !== candidate.id),
                  )
                }
              >
                {candidate.label}
              </Check>
            ))}
          </div>
        </fieldset>
      ) : null}
      {projectOptions.length > 0 ? (
        <div style={{ marginBottom: 'var(--s-3)' }}>
          <span className="nt-muted">{copy.selection.projectLabel}</span>
          <Chips
            label={copy.selection.projectLabel}
            items={projectOptions.map((o) => ({ ...o, disabled: busy }))}
            selected={projectId === null ? [] : [projectId]}
            onSelect={setProjectId}
          />
        </div>
      ) : null}
      {picked.length === 0 ? (
        <p className="nt-muted">{copy.selection.needOne}</p>
      ) : null}
      <button
        type="button"
        className="n-btn n-btn--sm n-btn--ink"
        disabled={!ready || busy}
        onClick={() =>
          onSubmit({
            personIds: picked,
            projectId: projectId === NO_PROJECT ? null : projectId,
          })
        }
      >
        {busy ? copy.selection.submitting : copy.selection.submit}
      </button>
    </div>
  );
}
