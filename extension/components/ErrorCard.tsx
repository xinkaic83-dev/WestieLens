/**
 * 错误卡：错误码 → 中文文案映射展示；仅 retryable=true 时显示"重新尝试"（§4.7 / §5.2 / §10.2）。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

interface Props {
  message: string;
  retryable: boolean;
  onRetry: () => void;
}

export default function ErrorCard({ message, retryable, onRetry }: Props) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <p className="text-sm leading-relaxed text-red-700">{message}</p>
      {retryable && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          重新尝试
        </button>
      )}
    </div>
  );
}
