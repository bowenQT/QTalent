'use client';
import {
  SelectionRevisionPage,
  SelectionStandardCurrent,
} from '@/features/standard-iteration/revision/SelectionStandard';
import type {
  EffectiveRuleVersion,
  SelectionCohortBinding,
  SelectionManagerRevision,
  SelectionRevision,
} from '@/contracts/selection-standard';
import type {
  HrRevisionPorts,
  ManagerRevisionPorts,
  SelectionStandardContent,
} from '@/features/standard-iteration/ports';
import {
  publishSelectionRevisionAction,
  readSelectionRevisionAction,
  returnSelectionRevisionAction,
  saveSelectionRevisionAction,
  submitSelectionRevisionAction,
  undoSelectionPublicationAction,
  withdrawSelectionRevisionAction,
} from '@/server/actions/selection-standard';

const hrPorts: HrRevisionPorts = {
  save: saveSelectionRevisionAction,
  submit: submitSelectionRevisionAction,
  withdraw: withdrawSelectionRevisionAction,
};
const managerPorts: ManagerRevisionPorts = {
  read: readSelectionRevisionAction,
  publish: publishSelectionRevisionAction,
  undo: undoSelectionPublicationAction,
  return: returnSelectionRevisionAction,
};
const judgeHref = '/judge#attrib';

/** What the server read for this viewer: the standard in force or one revision. */
type LivePage =
  | {
      status: 'current';
      audience: 'hr' | 'manager';
      version: EffectiveRuleVersion;
      content: SelectionStandardContent;
      bindings: SelectionCohortBinding[];
      preparing: { id: string; name: string } | null;
    }
  | {
      status: 'revision';
      base: SelectionStandardContent;
      view:
        | { audience: 'hr'; revision: SelectionRevision }
        | { audience: 'manager'; revision: SelectionManagerRevision };
    };

/** The XEngineer selection standard as read on the server for this viewer. */
export function LiveRules({ page }: { page: LivePage }) {
  if (page.status === 'current')
    return (
      <SelectionStandardCurrent
        version={page.version}
        content={page.content}
        bindings={page.bindings}
        preparing={page.preparing}
        draftHref={page.audience === 'hr' ? judgeHref : null}
        back={
          page.audience === 'manager'
            ? { href: '/work', label: '回到工作台' }
            : null
        }
      />
    );
  return (
    <SelectionRevisionPage
      view={
        page.view.audience === 'hr'
          ? { ...page.view, ports: hrPorts }
          : { ...page.view, ports: managerPorts }
      }
      base={page.base}
      back={
        page.view.audience === 'hr'
          ? { href: judgeHref, label: '回到判断对照' }
          : { href: '/work', label: '回到工作台' }
      }
    />
  );
}
