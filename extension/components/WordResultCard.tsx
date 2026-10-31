/**
 * 单词结果卡：IPA 音标（英/美）+ 发音按钮 + 词性释义列表（§10.2）。
 * 与句子共用英文朗读：可选音色、口音、语速，也可选择词典录音。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import EnglishReader from './EnglishReader';
import type { WordDetail } from '~/utils/api-types';
import NoteBanner from './NoteBanner';

export default function WordResultCard({ data }: { data: WordDetail }) {
  const phoneticAvailable = Boolean(data.phoneticUk || data.phoneticUs);

  return (
    <div className="space-y-3">
      {data.definitionLanguage === 'en' && <NoteBanner tone="warning" text="中文释义暂不可用，当前展示词典英文释义，可稍后重新分析。" />}
      {data.cached && <NoteBanner tone="info" text="来自缓存" />}
      {data.source === 'ai_fallback' && (
        <NoteBanner tone="warning" text="词典未命中，释义由 AI 兜底生成，仅供参考。" />
      )}
      {data.phoneticSource === 'ai_generated' && (
        <NoteBanner tone="warning" text="音标为 AI 生成，非权威词典数据。" />
      )}
      {data.phoneticSource === 'unavailable' && (
        <NoteBanner tone="warning" text="音标暂不可用。" />
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 select-text">{data.word}</h2>
            {phoneticAvailable && (
              <p className="mt-1 text-sm text-slate-500">
                {data.phoneticUk && <span className="mr-3">UK {data.phoneticUk}</span>}
                {data.phoneticUs && <span>US {data.phoneticUs}</span>}
              </p>
            )}
          </div>
        </div>
        <EnglishReader text={data.word} audioUkUrl={data.audioUkUrl} audioUsUrl={data.audioUsUrl} />

        <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {data.definitions.map((d, i) => (
            <li key={i} className="text-sm leading-relaxed">
              <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{d.pos}</span>
              <span className="text-slate-800 select-text">{d.meaning}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
