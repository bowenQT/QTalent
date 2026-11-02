import { Icon } from '@/components/ui/Icon';
import type { WorkbenchView } from '../../view';

/**
 * 判断提醒 as one line per note in the heading; the details are on the comparison and
 * rules pages. Nothing is drawn until the reads are connected or when there is no note.
 */
export function JudgeNotes({ view }: { view: WorkbenchView }) {
  const block = view.manager?.notes;
  if (block?.status !== 'ready' || !block.data.length) return null;
  return (
    <div className="nt-notes" id="jsig" role="note" aria-label="提醒">
      {block.data.map((note) => (
        <a href={note.href} title={note.detail ?? undefined} key={note.href}>
          <Icon name={note.kind === 'comparison' ? 'swap' : 'grid'} />
          <span>{note.text}</span>
        </a>
      ))}
    </div>
  );
}
