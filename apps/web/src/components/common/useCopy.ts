import { useEffect, useRef, useState } from 'react';

export type CopyStatus = 'idle' | 'copied' | 'failed';

/**
 * Shared clipboard-copy behavior for all copy buttons in the app
 * (assistant message action row, code blocks). Handles the success /
 * failure state, auto-revert timeout, and cleanup on unmount.
 *
 * Failures are NOT swallowed silently: clipboard writes can be blocked
 * (permissions, non-secure context, document unfocused) and the caller
 * is expected to render the `failed` state so the user knows nothing
 * was copied.
 */
export function useCopy(resetAfterMs = 1500): {
  status: CopyStatus;
  copy: (text: string) => void;
} {
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => setStatus('copied'))
      .catch(() => setStatus('failed'))
      .finally(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setStatus('idle'), resetAfterMs);
      });
  };

  return { status, copy };
}
