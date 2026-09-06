import { useEffect, useState } from 'react';
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

  // Fetch the model list exactly once on mount. Re-running this on every
  // `value` or `onChange` change is a footgun: streaming deltas cause
  // `active` to be a new object reference in the parent, which propagates
  // down as a new `value` string, which would abort the in-flight
  // fetchModels() and surface a transient "Cancelled" error in the
  // dropdown. The list is static for the lifetime of the page anyway.
  useEffect(() => {
    const ac = new AbortController();
    fetchModels(ac.signal)
      .then((m) => {
        if (ac.signal.aborted) return;
        setModels(m);
        // Auto-select the first model only if the parent has not given us
        // a real id yet. We deliberately do NOT depend on `value` here so
        // that the parent stays in control of the selection.
        if (m.length > 0) {
          setErr(null);
        }
      })
      .catch((e: Error) => {
        if (e.name === 'AbortError' || ac.signal.aborted) return;
        setErr(e.message);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={classNames('flex flex-col gap-1', className)}>
      <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Model</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={classNames(
          'h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900',
          'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
          'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100',
        )}
      >
        {err && <option value={value}>Error: {err}</option>}
        {!err && models === null && <option value={value}>Loading…</option>}
        {models?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
