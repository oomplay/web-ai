import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelInfo } from '../../types/provider';
import { fetchModels } from '../../lib/api';
import { classNames } from '../../lib/format';

interface Props {
  value: string;
  onChange: (id: string) => void;
  className?: string;
}

export function ModelSelector({ value, onChange, className }: Props) {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const acRef = useRef<AbortController | null>(null);

  // Fetch the model list on mount and whenever the user clicks Retry.
  // Re-running this on every `value` or `onChange` change is a footgun:
  // streaming deltas cause `active` to be a new object reference in the
  // parent, which propagates down as a new `value` string, which would
  // abort the in-flight fetchModels() and surface a transient
  // "Cancelled" error in the dropdown. The list is static for the
  // lifetime of the page anyway.
  const load = useCallback(() => {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    setLoading(true);
    setErr(null);
    fetchModels(ac.signal)
      .then((m) => {
        if (ac.signal.aborted) return;
        setModels(m);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError' || ac.signal.aborted) return;
        setErr(e.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    return () => acRef.current?.abort();
  }, [load]);

  return (
    <div className={classNames('flex flex-col gap-1', className)}>
      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Model</label>
      <div className="flex items-center gap-1">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={classNames(
            'h-9 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900',
            'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
            'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100',
          )}
        >
          {err && <option value={value}>Error: {err}</option>}
          {!err && loading && <option value={value}>Loading…</option>}
          {models?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {err && (
          <button
            type="button"
            onClick={load}
            className={classNames(
              'inline-flex h-9 shrink-0 items-center rounded-md border border-zinc-300 px-2 text-xs font-medium',
              'text-zinc-700 hover:bg-zinc-100',
              'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
            )}
            title="Reload the model list"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
