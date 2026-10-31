/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
import { useEffect, useId, useRef, useState } from 'react';
import { DEFAULT_SPEECH, englishVoices, normalizeSpeechPreferences, selectVoice, speechChunks,
  PANEL_HIDDEN_EVENT, SPEECH_PREFERENCES_EVENT, SPEECH_RATES, SPEECH_SETTINGS_KEY, type SpeechPreferences } from '~/utils/speech';

interface Props { text: string; audioUkUrl?: string; audioUsUrl?: string }
export default function EnglishReader({ text, audioUkUrl, audioUsUrl }: Props) {
  const id = useId();
  const [preferences, setPreferences] = useState<SpeechPreferences>(DEFAULT_SPEECH);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [stage, setStage] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [error, setError] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [storageError, setStorageError] = useState('');
  const token = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const preferencesRef = useRef(DEFAULT_SPEECH);
  const prefVersion = useRef(0);

  function cancel() {
    token.current++;
    clearTimeout(watchdog.current);
    if (audio.current) {
      audio.current.onended = null; audio.current.onerror = null;
      audio.current.pause(); audio.current = null;
    }
    if (utterance.current) {
      utterance.current.onend = null; utterance.current.onerror = null; utterance.current.onstart = null;
      utterance.current = null;
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    }
  }
  function stop() { cancel(); setStage('idle'); }

  useEffect(() => {
    let alive = true;
    const synth = typeof speechSynthesis === 'undefined' ? null : speechSynthesis;
    const updateVoices = () => { if (alive) setVoices(synth?.getVoices() ?? []); };
    updateVoices();
    synth?.addEventListener('voiceschanged', updateVoices);
    const initial = prefVersion.current;
    void browser.storage.local.get(SPEECH_SETTINGS_KEY).then((stored) => {
      if (alive && prefVersion.current === initial) {
        const next = normalizeSpeechPreferences(stored[SPEECH_SETTINGS_KEY]);
        preferencesRef.current = next; setPreferences(next);
      }
    }).catch(() => { if (alive) setStorageError('朗读偏好读取失败，本次使用默认设置'); });
    const onChanged = (changes: Record<string, { newValue?: unknown }>) => {
      if (!(SPEECH_SETTINGS_KEY in changes)) return;
      const next = normalizeSpeechPreferences(changes[SPEECH_SETTINGS_KEY]?.newValue);
      if (JSON.stringify(next) === JSON.stringify(preferencesRef.current)) return;
      preferencesRef.current = next;
      prefVersion.current++;
      cancel(); setStage('idle'); setSourceLabel('');
      setPreferences(next);
    };
    const onLocal = (event: Event) => {
      prefVersion.current++;
      cancel(); setStage('idle'); setSourceLabel('');
      const next = (event as CustomEvent<SpeechPreferences>).detail;
      preferencesRef.current = next; setPreferences(next);
    };
    browser.storage.local.onChanged.addListener(onChanged);
    window.addEventListener(SPEECH_PREFERENCES_EVENT, onLocal);
    window.addEventListener(PANEL_HIDDEN_EVENT, stop);
    return () => {
      alive = false; cancel();
      synth?.removeEventListener('voiceschanged', updateVoices);
      browser.storage.local.onChanged.removeListener(onChanged);
      window.removeEventListener(SPEECH_PREFERENCES_EVENT, onLocal);
      window.removeEventListener(PANEL_HIDDEN_EVENT, stop);
    };
  }, []);

  useEffect(() => { setError(''); setSourceLabel(''); setStage('idle'); return cancel; }, [text]);

  function change(patch: Partial<SpeechPreferences>) {
    const next = normalizeSpeechPreferences({ ...preferences, ...patch });
    prefVersion.current++;
    stop(); setError(''); setSourceLabel(''); preferencesRef.current = next; setPreferences(next);
    window.dispatchEvent(new CustomEvent(SPEECH_PREFERENCES_EVENT, { detail: next }));
    // 单独存储朗读偏好，不读取或修改 aiSettings。
    void browser.storage.local.set({ [SPEECH_SETTINGS_KEY]: next })
      .then(() => setStorageError('')).catch(() => setStorageError('偏好保存失败，本次选择仍可使用'));
  }

  const rankedVoices = englishVoices(voices, preferences.accent);
  const voice = selectVoice(voices, preferences);
  const dictionaryAudio = preferences.accent === 'en-GB' ? audioUkUrl : audioUsUrl;
  const dictionaryAvailable = !!(audioUkUrl || audioUsUrl);
  const usingDictionary = preferences.source === 'dictionary' && !!dictionaryAudio;

  function speak(version: number, fallback = false) {
    if (version !== token.current) return;
    if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined' || !voice) {
      setError('没有可用的英文音色，请在系统语音设置中安装英文语音后重试'); setStage('idle'); return;
    }
    setSourceLabel(`${fallback ? '词典录音不可用，已改用' : ''}${voice.localService ? '设备' : '在线'}合成语音 · ${voice.name} (${voice.lang})`);
    const chunks = speechChunks(text);
    let index = 0;
    const next = () => {
      if (version !== token.current) return;
      const chunk = chunks[index++];
      if (!chunk) { utterance.current = null; setStage('idle'); return; }
      const item = new SpeechSynthesisUtterance(chunk);
      item.voice = voice; item.lang = voice.lang; item.rate = preferences.rate; item.pitch = 1; item.volume = 1;
      utterance.current = item; // 保持引用，避免部分引擎提前回收。
      item.onstart = () => { if (version === token.current) { clearTimeout(watchdog.current); setStage('playing'); } };
      item.onend = () => { clearTimeout(watchdog.current); if (version === token.current) next(); };
      item.onerror = () => {
        if (version !== token.current) return;
        cancel(); setStage('idle'); setError('当前音色无法朗读，请换一个英文音色重试');
      };
      clearTimeout(watchdog.current);
      watchdog.current = setTimeout(() => {
        if (version === token.current) { cancel(); setStage('idle'); setError('语音未能启动，请更换音色重试'); }
      }, 10000);
      try { speechSynthesis.speak(item); }
      catch { cancel(); setStage('idle'); setError('语音启动失败，请更换音色重试'); }
    };
    speechSynthesis.cancel();
    next();
  }

  function play() {
    cancel(); const version = token.current;
    setError(''); setSourceLabel(''); setStage('loading');
    if (!usingDictionary) { speak(version, preferences.source === 'dictionary' && dictionaryAvailable); return; }
    const player = new Audio(dictionaryAudio);
    audio.current = player;
    player.playbackRate = preferences.rate;
    player.preservesPitch = true;
    setSourceLabel(`词典录音 · ${preferences.accent === 'en-GB' ? '英音' : '美音'}`);
    const fallback = () => {
      if (version !== token.current || audio.current !== player) return;
      player.pause(); player.onerror = null; player.onended = null; audio.current = null;
      clearTimeout(watchdog.current);
      speak(version, true);
    };
    player.onerror = fallback;
    player.onended = () => { if (version === token.current) { clearTimeout(watchdog.current); audio.current = null; setStage('idle'); } };
    watchdog.current = setTimeout(fallback, 10000);
    void player.play().then(() => {
      if (version === token.current && audio.current === player) { clearTimeout(watchdog.current); setStage('playing'); }
    }).catch(fallback);
  }
  const active = stage !== 'idle';
  return (
    <div className="mt-3 space-y-2 rounded-md bg-slate-50 p-2.5" aria-label="英文朗读">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">英文朗读</span>
        <button type="button" onClick={active ? stop : play} disabled={!text.trim() || (!usingDictionary && !voice)}
          aria-label={active ? '停止朗读' : '播放英文朗读'}
          className="rounded bg-blue-50 px-3 py-1.5 text-xs text-blue-700 disabled:opacity-40">
          {active ? '停止朗读' : '▶ 朗读英文'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label htmlFor={`${id}-accent`}>口音</label>
        <select id={`${id}-accent`} value={preferences.accent} onChange={(event) => change({ accent: event.target.value as SpeechPreferences['accent'], voiceURI: '' })}
          className="rounded border border-slate-200 bg-white p-1">
          <option value="en-US">美音</option><option value="en-GB">英音</option>
        </select>
        <label htmlFor={`${id}-rate`}>语速</label>
        <select id={`${id}-rate`} value={preferences.rate} onChange={(event) => change({ rate: Number(event.target.value) })}
          className="rounded border border-slate-200 bg-white p-1">
          {SPEECH_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </div>
      {dictionaryAvailable && <div className="flex items-center gap-2 text-xs">
        <label htmlFor={`${id}-source`}>来源</label>
        <select id={`${id}-source`} value={preferences.source} onChange={(event) => change({ source: event.target.value as SpeechPreferences['source'] })}
          className="min-w-0 flex-1 rounded border border-slate-200 bg-white p-1">
          <option value="system">可选英文音色</option><option value="dictionary">词典录音优先</option>
        </select>
      </div>}
      <div className="flex items-center gap-2 text-xs">
        <label htmlFor={`${id}-voice`}>音色</label>
        <select id={`${id}-voice`} value={voice?.voiceURI ?? ''} disabled={usingDictionary || !rankedVoices.length}
          onChange={(event) => change({ voiceURI: event.target.value })}
          className="min-w-0 flex-1 rounded border border-slate-200 bg-white p-1 disabled:opacity-50">
          {!rankedVoices.length && <option value="">暂无英文音色</option>}
          {rankedVoices.map((item) => <option key={`${item.voiceURI}-${item.lang}`} value={item.voiceURI}>{item.name} · {item.lang}{item.localService ? ' · 设备' : ' · 在线'}</option>)}
        </select>
      </div>
      {!voice && !usingDictionary && <p className="text-[11px] text-amber-700">正在等待英文音色；若始终没有，请在系统语音设置中安装英文语音。</p>}
      {voice && voice.lang.replaceAll('_', '-').toLowerCase() !== preferences.accent.toLowerCase() && !usingDictionary &&
        <p className="text-[11px] text-amber-700">所选音色实际口音为 {voice.lang}；可切换为相应英文音色。</p>}
      {sourceLabel && <p role="status" className="text-[11px] text-slate-500">{sourceLabel}</p>}
      {!usingDictionary && <p className="text-[11px] leading-relaxed text-slate-500">可更换音色后试听；标注“在线”的音色可能将朗读文本交给浏览器语音服务处理。</p>}
      {storageError && <p className="text-[11px] text-amber-700">{storageError}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
