/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

/**
 * 词句路由规则（说明书 §4.1.3）：
 * <ul>
 *   <li>单个英文单词（含连字符/撇号，如 ice-cream、don't）默认查词；</li>
 *   <li>多词但不含句末标点（. ? ! ; :）的纯词短语（如 the development of software systems）
 *       不可能存在句子结构，默认查词/短语；</li>
 *   <li>其余多词选区默认进入句子/短语分析（如 How are you? 虽只有 3 词但是完整句子）。</li>
 * </ul>
 * 纯函数、无状态，便于单测；用户手动选择（inputType=word/analysis）优先于自动路由。
 */
public final class TextRouting {

    public static final String ROUTE_WORD = "word";
    public static final String ROUTE_ANALYSIS = "analysis";

    /** 单词：纯字母，允许内部连字符/撇号，首尾必须是字母 */
    private static final String SINGLE_WORD = "[A-Za-z]+(['-][A-Za-z]+)*";

    /** 纯词短语：仅由字母单词与空格组成，无任何标点/数字 */
    private static final String WORD_ONLY_PHRASE = "[A-Za-z]+([-' ][A-Za-z]+)*";

    /** 句末/结构标点：出现任一则视为句子，进入结构分析 */
    private static final String SENTENCE_PUNCTUATION = "[.?!;:]";

    private TextRouting() {
    }

    /**
     * 根据 trim 后的文本自动路由。
     *
     * @param trimmedText 已 trim 的非空文本
     * @return "word" 或 "analysis"
     */
    public static String routeByWords(String trimmedText) {
        if (trimmedText.matches(SINGLE_WORD) || trimmedText.matches(WORD_ONLY_PHRASE)) {
            return ROUTE_WORD;
        }
        return trimmedText.contains(" ") && !trimmedText.matches(".*" + SENTENCE_PUNCTUATION + ".*")
                ? ROUTE_WORD
                : ROUTE_ANALYSIS;
    }
}
