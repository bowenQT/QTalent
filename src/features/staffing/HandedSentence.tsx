'use client';
import { useSyncExternalStore } from 'react';
import { peekHandoff, sessionStorageOrNull } from './draft';

const noSubscribe = () => () => {};

/**
 * The header of the choose-a-project step after the workbench: the handed-over sentence
 * is shown as written, read without taking it (the project's page takes it). Without one
 * (expired, another account) the step simply asks for a project.
 */
export function HandedSentence({ accountId }: { accountId: string }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => peekHandoff(sessionStorageOrNull(), accountId, Date.now()),
    () => null,
  );
  return (
    <header className="nt-head">
      <div>
        <h1>{text ? '这句话为哪个项目找人' : '选一个项目再找人'}</h1>
        <p>
          {text
            ? '找人需求按项目保存。选一个项目，这句话会一起带过去。'
            : '找人需求按项目保存。选一个项目，再写下要找什么样的人。'}
        </p>
        {text ? (
          <blockquote
            className="n-cite__quote"
            aria-label="刚才写的那句话"
            style={{ marginTop: 'var(--s-3)' }}
          >
            {text}
          </blockquote>
        ) : null}
      </div>
    </header>
  );
}
