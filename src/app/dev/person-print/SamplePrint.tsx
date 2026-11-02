'use client';
import { useState } from 'react';
import { PersonPrint } from '@/features/person-print/PersonPrint';
import { livePrintPorts } from '@/features/person-print/live-ports';
import {
  samplePerson,
  samplePorts,
  type SampleMode,
  type SamplePerson,
  type SampleRole,
} from './samples';

/** The profile head with 「打印档案」, the way the person page will carry it (BOW-840). */
export function SamplePrint({
  person,
  role,
  mode,
}: {
  person: SamplePerson;
  role: SampleRole;
  mode: SampleMode;
}) {
  const [ports] = useState(() =>
    mode === 'live' ? livePrintPorts() : samplePorts(person, role, mode),
  );
  const { id, name } = samplePerson(person);
  return (
    <header className="nt-head">
      <div>
        <h1>
          {name} <small className="nt-muted">演示</small>
        </h1>
        <p>开发样张：档案页头的「打印档案」</p>
      </div>
      <div className="nt-head__acts">
        <PersonPrint
          personId={id}
          personName={name}
          canPrint={role !== 'mentor'}
          ports={ports}
        />
      </div>
    </header>
  );
}
