/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.exception;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 统一错误码表，与开发说明书 §4.7 一一对应。
 * 所有接口错误响应使用 { code, message, retryable } 结构。
 */
@Getter
@RequiredArgsConstructor
public enum ErrorCode {

    /** 文本超过 500 字符 */
    TEXT_TOO_LONG(4001, "选中文本过长，请缩短后重试", false),
    /** 选区不含英文内容 */
    NO_ENGLISH_CONTENT(4002, "请选中英文文本", false),
    /** 参数校验失败（含 inputType / features 白名单不通过） */
    INVALID_PARAMS(4003, "请求参数有误", false),
    /** 大模型响应不可用且翻译失败 */
    TRANSLATION_UNAVAILABLE(5001, "AI 暂时无法完成翻译，请重试", true),
    /** 词典未命中且 AI 兜底也无法提供有效结果 */
    WORD_NOT_FOUND(5002, "未查到可靠词条，请尝试其他词形", false),
    /** 后端无法连接大模型服务 */
    MODEL_NETWORK_ERROR(5003, "网络异常，请检查网络后重试", true),
    /** 后端内部异常 */
    INTERNAL_ERROR(5004, "服务异常，请重试", true),
    /**
     * 请求频率超限（§4.6.1 / R6 的落地实现）。
     * 说明书 §4.7 错误码表未覆盖限流场景，此处为新增码，前端按统一结构解析即可。
     */
    RATE_LIMITED(4290, "请求过于频繁，请稍后再试", true);

    private final int code;
    private final String message;
    private final boolean retryable;
}
