/**
 * 句子结果卡：分区渲染 原文/译文 → 句子主干 → 主句与从句 → 句子成分 → 重点语法（§5.1 / §10.2）。
 * partial=true 时顶部展示降级提示条；cached=true 展示"来自缓存"。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import type { ReactNode } from 'react';
import type { AnalyzeResponse } from '~/utils/api-types';
import NoteBanner from './NoteBanner';
import EnglishReader from './EnglishReader';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-3">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export default function SentenceResultCard({ data }: { data: AnalyzeResponse }) {
  return (
    <div className="space-y-3">
      {data.partial && (
        <NoteBanner tone="warning" text="结构分析暂不可用，本次仅返回译文（降级结果）。" />
      )}
      {data.cached && <NoteBanner tone="info" text="来自缓存" />}

      <Section title="原文 / 译文">
        <p className="text-sm leading-relaxed text-slate-800 select-text">{data.text}</p>
        <EnglishReader text={data.text} />
        <p className="mt-2 border-t border-dashed border-slate-100 pt-2 text-sm leading-relaxed text-blue-700 select-text">
          {data.translation}
        </p>
      </Section>

      {data.mainSentence && (
        <Section title="句子主干">
          <p className="text-sm text-slate-700 select-text">{data.mainSentence}</p>
        </Section>
      )}

      {data.clauses.length > 0 && (
        <Section title="主句与从句">
          <ul className="space-y-2">
            {data.clauses.map((c, i) => (
              <li key={i} className="text-sm">
                <span className="mr-1.5 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">
                  {c.label}
                </span>
                <span className="text-slate-800 select-text">{c.text}</span>
                <p className="mt-0.5 text-xs text-slate-500">{c.explanation}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.syntaxComponents.length > 0 && (
        <Section title="句子成分">
          <ul className="space-y-2">
            {data.syntaxComponents.map((s, i) => (
              <li key={i} className="text-sm">
                <span className="mr-1.5 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-600">
                  {s.label}
                </span>
                <span className="text-slate-800 select-text">{s.text}</span>
                <p className="mt-0.5 text-xs text-slate-500">{s.explanation}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.grammarPoints.length > 0 && (
        <Section title="重点语法">
          <ul className="space-y-2">
            {data.grammarPoints.map((g, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium text-slate-800">{g.name}</span>
                <span className="mx-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 select-text">
                  {g.text}
                </span>
                <p className="mt-0.5 text-xs text-slate-500">{g.explanation}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
