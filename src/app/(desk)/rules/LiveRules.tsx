'use client';
import {
  SelectionRevisionPage,
  SelectionStandardCurrent,
} from '@/features/standard-iteration/revision/SelectionStandard';
import type {
  HrRevisionPorts,
  ManagerRevisionPorts,
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
import type { SelectionStandardPage } from '@/server/usecases/selection-standard-native';

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

/** The XEngineer selection standard as read on the server for this viewer. */
export function LiveRules({
  page,
}: {
  page: Extract<SelectionStandardPage, { status: 'current' | 'revision' }>;
}) {
  if (page.status === 'current')
    return (
      <SelectionStandardCurrent
        version={page.version}
        content={page.content}
        draftHref={page.audience === 'hr' ? judgeHref : null}
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
