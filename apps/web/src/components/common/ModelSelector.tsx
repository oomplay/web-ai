import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelInfo } from '../../types/provider';
import { fetchModels } from '../../lib/api';
import { classNames } from '../../lib/format';
import { Select, type SelectOption } from './Select';

interface Props {
  value: string;
  onChange: (id: string) => void;
  className?: string;
  /**
   * Compact render for inline placements (no "Model" label, smaller
   * trigger). Full labelled layout otherwise.
   */
  compact?: boolean;
  /**
   * Accessible name for the select. Compact callers (status bar style)
   * should pass something explicit; the default suits the labelled
   * empty-state usage.
   */
  ariaLabel?: string;
}

export function ModelSelector({
  value,
  onChange,
  className,
  compact,
  ariaLabel,
}: Props) {
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

  // Error / loading states become real (disabled) list entries so the
  // trigger always shows what is happening instead of an empty box.
  const options: SelectOption[] = err
    ? [{ value, label: `Error: ${err}`, danger: true, disabled: true }]
    : loading
      ? [{ value, label: 'Loading…', disabled: true }]
      : (models ?? []).map((m) => ({ value: m.id, label: m.label }));

  return (
    <div className={classNames('flex flex-col gap-1', compact && 'gap-0', className)}>
      {!compact && (
        <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Model
        </label>
      )}
      <div className="flex items-center gap-1">
        <Select
          options={options}
          value={value}
          onChange={onChange}
          compact={compact}
          ariaLabel={ariaLabel ?? 'Select model'}
          className="min-w-0 flex-1"
        />
        {err && (
          <button
            type="button"
            onClick={load}
            className={classNames(
              'theme-fade animate-fade inline-flex shrink-0 items-center rounded-md border border-zinc-300 px-2 text-xs font-medium',
              compact ? 'h-7' : 'h-9',
              'text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-brand-500/50',
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
