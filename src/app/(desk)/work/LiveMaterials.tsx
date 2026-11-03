'use client';
import { useMemo, type ReactNode } from 'react';
import { createLiveMaterialsPort } from '@/features/workbench/sections/materials/live-port';
import { MaterialsPortProvider } from '@/features/workbench/sections/materials/materials-port';
import { materialsTransport } from './materials-transport';

/** Connects the workbench materials section to the real upload and batch backend. */
export function LiveMaterials({ children }: { children: ReactNode }) {
  const port = useMemo(() => createLiveMaterialsPort(materialsTransport), []);
  return <MaterialsPortProvider port={port}>{children}</MaterialsPortProvider>;
}
