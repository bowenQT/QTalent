'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import type { PersonPrintPorts, PersonPrintSheet, PrintPreview } from './ports';
import {
  cancel,
  deniedBody,
  deniedTitle,
  gotIt,
  idleWithEntry,
  idleWithoutEntry,
  notConnectedBody,
  notConnectedTitle,
  previewFailed,
  printAction,
  printBody,
  printButton,
  printedToast,
  printFacts,
  printFailed,
  printTitle,
} from './copy';
import { PrintSheet } from './PrintSheet';
import styles from './print.module.css';

type Step =
  | { kind: 'closed'; error: string | null }
  | { kind: 'checking' }
  | {
      kind: 'confirm';
      preview: PrintPreview;
      busy: boolean;
      error: string | null;
    }
  | { kind: 'denied' }
  | { kind: 'not_connected' };

const noSubscribe = () => () => {};
const operationId = () => crypto.randomUUID();

/**
 * 「打印档案」 on the profile head, and the sheet the browser prints. The server checks the
 * permission when the print opens and again on confirming, records both outcomes in the
 * audit log and returns the confirmed content; the page only lays it out. Viewers without
 * the entry (`canPrint` false) still get the sheet, so a plain browser print prints a
 * line saying who can print the profile instead of the page.
 */
export function PersonPrint({
  personId,
  personName,
  canPrint,
  ports,
}: {
  personId: string;
  personName: string;
  canPrint: boolean;
  ports: PersonPrintPorts;
}) {
  const toast = useToast();
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [step, setStep] = useState<Step>({ kind: 'closed', error: null });
  const [sheet, setSheet] = useState<PersonPrintSheet | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  // The sheet is printed once it is on the page; after printing it goes back to the line.
  useEffect(() => {
    if (!sheet) return;
    const reset = () => setSheet(null);
    window.addEventListener('afterprint', reset);
    window.print();
    toast.show(printedToast);
    return () => window.removeEventListener('afterprint', reset);
  }, [sheet, toast]);

  async function open() {
    if (step.kind === 'checking') return;
    setStep({ kind: 'checking' });
    try {
      const result = await ports.preview(personId);
      setStep(
        result.status === 'ready'
          ? {
              kind: 'confirm',
              preview: result.preview,
              busy: false,
              error: null,
            }
          : { kind: result.status },
      );
    } catch {
      setStep({ kind: 'closed', error: previewFailed });
    }
  }

  async function confirm(preview: PrintPreview) {
    setStep({ kind: 'confirm', preview, busy: true, error: null });
    try {
      const result = await ports.print({
        operationId: operationId(),
        personId,
      });
      if (result.status === 'printed') {
        setStep({ kind: 'closed', error: null });
        setSheet(result.sheet);
      } else setStep({ kind: result.status });
    } catch {
      setStep({ kind: 'confirm', preview, busy: false, error: printFailed });
    }
  }

  const close = () => setStep({ kind: 'closed', error: null });
  const notice =
    step.kind === 'denied'
      ? { title: deniedTitle, body: deniedBody }
      : step.kind === 'not_connected'
        ? { title: notConnectedTitle, body: notConnectedBody }
        : null;

  return (
    <>
      {canPrint ? (
        <button
          ref={button}
          className="n-btn n-btn--sm n-btn--ghost"
          type="button"
          id="btn-print"
          aria-disabled={step.kind === 'checking'}
          aria-describedby={
            step.kind === 'closed' && step.error ? 'print-error' : undefined
          }
          onClick={() => void open()}
        >
          <Icon name="print" />
          {printButton}
        </button>
      ) : null}
      {step.kind === 'closed' && step.error ? (
        <p id="print-error" role="alert" className="nt-field-error">
          {step.error}
        </p>
      ) : null}
      {/* Both dialogs stay mounted and only switch `open`: closing is what returns focus. */}
      <ConfirmDialog
        open={step.kind === 'confirm'}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        title={printTitle(personName)}
        facts={
          step.kind === 'confirm'
            ? printFacts(step.preview).map((text, index) => (
                <>
                  <b>{index === 0 ? '会打印' : '留在系统里'}</b>
                  {`：${text}`}
                </>
              ))
            : []
        }
        busy={step.kind === 'confirm' && step.busy}
        returnFocusRef={button}
        actions={[
          { id: 'cancel', label: cancel, variant: 'ghost', onSelect: close },
          {
            id: 'print',
            label: printAction,
            variant: 'ink',
            icon: 'print',
            onSelect: () => {
              if (step.kind === 'confirm') void confirm(step.preview);
            },
          },
        ]}
      >
        {printBody}
        {step.kind === 'confirm' && step.error ? (
          <p role="alert" className="nt-field-error">
            {step.error}
          </p>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={notice !== null}
        onOpenChange={(value) => {
          if (!value) close();
        }}
        title={notice?.title ?? ''}
        returnFocusRef={button}
        actions={[{ id: 'ok', label: gotIt, variant: 'ink', onSelect: close }]}
      >
        {notice?.body}
      </ConfirmDialog>
      {mounted
        ? createPortal(
            <div className={`n-print ${styles.print}`} id="print-sheet">
              {sheet ? (
                <PrintSheet sheet={sheet} />
              ) : (
                <p className="n-print__idle">
                  {canPrint ? idleWithEntry : idleWithoutEntry}
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
