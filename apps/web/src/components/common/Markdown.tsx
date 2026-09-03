import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { classNames } from '../../lib/format';

interface Props {
  children: string;
  className?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard may be blocked */
        }
      }}
      className={classNames(
        'absolute right-1 top-1 rounded border border-zinc-300 bg-white/80 px-1.5 py-0.5',
        'text-[10px] font-medium text-zinc-600 opacity-0 transition-opacity',
        'hover:bg-white group-hover:opacity-100',
        'dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900',
      )}
      aria-label="Copy code"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function Markdown({ children, className }: Props) {
  return (
    <div className={classNames('md', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          pre: ({ children }: { children?: ReactNode }) => (
            <div className="group relative">
              <pre>{children}</pre>
            </div>
          ),
          code(props) {
            const { className: codeClass, children, ...rest } = props as {
              className?: string;
              children?: ReactNode;
            } & React.HTMLAttributes<HTMLElement>;
            const isBlock = codeClass?.includes('hljs') || codeClass?.includes('language-');
            const text = stringifyChildren(children);
            if (isBlock) {
              return (
                <div className="group relative">
                  <code className={codeClass} {...rest}>
                    {children}
                  </code>
                  <CopyButton text={text} />
                </div>
              );
            }
            return (
              <code className={codeClass} {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function stringifyChildren(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(stringifyChildren).join('');
  if (typeof node === 'object' && 'props' in node) {
    return stringifyChildren((node as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}
