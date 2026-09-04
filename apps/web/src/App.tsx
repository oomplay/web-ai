import { useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/common/Sidebar';
import { ThemeToggle } from './components/common/ThemeToggle';
import { TopBanner } from './components/ads';
import { ChatWindow } from './components/chat/ChatWindow';
import { Landing } from './components/landing/Landing';
import { useConversations } from './hooks/useConversations';
import { useChat } from './hooks/useChat';
import { classNames } from './lib/format';
import { shouldStartInChat, withChatFlag } from './lib/route';

const MODEL_KEY = 'webai.selectedModel.v1';

function readInitialModel(): string {
  if (typeof window === 'undefined') return 'mock-mini';
  return window.localStorage.getItem(MODEL_KEY) ?? 'mock-mini';
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

  useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_KEY, model);
    } catch {
      /* ignore */
    }
  }, [model]);

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
              ?
            </button>
            <div className="text-sm font-semibold tracking-tight">Web AI</div>
            <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:inline">
              ? Free public chat
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

        <TopBanner className="mx-3 mt-2 sm:mx-4" />

        {error && (
          <div
            role="alert"
            className="mx-3 mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 sm:mx-4 dark:border-red-900/60 dark:bg-red-900/30 dark:text-red-200"
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
        />
      </main>
    </div>
  );
}
