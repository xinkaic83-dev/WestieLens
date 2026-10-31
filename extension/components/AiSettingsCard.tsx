/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MODEL, type SettingsStatus } from '~/services/settings';
import type { ConnectionTestResponse, SettingsResponse } from '~/utils/messages';

interface Props { status: SettingsStatus | null; onStatus: (status: SettingsStatus) => void; onClose: () => void }
export default function AiSettingsCard({ status, onStatus, onClose }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(status?.model ?? DEFAULT_MODEL);
  const [models, setModels] = useState<string[]>([DEFAULT_MODEL, 'deepseek-v4-pro']);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setModel(status?.model ?? DEFAULT_MODEL); }, [status?.model, status?.revision]);

  async function act(action: 'save' | 'test' | 'clear') {
    setBusy(true); setNotice(''); setFailed(false);
    try {
      const response = await browser.runtime.sendMessage(action === 'clear'
        ? { type: 'clear-ai-settings' }
        : { type: action === 'save' ? 'save-ai-settings' : 'test-ai-connection', apiKey: apiKey.trim() || undefined, model }) as SettingsResponse | ConnectionTestResponse;
      if (!alive.current) return;
      if (!response?.ok) {
        setNotice(response?.error.message ?? '扩展通信失败，请重试'); setFailed(true); return;
      }
      if ('models' in response.data) {
        setModels(response.data.models);
        setNotice(response.data.selectedAvailable ? '连接成功，当前模型可用。' : '连接成功，请从列表选择可用模型。');
        if (!response.data.selectedAvailable && response.data.models[0]) setModel(response.data.models[0]);
      } else {
        setApiKey(''); setShowKey(false); onStatus(response.data);
        setNotice(action === 'clear' ? '配置和结果缓存已清除。' : '配置已保存，可以开始分析。');
      }
    } catch {
      if (alive.current) { setNotice('扩展通信失败，请重试'); setFailed(true); }
    } finally { if (alive.current) setBusy(false); }
  }
  const choices = [...new Set([model, ...models])];
  return (
    <section className="rounded-lg border border-blue-200 bg-white p-4 space-y-3" aria-label="AI 服务配置">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">配置 AI 服务</h2>
        <button type="button" onClick={onClose} disabled={busy} className="text-xs text-slate-500">收起配置</button>
      </div>
      <p className="text-xs text-slate-500">服务：DeepSeek 官方 API · 无需启动本地后端</p>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void act('save'); }}>
        <div>
          <label htmlFor="api-key" className="block text-sm mb-1">API Key</label>
          <div className="flex gap-2">
            <input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey}
              onChange={(event) => { setApiKey(event.target.value); setNotice(''); }} disabled={busy}
              autoComplete="off" spellCheck={false} maxLength={512}
              placeholder={status?.configured ? '已保存，留空沿用；输入可替换' : '输入你的 DeepSeek API Key'}
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-2 text-sm" />
            <button type="button" disabled={busy} onClick={() => setShowKey(!showKey)} className="text-xs text-blue-600">{showKey ? '隐藏密钥' : '显示密钥'}</button>
          </div>
        </div>
        <div>
          <label htmlFor="ai-model" className="block text-sm mb-1">模型</label>
          <select id="ai-model" value={model} disabled={busy} onChange={(event) => { setModel(event.target.value); setNotice(''); }}
            className="w-full rounded border border-slate-300 px-2 py-2 text-sm">
            {choices.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">测试连接可刷新账号的可用模型，不发送网页选区。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || (!apiKey.trim() && !status?.configured)} onClick={() => void act('test')}
            className="rounded border border-blue-300 px-3 py-1.5 text-sm text-blue-600 disabled:opacity-40">测试连接</button>
          <button type="submit" disabled={busy || (!apiKey.trim() && !status?.configured)}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40">保存配置</button>
          {status?.configured && <button type="button" disabled={busy} onClick={() => void act('clear')}
            className="rounded px-2 py-1.5 text-sm text-red-600">清除配置</button>}
        </div>
      </form>
      {busy && <p role="status" className="text-xs text-slate-500">正在处理…</p>}
      {notice && <p role={failed ? 'alert' : 'status'} className={`text-xs ${failed ? 'text-red-600' : 'text-blue-700'}`}>{notice}</p>}
      <p className="text-[11px] leading-relaxed text-slate-500">密钥仅保存在本机浏览器，不同步；本地存储不等于加密保险箱。分析时选区会发送给 DeepSeek，查词会请求公开词典。请使用自己的密钥。</p>
    </section>
  );
}
