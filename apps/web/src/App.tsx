import { useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/common/Sidebar';
import { ThemeToggle } from './components/common/ThemeToggle';
import { ChatWindow } from './components/chat/ChatWindow';
import { Landing } from './components/landing/Landing';
import { useConversations } from './hooks/useConversations';
import { useChat } from './hooks/useChat';
import { classNames } from './lib/format';
import { shouldStartInChat, withChatFlag } from './lib/route';
import { fetchModels } from './lib/api';
import type { ModelInfo } from './types/provider';

// Map a backend `provider` id (as returned in /api/models) to a short
// human label we can show to end users. The id is internal; the label
// is the only thing the user sees. Unknown providers fall back to a
// generic phrasing so we never leak the raw id.
const PROVIDER_LABELS: Record<string, string> = {
  mock: 'demo',
  'ai-gateway': 'AI gateway',
};

function labelForProvider(providerId: string | undefined): string | undefined {
  if (!providerId) return undefined;
  return PROVIDER_LABELS[providerId] ?? 'external AI';
}

const MODEL_KEY = 'webai.selectedModel.v1';

function readInitialModel(): string {
  if (typeof window === 'undefined') return '';
  // Fall back to an empty string (NOT a hardcoded 'mock-mini' default).
  // ModelSelector sets the first model from /api/models when value is
  // empty, so a stale localStorage value from an earlier session
  // (e.g. a model id that the backend no longer exposes) cannot
  // produce a 404 on the first message.
  return window.localStorage.getItem(MODEL_KEY) ?? '';
}

function readInitialLandingOpen(): boolean {
  // The landing page is shown when the URL does NOT contain `?chat=1`.
  // `?chat=1` reveals the chat directly so the URL is bookmarkable and
  // a deep link into the chat is possible.
  return !shouldStartInChat();
}

export default function App() {
  const [model, setModel] = useState<string>(readInitialModel);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Landing gate: true = show <Landing />, false = show chat. The "Start
  // chatting" CTA on the landing page flips this to false and pushes a
  // `?chat=1` query string so the URL is shareable and the back button
  // returns to the landing page.
  const [landingOpen, setLandingOpen] = useState<boolean>(readInitialLandingOpen);
  // Track the active conversation id so the model-sync effect below does not
  // re-fire on every streaming delta (which produces a new `active` object even
  // though the id is unchanged).
  const activeIdRef = useRef<string | null>(null);
  // Cache of /api/models. Used to (a) auto-select the first model when
  // localStorage is empty, and (b) derive a human-readable provider name
  // shown in the chat composer footer.
  const [models, setModels] = useState<ModelInfo[] | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_KEY, model);
    } catch {
      /* ignore */
    }
  }, [model]);

  // Load the model list once. Two reasons:
  //   (a) the localStorage-persisted model id may have been removed
  //       server-side, in which case the empty string sentinel would
  //       never get replaced and the first message would 404.
  //   (b) the composer footer needs to know which provider the chosen
  //       model belongs to (mock vs ai-gateway) so the "Powered by …"
  //       line is honest.
  useEffect(() => {
    let cancelled = false;
    let retryInterval: ReturnType<typeof setInterval> | undefined;
    const ac = new AbortController();
    const tryFetch = () => {
      fetchModels(ac.signal)
        .then((m) => {
          if (cancelled || ac.signal.aborted) return;
          setModels(m);
          // Stop the retry loop once the list is loaded.
          if (retryInterval) clearInterval(retryInterval);
          if (model === '' && m.length > 0) {
            const first = m[0];
            if (first) setModel(first.id);
          }
        })
        .catch((e: Error) => {
          if (e.name === 'AbortError' || ac.signal.aborted || cancelled) return;
          // eslint-disable-next-line no-console
          console.warn('[web-ai] model fetch failed; will retry', e);
        });
    };
    tryFetch();
    // The model list is static for the lifetime of the page, but a
    // transient backend blip at page-load time must not degrade the
    // whole session (the composer footer loses its provider label).
    // While the list has not loaded, keep retrying gently; the interval
    // is cleared on the first successful fetch or on unmount.
    retryInterval = setInterval(tryFetch, 15_000);
    return () => {
      cancelled = true;
      if (retryInterval) clearInterval(retryInterval);
      ac.abort();
    };
    // We intentionally run this only once. The model list is static for
    // the lifetime of the page; we do not want to abort and re-fetch
    // on every `model` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    conversations,
    active,
    createConversation,
    selectConversation,
    deleteConversation,
    clearAll,
    appendMessage,
    updateLastMessage,
    renameConversation,
    exportConversation,
  } = useConversations(model);

  useEffect(() => {
    // Only sync the global `model` selection when the user actually switches
    // active conversation (i.e. `active` changed). We compare IDs instead of
    // object identity so the effect does not re-fire on every streaming delta,
    // which recomputes the `active` object even though the underlying
    // conversation id is the same.
    if (active && active.model !== model && active.id !== activeIdRef.current) {
      activeIdRef.current = active.id;
      setModel(active.model);
    } else if (active) {
      activeIdRef.current = active.id;
    }
  }, [active, model]);

  const { isStreaming, error, send, stop } = useChat({
    model,
    active,
    onCreateConversation: createConversation,
    onAppendMessage: appendMessage,
    onUpdateLastMessage: updateLastMessage,
  });

  const streamingMessageId = useMemo(() => {
    if (!isStreaming || !active) return undefined;
    for (let i = active.messages.length - 1; i >= 0; i--) {
      const m = active.messages[i];
      if (m && m.role === 'assistant') return m.id;
    }
    return undefined;
  }, [active, isStreaming]);

  // Look up the selected model's provider from the cached model list so
  // the composer footer can show "AI gateway" / "demo" / etc. without
  // hardcoding a string that has nothing to do with the actual config.
  const providerName = useMemo(() => {
    if (!models || model === '') return undefined;
    const found = models.find((m) => m.id === model);
    return labelForProvider(found?.provider);
  }, [models, model]);

  const handleSelect = (id: string) => {
    selectConversation(id);
    setSidebarOpen(false);
  };

  const handleCreate = () => {
    createConversation();
    setSidebarOpen(false);
  };

  const startChat = () => {
    setLandingOpen(false);
    // Reflect the state in the URL so it is shareable and the back button
    // works. We use `history.replaceState` (not push) so the landing page
    // is the canonical entry point of a fresh tab.
    if (typeof window !== 'undefined') {
      try {
        const target = withChatFlag(window.location.pathname);
        window.history.replaceState(null, '', target);
      } catch {
        /* ignore: history API can be unavailable in some sandboxes */
      }
    }
  };

  if (landingOpen) {
    return <Landing onStartChat={startChat} />;
  }


  return (
    <div className="flex h-screen w-screen overflow-hidden bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div
        className={classNames(
          'fixed inset-0 z-40 md:relative md:inset-auto md:z-auto md:flex',
          sidebarOpen ? 'flex' : 'hidden',
        )}
      >
        <div
          className="absolute inset-0 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
        <div className="relative z-50 h-full md:static md:z-auto">
          <Sidebar
            conversations={conversations}
            activeId={active?.id ?? null}
            onSelect={handleSelect}
            onDelete={(id) => deleteConversation(id)}
            onCreate={handleCreate}
            onRename={(id, title) => renameConversation(id, title)}
            onExport={(id) => exportConversation(id)}
            onClose={() => setSidebarOpen(false)}
          />
        </div>
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className={classNames(
            'flex items-center justify-between gap-2 border-b border-zinc-200 bg-white/80 px-3 py-2 backdrop-blur',
            'dark:border-zinc-800 dark:bg-zinc-950/80 sm:px-4',
          )}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              className={classNames(
                'inline-flex h-9 w-9 items-center justify-center rounded-md border',
                'border-zinc-300 text-zinc-700 hover:bg-zinc-100 md:hidden',
                'dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800',
              )}
            >
              {/* Hamburger icon (inline SVG; the project has no icon library). */}
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="text-sm font-semibold tracking-tight">Kiwi AI</div>
            <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:inline">
              · Free public chat
            </span>
          </div>
          <div className="flex items-center gap-2">
            {conversations.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete all conversations on this device?')) clearAll();
                }}
                className={classNames(
                  'hidden h-9 items-center rounded-md border border-zinc-300 px-3 text-xs text-zinc-600 hover:bg-zinc-100 sm:inline-flex',
                  'dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800',
                )}
              >
                Clear all
              </button>
            )}
            <ThemeToggle />
          </div>
        </header>

        {error && (
          <div
            role="alert"
            className="animate-fade mx-3 mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 sm:mx-4 dark:border-red-900/60 dark:bg-red-900/30 dark:text-red-200"
          >
            {error}
          </div>
        )}

        <ChatWindow
          active={active}
          model={model}
          onModelChange={setModel}
          onSend={send}
          onStop={stop}
          isStreaming={isStreaming}
          streamingMessageId={streamingMessageId}
          providerName={providerName}
        />
      </main>
    </div>
  );
}
