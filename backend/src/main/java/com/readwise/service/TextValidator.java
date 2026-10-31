/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.exception.BusinessException;
import com.readwise.exception.ErrorCode;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 请求契约校验（说明书 §6.1 请求校验约定 + §4.7 错误码），长度以服务端为准。
 * 从 v0.1 MockAnalyzeService 抽取，供 AnalyzeService / WordController 共用。
 */
@Component
public class TextValidator {

    public static final int MAX_TEXT_LENGTH = 500;
    private static final Pattern ENGLISH_PATTERN = Pattern.compile("[a-zA-Z]");
    private static final Set<String> ALLOWED_INPUT_TYPES = Set.of("word", "analysis", "auto");
    private static final Set<String> ALLOWED_FEATURES = Set.of("translation", "clauses", "syntax", "grammar");

    /**
     * 通用文本校验：非空（4003）/ ≤500 字符（4001）/ 含英文（4002），返回 trim 后文本。
     */
    public String requireValidText(String rawText) {
        String text = rawText == null ? "" : rawText.trim();
        if (text.isEmpty()) {
            throw new BusinessException(ErrorCode.INVALID_PARAMS);
        }
        if (text.length() > MAX_TEXT_LENGTH) {
            throw new BusinessException(ErrorCode.TEXT_TOO_LONG);
        }
        if (!ENGLISH_PATTERN.matcher(text).find()) {
            throw new BusinessException(ErrorCode.NO_ENGLISH_CONTENT);
        }
        return text;
    }

    /** inputType 白名单：只允许 word / analysis / auto，null 视为 auto（§6.1） */
    public void requireValidInputType(String inputType) {
        if (inputType != null && !ALLOWED_INPUT_TYPES.contains(inputType)) {
            throw new BusinessException(ErrorCode.INVALID_PARAMS);
        }
    }

    /** features 白名单：可为空或部分，拒绝未知值（§6.1） */
    public void requireValidFeatures(List<String> features) {
        if (features != null && !ALLOWED_FEATURES.containsAll(features)) {
            throw new BusinessException(ErrorCode.INVALID_PARAMS);
        }
    }
}
