import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, Conversation } from '../types/chat';
import { safeJsonParse, uid } from '../lib/format';

const STORAGE_KEY = 'webai.conversations.v1';
const ACTIVE_KEY = 'webai.activeConversation.v1';

// How long to wait after the last state change before writing to localStorage.
// Streaming emits ~1 delta per ~20ms; without debouncing, we would write to
// localStorage and JSON.stringify the entire conversation on every delta. That
// blocks the main thread and makes streaming visibly stall. With debouncing,
// we write at most once per PERSIST_DEBOUNCE_MS regardless of update rate.
const PERSIST_DEBOUNCE_MS = 250;

interface ConversationsState {
  conversations: Record<string, Conversation>;
  order: string[];
  activeId: string | null;
}

const empty: ConversationsState = { conversations: {}, order: [], activeId: null };

function loadFromStorage(): ConversationsState {
  if (typeof window === 'undefined') return empty;
  const data = safeJsonParse<ConversationsState | null>(
    window.localStorage.getItem(STORAGE_KEY),
    null,
  );
  if (!data) return empty;
  if (
    typeof data !== 'object' ||
    data === null ||
    !data.conversations ||
    !Array.isArray(data.order)
  ) {
    return empty;
  }
  const activeId =
    window.localStorage.getItem(ACTIVE_KEY) && data.conversations[
      window.localStorage.getItem(ACTIVE_KEY) as string
    ]
      ? (window.localStorage.getItem(ACTIVE_KEY) as string)
      : data.order[0] ?? null;
  return { ...data, activeId };
}

function persist(state: ConversationsState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (state.activeId) {
      window.localStorage.setItem(ACTIVE_KEY, state.activeId);
    } else {
      window.localStorage.removeItem(ACTIVE_KEY);
    }
  } catch {
    /* ignore quota errors */
  }
}

function titleFromContent(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 40 ? flat.slice(0, 40) + '…' : flat || 'New chat';
}

export function useConversations(model: string) {
  const [state, setState] = useState<ConversationsState>(() => loadFromStorage());
  const initialMount = useRef(true);

  // Debounced persist: we only write to localStorage after PERSIST_DEBOUNCE_MS
  // of inactivity. This keeps streaming smooth even when deltas arrive faster
  // than the browser can render + serialize. A flush is also performed on
  // unmount and beforeunload so no data is lost.
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    const t = setTimeout(() => persist(state), PERSIST_DEBOUNCE_MS);
    const onBeforeUnload = () => persist(state);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // Final synchronous flush so a quick refresh after a stream end still
      // captures the last delta.
      persist(state);
    };
  }, [state]);

  const active = state.activeId ? state.conversations[state.activeId] : undefined;

  const createConversation = useCallback((): Conversation => {
    const id = uid('conv');
    const now = Date.now();
    const conv: Conversation = {
      id,
      title: 'New chat',
      model,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    setState((s) => ({
      conversations: { ...s.conversations, [id]: conv },
      order: [id, ...s.order],
      activeId: id,
    }));
    return conv;
  }, [model]);

  const selectConversation = useCallback((id: string) => {
    setState((s) => (s.conversations[id] ? { ...s, activeId: id } : s));
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setState((s) => {
      const next = { ...s.conversations };
      delete next[id];
      const order = s.order.filter((x) => x !== id);
      const activeId = s.activeId === id ? order[0] ?? null : s.activeId;
      return { conversations: next, order, activeId };
    });
  }, []);

  const clearAll = useCallback(() => {
    setState(empty);
  }, []);

  const appendMessage = useCallback(
    (conversationId: string, msg: Omit<ChatMessage, 'id' | 'createdAt'>) => {
      const full: ChatMessage = { ...msg, id: uid('msg'), createdAt: Date.now() };
      setState((s) => {
        const conv = s.conversations[conversationId];
        if (!conv) return s;
        const updated: Conversation = {
          ...conv,
          messages: [...conv.messages, full],
          updatedAt: Date.now(),
          title:
            conv.title === 'New chat' && full.role === 'user'
              ? titleFromContent(full.content)
              : conv.title,
        };
        return { ...s, conversations: { ...s.conversations, [conversationId]: updated } };
      });
      return full;
    },
    [],
  );

  const updateLastMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      setState((s) => {
        const conv = s.conversations[conversationId];
        if (!conv) return s;
        const messages = conv.messages.map((m) =>
          m.id === messageId ? { ...m, ...patch } : m,
        );
        return {
          ...s,
          conversations: {
            ...s.conversations,
            [conversationId]: { ...conv, messages, updatedAt: Date.now() },
          },
        };
      });
    },
    [],
  );

  const renameConversation = useCallback((id: string, title: string) => {
    setState((s) => {
      const conv = s.conversations[id];
      if (!conv) return s;
      return {
        ...s,
        conversations: { ...s.conversations, [id]: { ...conv, title } },
      };
    });
  }, []);

  const exportConversation = useCallback(
    (id: string) => {
      const conv = state.conversations[id];
      if (!conv) return;
      const blob = new Blob([JSON.stringify(conv, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${conv.title.replace(/[^a-z0-9-_]+/gi, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [state.conversations],
  );

  return {
    conversations: state.order
      .map((id) => state.conversations[id])
      .filter((c): c is Conversation => Boolean(c)),
    active,
    createConversation,
    selectConversation,
    deleteConversation,
    clearAll,
    appendMessage,
    updateLastMessage,
    renameConversation,
    exportConversation,
  };
}
