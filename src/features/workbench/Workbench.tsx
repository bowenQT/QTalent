import type { ReactNode } from 'react';
import type { WorkbenchRole, WorkbenchView } from './view';
import { Greeting, GreetingText } from './sections/head/Greeting';
import { Export } from './sections/export/Export';
import { FindBox } from './sections/find/FindBox';
import { Composer } from './sections/composer/Composer';
import { Students } from './sections/students/Students';
import { Todos } from './sections/todos/Todos';
import { showsTodos } from './sections/todos/todo-groups';

/**
 * The only place sections are registered. A later card adds its own
 * `sections/<name>/` and one entry in `layouts` below; nothing else changes here.
 * Sections never import each other.
 */
type Section = {
  id: string;
  /** Whether the section has anything to show; `not_connected` blocks never do. */
  shows: (view: WorkbenchView) => boolean;
  render: (view: WorkbenchView) => ReactNode;
};

// The export entry sits inside the heading (prototype `.nt-head__acts`), so the
// heading is one section that the export section wraps when it is connected.
const greeting: Section = {
  id: 'greeting',
  shows: () => true,
  render: (view) =>
    view.exportable.status === 'ready' ? (
      <Export view={view} data={view.exportable.data}>
        <GreetingText view={view} />
      </Export>
    ) : (
      <Greeting view={view} />
    ),
};
const find: Section = {
  id: 'find',
  shows: (view) => view.entries.findPeople,
  render: (view) => <FindBox view={view} />,
};
const composer: Section = {
  id: 'composer',
  shows: (view) => view.entries.record,
  // BOW-861 passes uploadAnchor="#upload" here once its upload section is in place.
  render: (view) => <Composer view={view} />,
};
const todos: Section = {
  id: 'todos',
  shows: (view) => showsTodos(view.todos),
  render: (view) => <Todos view={view} />,
};
const students: Section = {
  id: 'students',
  shows: (view) => view.trainees !== undefined,
  render: (view) => <Students view={view} />,
};

/** `grid` wraps the slot in `div.nt-grid`; otherwise its one card is the column itself. */
type Slot = { grid: boolean; sections: Section[] };
type Block =
  | Section
  | { id: string; className: 'nt-ceo' | 'nt-cols'; main: Slot; side: Slot };

// Order and containers follow prototype/y/app/js/pages/workbench.js per role.
// Empty slots are where sections not connected yet will go (uploads, …).
const layouts: Record<WorkbenchRole, Block[]> = {
  manager: [
    greeting,
    find,
    {
      id: 'columns',
      className: 'nt-ceo',
      main: { grid: false, sections: [] },
      side: { grid: true, sections: [] },
    },
  ],
  hr: [
    greeting,
    composer,
    {
      id: 'columns',
      className: 'nt-cols',
      main: { grid: false, sections: [todos] },
      side: { grid: true, sections: [] },
    },
  ],
  mentor: [
    greeting,
    composer,
    {
      id: 'columns',
      className: 'nt-ceo',
      main: { grid: true, sections: [students] },
      side: { grid: true, sections: [] },
    },
  ],
};

function renderSlot(slot: Slot, view: WorkbenchView) {
  const shown = slot.sections.filter((section) => section.shows(view));
  const content = shown.map((section) => (
    <SectionView key={section.id} section={section} view={view} />
  ));
  // An empty slot still holds its column, so the other column stays in place.
  if (slot.grid || !shown.length)
    return <div className={slot.grid ? 'nt-grid' : undefined}>{content}</div>;
  return content;
}

function SectionView({
  section,
  view,
}: {
  section: Section;
  view: WorkbenchView;
}) {
  return <>{section.render(view)}</>;
}

export function Workbench({ view }: { view: WorkbenchView }) {
  return (
    <>
      {layouts[view.role].map((block) => {
        if (!('main' in block))
          return block.shows(view) ? (
            <SectionView key={block.id} section={block} view={view} />
          ) : null;
        const any = [...block.main.sections, ...block.side.sections].some(
          (section) => section.shows(view),
        );
        if (!any) return null;
        return (
          <div key={block.id} className={block.className}>
            {renderSlot(block.main, view)}
            {renderSlot(block.side, view)}
          </div>
        );
      })}
    </>
  );
}
