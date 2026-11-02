'use client';
import Link from 'next/link';
import { copy } from './copy';
import type { PersonOption, RecordSaveReceipt } from './types';

/** 保存后的署名行：谁、什么角色、刚刚保存到谁的档案，以及档案链接（多人每人一条）。 */
export function SavedSign({
  receipt,
  people,
  accountName,
  roleLabel,
}: {
  receipt: RecordSaveReceipt;
  people: readonly PersonOption[];
  accountName: string;
  roleLabel: string;
}) {
  return (
    <>
      {receipt.events.map((event) => {
        const name =
          people.find((person) => person.id === event.personId)?.name ??
          copy.header.unknownPerson;
        return (
          <div key={event.eventId} className="n-event__sign">
            <span className="ink-hand">{accountName}</span>
            {roleLabel} · {copy.saved.sign(name)} ·{' '}
            <Link
              href={`/person?id=${encodeURIComponent(event.personId)}#ev-${encodeURIComponent(event.eventId)}`}
            >
              {copy.saved.link}
            </Link>
          </div>
        );
      })}
    </>
  );
}
