'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useReducedMotion } from 'motion/react';
import type { WorkbenchView } from './view';
import { saveDraft, sendHref, sendTarget, sessionStorageOrNull } from './send';

/** Delay before leaving, so 小犇 shows it is thinking (prototype workbench.js go). */
const LEAVE_DELAY_MS = 450;

/** Shared send behaviour of the find box and the one-line composer. */
export function useSend(view: WorkbenchView, findFirst: boolean) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  function send(field: HTMLTextAreaElement | null) {
    if (sending) return;
    const value = text.trim();
    if (!value) {
      field?.focus();
      return;
    }
    const target = sendTarget(value, view.entries, findFirst);
    if (!target) return;
    const saved = saveDraft(sessionStorageOrNull(), target, {
      accountId: view.accountId,
      text: value,
      savedAt: Date.now(),
    });
    // Keep the words and say so; never leave with the sentence silently dropped.
    setFailed(!saved);
    if (!saved) return;
    setSending(true);
    timer.current = window.setTimeout(
      () => router.push(sendHref(target)),
      reduced ? 0 : LEAVE_DELAY_MS,
    );
  }
  const niu = sending ? 'thinking' : text ? 'listening' : 'rest';
  return { text, setText, send, sending, failed, niu } as const;
}
