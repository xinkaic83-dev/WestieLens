/**
 * 骨架屏：loading 态占位，文案不过度承诺模型内部进度（§5.2 / §10.2）。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

export default function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="正在分析">
      <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200" />
      <div className="h-20 w-full animate-pulse rounded bg-slate-100" />
      <p className="text-center text-xs text-slate-400">正在分析…</p>
    </div>
  );
}
