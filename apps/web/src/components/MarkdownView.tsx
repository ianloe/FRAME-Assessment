import React from 'react';
import ReactMarkdown from 'react-markdown';

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-800 dark:text-slate-200">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mt-4 text-lg font-bold text-[#1e3a5f] dark:text-blue-300">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 border-b border-slate-200 pb-1 text-base font-bold text-[#1e3a5f] dark:border-slate-700 dark:text-blue-300">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{children}</h3>
          ),
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="rounded bg-slate-200/70 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-800">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-[#1e3a5f] pl-3 italic text-slate-600 dark:border-blue-400 dark:text-slate-400">
              {children}
            </blockquote>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
