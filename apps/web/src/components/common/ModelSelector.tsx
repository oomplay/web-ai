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

  useEffect(() => {
    const ac = new AbortController();
    fetchModels(ac.signal)
      .then((m) => {
        setModels(m);
        if (!value && m.length > 0) {
          const first = m[0];
          if (first) onChange(first.id);
        }
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setErr(e.message);
      });
    return () => ac.abort();
  }, [onChange, value]);

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
