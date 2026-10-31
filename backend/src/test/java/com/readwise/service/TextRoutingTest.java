/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 词句路由规则单测（说明书 §4.1.3 / v0.1 DoD）。
 */
class TextRoutingTest {

    @Test
    void singleWordShouldRouteToWord() {
        assertThat(TextRouting.routeByWords("development")).isEqualTo(TextRouting.ROUTE_WORD);
        assertThat(TextRouting.routeByWords("a")).isEqualTo(TextRouting.ROUTE_WORD);
        assertThat(TextRouting.routeByWords("Software")).isEqualTo(TextRouting.ROUTE_WORD);
    }

    @Test
    void hyphenatedOrApostropheWordShouldRouteToWord() {
        assertThat(TextRouting.routeByWords("ice-cream")).isEqualTo(TextRouting.ROUTE_WORD);
        assertThat(TextRouting.routeByWords("don't")).isEqualTo(TextRouting.ROUTE_WORD);
    }

    @Test
    void multiWordTextShouldRouteToAnalysis() {
        // 3 个词但是完整句子（含标点）
        assertThat(TextRouting.routeByWords("How are you?")).isEqualTo(TextRouting.ROUTE_ANALYSIS);
        // 含逗号的从句结构
        assertThat(TextRouting.routeByWords("Although it was raining, we decided to go out."))
                .isEqualTo(TextRouting.ROUTE_ANALYSIS);
    }

    @Test
    void phraseWithoutPunctuationShouldRouteToWord() {
        // 无标点多词短语（如 the development of software systems）不参与句子结构分析，默认查词
        assertThat(TextRouting.routeByWords("the development of software systems"))
                .isEqualTo(TextRouting.ROUTE_WORD);
    }

    @Test
    void wordWithTrailingPunctuationShouldRouteToAnalysis() {
        // 单词 + 标点在 MVP 中视为非单纯单词，交由分析链路（Prompt 允许非完整句子）
        assertThat(TextRouting.routeByWords("hello.")).isEqualTo(TextRouting.ROUTE_ANALYSIS);
    }
}
