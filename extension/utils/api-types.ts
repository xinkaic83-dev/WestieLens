/**
 * 插件分析/词典 DTO，沿用原后端契约，直连服务与面板共用。
 * 契约来源：当前开发说明书与 utils/messages.ts。
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */

// ---------- 请求（对应 AnalyzeRequestDTO.java） ----------

export type InputType = 'word' | 'analysis' | 'auto';
export type Feature = 'translation' | 'clauses' | 'syntax' | 'grammar';

export interface AnalyzeRequest {
  text: string;
  /** 缺省时按 auto 处理；前端按钮切换时显式传 word / analysis（用户选择优先，§4.1.3） */
  inputType?: InputType;
  features?: Feature[];
}

// ---------- 句子分析响应（对应 AnalyzeResponseDTO.java） ----------

export interface ClauseDTO {
  text: string;
  type: string;
  label: string;
  explanation: string;
}

export interface SyntaxComponentDTO {
  text: string;
  component: string;
  label: string;
  explanation: string;
}

export interface GrammarPointDTO {
  name: string;
  text: string;
  explanation: string;
}

export interface AnalyzeResponse {
  text: string;
  translation: string;
  mainSentence: string;
  clauses: ClauseDTO[];
  syntaxComponents: SyntaxComponentDTO[];
  grammarPoints: GrammarPointDTO[];
  /** 翻译成功但结构分析不可用（HTTP 200，结构字段为空数组）*/
  partial: boolean;
  cached: boolean;
}

// ---------- 单词查询响应（对应 WordDetailDTO.java） ----------

export interface DefinitionDTO {
  pos: string;
  meaning: string;
}

export interface WordDetail {
  word: string;
  phoneticUk: string;
  phoneticUs: string;
  audioUkUrl: string;
  audioUsUrl: string;
  definitions: DefinitionDTO[];
  /** dictionary | ai_fallback */
  source: string;
  /** dictionary | ai_generated | unavailable */
  phoneticSource: string;
  fallbackTts: boolean;
  definitionLanguage?: 'zh' | 'en';
  cached: boolean;
}

// ---------- 统一错误体（对应 ErrorResponseDTO.java，§4.7） ----------

/** 4001-5004 见说明书 §4.7；4290 为后端限流新增码（§4.6.1 落地实现） */
export type ApiErrorCode = 4001 | 4002 | 4003 | 4290 | 5001 | 5002 | 5003 | 5004;

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * 分析服务按路由返回联合类型：路由到查词时返回 WordDetail，否则返回 AnalyzeResponse。
 * 用 "definitions" in data 判别。
 */
export type AnalyzeResult = AnalyzeResponse | WordDetail;

/** 响应在消息/网络边界做校验，避免不完整 JSON 导致面板渲染崩溃。 */
export function isAnalyzeResult(value: unknown): value is AnalyzeResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const stringFields = (obj: Record<string, unknown>, fields: string[]) =>
    fields.every((field) => typeof obj[field] === 'string');
  const items = (value: unknown, fields: string[]) => Array.isArray(value) && value.every((item) =>
    typeof item === 'object' && item !== null && stringFields(item, fields));
  if (typeof v.cached !== 'boolean') return false;
  if ('definitions' in v) {
    return stringFields(v, ['word', 'phoneticUk', 'phoneticUs', 'audioUkUrl', 'audioUsUrl'])
      && ['dictionary', 'ai_fallback'].includes(v.source as string)
      && ['dictionary', 'ai_generated', 'unavailable'].includes(v.phoneticSource as string)
      && typeof v.fallbackTts === 'boolean'
      && items(v.definitions, ['pos', 'meaning']) && (v.definitions as unknown[]).length > 0;
  }
  return stringFields(v, ['text', 'translation', 'mainSentence']) && typeof v.partial === 'boolean'
    && items(v.clauses, ['text', 'type', 'label', 'explanation'])
    && items(v.syntaxComponents, ['text', 'component', 'label', 'explanation'])
    && items(v.grammarPoints, ['name', 'text', 'explanation']);
}
