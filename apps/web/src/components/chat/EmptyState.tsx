import { ModelSelector } from '../common/ModelSelector';
import { classNames } from '../../lib/format';

interface Props {
  onSuggest: (text: string) => void;
  model: string;
  onModelChange: (id: string) => void;
}

const SUGGESTIONS: { title: string; text: string }[] = [
  { title: 'Explain a concept', text: 'Explain how a transformer model works in simple terms.' },
  { title: 'Write code', text: 'Write a TypeScript function that debounces another function.' },
  { title: 'Summarize', text: 'Summarize the benefits of streaming responses in chat UIs.' },
  { title: 'Brainstorm', text: 'Give me 5 creative product names for a free public AI chat site.' },
];

export function EmptyState({ onSuggest, model, onModelChange }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 py-10 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500 text-lg font-bold text-white shadow-md">
        K
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          How can I help you today?
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Free public AI chat. No account needed.
        </p>
      </div>

      <div className="w-full max-w-xs">
        <ModelSelector value={model} onChange={onModelChange} />
      </div>

      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onSuggest(s.text)}
            className={classNames(
              'rounded-xl border border-zinc-200 bg-white p-3 text-left text-sm',
              'hover:border-brand-300 hover:bg-brand-50',
              'dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800',
            )}
          >
            <div className="font-medium">{s.title}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{s.text}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
