'use client';
import { useMemo, type ReactNode } from 'react';
import {
  ExportPortProvider,
  type ExportPort,
} from '@/features/workbench/sections/export/export-port';
import type { ExportScope } from '@/features/workbench/view';

/**
 * Scripted export run for the development sample (BOW-912 has no action on main):
 * an empty scope ends empty, `?export=fail` fails the first run, others finish with a
 * small CSV. Mirrors the prototype's runExport; never used by /work.
 */
export function SampleExport({
  scopes,
  failFirst,
  children,
}: {
  scopes: ExportScope[];
  failFirst: boolean;
  children: ReactNode;
}) {
  const port = useMemo<ExportPort>(() => {
    let tries = 0;
    return {
      async generate(scopeId, range) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const scope = scopes.find((item) => item.id === scopeId);
        const preview = scope?.previews[range];
        if (!scope || !preview?.rows) return { status: 'empty' };
        if (failFirst && tries++ === 0)
          return { status: 'failed', reason: '导出服务超时' };
        const csv = `﻿"范围","${scope.label}"\r\n"说明","演示数据，人员均为化名"`;
        return {
          status: 'done',
          people: preview.people,
          rows: preview.rows,
          at: '2026-09-04 15:00',
          href: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
          fileName: `已确认内容-${scope.label}-20260904.csv`,
        };
      },
    };
  }, [scopes, failFirst]);
  return <ExportPortProvider port={port}>{children}</ExportPortProvider>;
}
