'use client';
import { personSchema } from '@/contracts/person';
import { Person } from '@/features/person/Person';
import { loadSampleSource, SAMPLE_PEOPLE, sampleNodeRecords } from './samples';

export function SamplePersonNodes({
  role,
  records,
}: {
  role: keyof typeof SAMPLE_PEOPLE;
  records: string | undefined;
}) {
  return (
    <Person
      data={personSchema.parse(SAMPLE_PEOPLE[role])}
      nodeRecords={sampleNodeRecords(records)}
      loadSource={loadSampleSource}
    />
  );
}
