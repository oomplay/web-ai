import { useModels, retryModels } from '../../hooks/useModels';
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
  // The model list lives in the shared useModels store (single fetch/
  // retry owner, also used by App for the provider label) — this
  // component only renders its slice of it. Retry triggers the store's
  // immediate reload.
  const { models, loading, error } = useModels();

  // Error / loading states become real (disabled) list entries so the
  // trigger always shows what is happening instead of an empty box.
  const options: SelectOption[] = error
    ? [{ value, label: `Error: ${error}`, danger: true, disabled: true }]
    : loading || !models
      ? [{ value, label: 'Loading…', disabled: true }]
      : models.map((m) => ({ value: m.id, label: m.label }));

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
        {error && (
          <button
            type="button"
            onClick={retryModels}
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
