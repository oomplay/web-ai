import { useEffect } from 'react';
import { useState } from 'react';
import { Footer } from '../common/Footer';

interface Props {
  onStartChat: () => void;
}

/**
 * Landing content for the public root URL.
 *
 * Renders a hero, a 3-card explainer, a privacy / security summary,
 * an FAQ, and a footer with legal links. The chat is reached via the
 * "Start chatting" CTA which sets `?chat=1` in the URL.
 *
 * This component is content-only: it does not import anything from
 * `lib/api.ts`, the chat hooks, or the AdSlot module. The ad slots
 * remain in the chat tree, not the landing tree.
 */
export function Landing({ onStartChat }: Props) {
  // Deep-link support: arriving at /#how-it-works (from the ad card's
  // "How it works" CTA or an external link) must scroll to the section
  // once it is actually rendered — at first paint the browser's own
  // hash scroll fires before React mounts anything, so it silently
  // misses the not-yet-existing element.
  useEffect(() => {
    if (window.location.hash !== '#how-it-works') return;
    // Double rAF: one frame for React to commit the DOM, one for the
    // browser to lay it out.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .getElementById('how-it-works')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
    );
  }, []);

  return (
    <div className="thin-scroll min-h-screen w-full overflow-y-auto bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <main className="mx-auto w-full max-w-3xl px-4 pt-10 sm:px-6 sm:pt-16">
        <Hero onStartChat={onStartChat} />
        <Explainer />
        <PrivacySection />
        <Faq />
        <Footer />
      </main>
    </div>
  );
}

function Hero({ onStartChat }: Props) {
  return (
    <section
      aria-labelledby="hero-title"
      className="flex flex-col items-start gap-5"
    >
      <h1
        id="hero-title"
        className="text-3xl font-bold tracking-tight sm:text-4xl"
      >
        Free AI chat. No login, no signup, no subscription.
      </h1>
      <p className="max-w-2xl text-base text-zinc-600 sm:text-lg dark:text-zinc-300">
        Kiwi AI is a small, ad-funded public chat. Pick a model, ask
        anything, and start a conversation in one click.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStartChat}
          className="inline-flex items-center rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          Start chatting
        </button>
        <a
          href="#how-it-works"
          className="inline-flex items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          How it works
        </a>
      </div>
    </section>
  );
}

function Explainer() {
  const cards: Array<{ title: string; body: string }> = [
    {
      title: 'No account',
      body: 'Your history stays in your browser, not on a server. There is no signup, no email, no password to forget.',
    },
    {
      title: 'Ad-funded',
      body: 'Ads keep the service free. No paid tier, no subscription, no data sale. Your messages are not used to target ads.',
    },
    {
      title: 'Pick a model',
      body: 'The model selector is right in the chat header. The backend routes your request to whichever model the operator has enabled.',
    },
  ];
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="mt-12 sm:mt-16"
    >
      <h2
        id="how-it-works-title"
        className="text-xl font-semibold tracking-tight sm:text-2xl"
      >
        How it works
      </h2>
      <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <li
            key={c.title}
            className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <h3 className="text-sm font-semibold">{c.title}</h3>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              {c.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PrivacySection() {
  const items: string[] = [
    'We do not require an account. There is nothing to register for, and nothing to lose.',
    'We do not log message content. Server logs are limited to IP, status, and request size for abuse prevention.',
    'We do not set advertising cookies unless you accept. See the privacy policy for the current consent flow.',
    'The chat safety layer enforces per-IP rate limits, input bounds, and sanitised error messages. We share no upstream error text with you.',
  ];
  return (
    <section
      aria-labelledby="privacy-title"
      className="mt-12 sm:mt-16"
    >
      <h2
        id="privacy-title"
        className="text-xl font-semibold tracking-tight sm:text-2xl"
      >
        Privacy &amp; security
      </h2>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-zinc-700 sm:text-base dark:text-zinc-300">
        {items.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

interface FaqItem {
  q: string;
  a: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'Is this really free?',
    a: 'Yes. There is no paid tier and no subscription. The service is funded by ads shown around the chat. If you use an ad blocker you will see a labelled empty box instead of an ad, and the chat will still work.',
  },
  {
    q: 'Do you store my messages?',
    a: 'No. The backend does not persist chat content. Your conversation history is kept in your browser via localStorage and is not uploaded anywhere.',
  },
  {
    q: 'Which AI models are supported?',
    a: 'The model selector in the chat header lists the models the operator has enabled. The default is a free mock model; a real provider is enabled by the operator via environment configuration.',
  },
  {
    q: 'Why am I rate-limited?',
    a: 'Kiwi AI is anonymous and public. Per-IP rate limits and concurrent-stream caps are the only thing standing between the service and quota exhaustion. Limits are conservative; if you hit them, slow down and try again shortly.',
  },
  {
    q: 'How do I report abuse?',
    a: 'Use the Contact link in the footer. Include the approximate time and a short description. The operator reads abuse reports and adjusts the safety layer accordingly.',
  },
  {
    q: 'Why am I seeing a placeholder box instead of an ad?',
    a: 'Either you are using an ad blocker, or the operator has not enabled ad serving on this deployment. In both cases the chat is unaffected.',
  },
  {
    q: 'Can I run my own instance?',
    a: 'Yes. The repository is self-contained: a Node backend, a React frontend, an env-driven provider registry, and a documented safety layer. See the README and PHASE_3_PLAN.md for the production checklist.',
  },
];

function Faq() {
  return (
    <section
      aria-labelledby="faq-title"
      className="mt-12 sm:mt-16"
    >
      <h2
        id="faq-title"
        className="text-xl font-semibold tracking-tight sm:text-2xl"
      >
        Frequently asked questions
      </h2>
      <div className="mt-4 flex flex-col gap-2">
        {FAQ_ITEMS.map((item) => (
          <FaqEntry key={item.q} item={item} />
        ))}
      </div>
    </section>
  );
}

function FaqEntry({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium sm:text-base">
        <span>{item.q}</span>
        <span
          aria-hidden
          className="select-none text-zinc-400 group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
        {item.a}
      </p>
    </details>
  );
}
