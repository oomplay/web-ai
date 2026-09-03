import { useState } from 'react';
import type { Conversation } from '../../types/chat';
import { classNames, formatRelative } from '../../lib/format';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onExport: (id: string) => void;
  onClose?: () => void;
  className?: string;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onCreate,
  onRename,
  onExport,
  onClose,
  className,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startRename = (c: Conversation) => {
    setEditingId(c.id);
    setDraft(c.title);
  };

  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <aside
      className={classNames(
        'flex h-full w-72 shrink-0 flex-col border-r border-zinc-200 bg-white',
        'dark:border-zinc-800 dark:bg-zinc-950',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-sm font-bold text-white">
            W
          </div>
          <div className="text-sm font-semibold tracking-tight">Web AI</div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 md:hidden"
          >
            ✕
          </button>
        )}
      </div>

      <div className="p-3">
        <button
          type="button"
          onClick={onCreate}
          className={classNames(
            'w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white',
            'hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500',
          )}
        >
          + New chat
        </button>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 && (
          <p className="px-2 py-3 text-xs text-zinc-500 dark:text-zinc-400">
            No conversations yet. Start by sending a message.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {conversations.map((c) => {
            const isActive = c.id === activeId;
            const isEditing = editingId === c.id;
            return (
              <li key={c.id}>
                <div
                  className={classNames(
                    'group flex items-center gap-1 rounded-md px-2 py-2 text-sm',
                    isActive
                      ? 'bg-brand-50 text-brand-700 dark:bg-zinc-800 dark:text-brand-300'
                      : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800',
                  )}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full rounded border border-zinc-300 bg-white px-1 py-0.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelect(c.id)}
                      className="flex flex-1 flex-col items-start text-left"
                    >
                      <span className="line-clamp-1 w-full break-words">{c.title}</span>
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {formatRelative(c.updatedAt)} · {c.messages.length} msg
                      </span>
                    </button>
                  )}
                  <div className="hidden items-center gap-1 group-hover:flex">
                    <button
                      type="button"
                      aria-label="Rename"
                      onClick={() => startRename(c)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      aria-label="Export"
                      onClick={() => onExport(c.id)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    >
                      ⤓
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      onClick={() => {
                        if (confirm(`Delete "${c.title}"?`)) onDelete(c.id);
                      }}
                      className="rounded p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-zinc-200 p-3 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Local-only · No account
      </div>
    </aside>
  );
}
