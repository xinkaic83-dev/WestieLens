/**
 * 选区预览卡：展示原文截断预览与字符数 + 查词/句子切换 + 分析按钮（§10.2）。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

import type { InputType } from '~/utils/api-types';
import type { SelectionUpdatedMessage } from '~/utils/messages';

interface Props {
  selection: SelectionUpdatedMessage;
  mode: InputType;
  loading: boolean;
  onModeChange: (mode: InputType) => void;
  onAnalyze: () => void;
}

const PREVIEW_LIMIT = 200;

export default function SelectionPreviewCard({ selection, mode, loading, onModeChange, onAnalyze }: Props) {
  const preview =
    selection.text.length > PREVIEW_LIMIT ? `${selection.text.slice(0, PREVIEW_LIMIT)}…` : selection.text;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-sm leading-relaxed text-slate-800 select-text">{preview}</p>
      <p className="mt-1 text-xs text-slate-400">{selection.length} 字符 · 来自 {new URL(selection.url).hostname}</p>

      <div className="mt-3 flex items-center gap-2">
        {/* 词句手动切换：用户选择优先于自动建议（§4.1.3） */}
        <div className="flex rounded-md border border-slate-200 text-xs" role="group" aria-label="分析模式">
          <button
            type="button"
            className={`px-2.5 py-1.5 rounded-l-md ${mode === 'word' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
            disabled={loading}
            onClick={() => onModeChange('word')}
          >
            查词/短语
          </button>
          <button
            type="button"
            className={`px-2.5 py-1.5 rounded-r-md ${mode === 'analysis' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
            disabled={loading}
            onClick={() => onModeChange('analysis')}
          >
            句子分析
          </button>
        </div>

        <button
          type="button"
          className="ml-auto rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={loading || selection.text.length === 0}
          onClick={onAnalyze}
        >
          分析
        </button>
      </div>
    </div>
  );
}
