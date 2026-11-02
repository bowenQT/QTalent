'use client';
import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { State } from '@/components/ui/State';
import type { WorkbenchView } from '../../view';
import { todosDone } from '../../copy';
import { todoGroups, type TodoRow } from './todo-groups';

function Row({ row }: { row: TodoRow }) {
  return (
    <li>
      <a href={row.href}>
        <span
          className={`n-badge${row.badgeClass ? ` ${row.badgeClass}` : ''}`}
        >
          {row.icon ? <Icon name={row.icon} /> : null}
          {row.badge}
        </span>
        <span>
          {row.title}
          <small>{row.sub}</small>
        </span>
        <span className="due">{row.due}</span>
      </a>
    </li>
  );
}

/**
 * HR to-dos, grouped as in the prototype: one group open at a time, the first by
 * default. Groups that are not connected are left out, and so is the total.
 */
export function Todos({ view }: { view: WorkbenchView }) {
  const [picked, setPicked] = useState<string | null>(null);
  if (!view.todos) return null;
  const { groups, complete } = todoGroups(view.todos);
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const open = groups.some((group) => group.key === picked)
    ? picked
    : (groups[0]?.key ?? null);
  return (
    <article className="n-card" id="todo">
      <h3 className="n-section-title">
        待办
        {complete && total ? <span className="n-count">{total}</span> : null}
      </h3>
      {groups.length ? (
        groups.map((group) => {
          const expanded = group.key === open;
          const first = group.rows[0];
          return (
            <div className="n-todogrp" key={group.key}>
              <button
                className="n-todogrp__head"
                type="button"
                aria-expanded={expanded}
                onClick={() => setPicked(group.key)}
              >
                {group.label}
                <span className="n-count is-quiet">{group.rows.length}</span>
                {expanded ? null : (
                  <small>
                    {first.title}
                    {group.rows.length > 1 ? ' 等' : ''}
                  </small>
                )}
                <Icon name="chev" />
              </button>
              {expanded ? (
                <ul className="n-todo">
                  {group.rows.map((row) => (
                    <Row key={row.key} row={row} />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })
      ) : (
        <State kind="empty" title={todosDone.title} text={todosDone.text} />
      )}
    </article>
  );
}
