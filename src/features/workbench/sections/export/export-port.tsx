'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { ExportRange } from '../../view';

/** What a generation run ends with; the server re-checks scope before it builds. */
export type ExportOutcome =
  | {
      status: 'done';
      people: number;
      rows: number;
      /** Generation time, `YYYY-MM-DD HH:mm` in the business time zone. */
      at: string;
      href: string;
      fileName: string;
    }
  | { status: 'denied' }
  | { status: 'empty' }
  | { status: 'failed'; reason: string };

export type ExportPort = {
  generate: (scopeId: string, range: ExportRange) => Promise<ExportOutcome>;
};

const PortContext = createContext<ExportPort | null>(null);

/**
 * Supplies the export run. BOW-912 has no action on main yet, so /work provides none and
 * its export stays not connected; the development sample provides a scripted one.
 */
export function ExportPortProvider({
  port,
  children,
}: {
  port: ExportPort;
  children: ReactNode;
}) {
  return <PortContext value={port}>{children}</PortContext>;
}

export function useExportPort(): ExportPort | null {
  return useContext(PortContext);
}
