'use client';
import { useState } from 'react';
import { PersonPrint } from './PersonPrint';
import { livePrintPorts } from './live-ports';

/**
 * The print on the person page. The ports are functions, so the page (a server component)
 * passes only plain props and the real ports are made here.
 */
export function LivePersonPrint(props: {
  personId: string;
  personName: string;
  canPrint: boolean;
}) {
  const [ports] = useState(livePrintPorts);
  return <PersonPrint {...props} ports={ports} />;
}
