/**
 * 通用提示条：降级（partial）、缓存命中、AI 数据来源等状态提示。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

type Tone = 'info' | 'warning';

const TONE_CLASSES: Record<Tone, string> = {
  info: 'bg-sky-50 text-sky-700 border-sky-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function NoteBanner({ tone, text }: { tone: Tone; text: string }) {
  return (
    <div className={`rounded-md border px-2.5 py-1.5 text-xs ${TONE_CLASSES[tone]}`} role="status">
      {text}
    </div>
  );
}
