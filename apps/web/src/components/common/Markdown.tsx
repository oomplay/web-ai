import { type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { classNames } from '../../lib/format';
import { useCopy } from './useCopy';

interface Props {
  children: string;
  className?: string;
}

function CopyButton({ text }: { text: string }) {
  const { status, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(text)}
      className={classNames(
        'absolute right-1 top-1 rounded border border-zinc-300 bg-white/80 px-1.5 py-0.5',
        'text-[10px] font-medium text-zinc-600 opacity-0 transition-opacity',
        'hover:bg-white group-hover:opacity-100',
        'dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-900',
        status === 'failed' && 'text-red-600 dark:text-red-400',
      )}
      aria-label="Copy code"
    >
      {status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : 'Copy'}
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
