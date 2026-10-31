/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.dto.AnalyzeResponseDTO;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DeepSeek 输出解析器单测（§8.2：含非法 JSON / 字段缺失 / 片段编造三类坏例）。
 */
class DeepSeekOutputParserTest {

    private static final String ORIGINAL = "Although it was raining, we decided to go out.";

    private final ObjectMapper mapper = JsonMapper.builder().build();
    private final DeepSeekOutputParser parser = new DeepSeekOutputParser(mapper);

    private static final String VALID_OUTPUT = """
            {
              "translation": "虽然当时正在下雨，我们还是决定出门。",
              "mainSentence": "we decided to go out",
              "clauses": [
                {"text": "Although it was raining", "type": "adverbial_clause", "label": "让步状语从句", "explanation": "由 Although 引导。"}
              ],
              "syntaxComponents": [
                {"text": "we", "component": "subject", "label": "主语", "explanation": "行为的发出者。"},
                {"text": "decided", "component": "predicate", "label": "谓语", "explanation": "过去时态动词。"}
              ],
              "grammarPoints": [
                {"name": "过去进行时", "text": "was raining", "explanation": "表示过去某个时刻正在发生的动作。"}
              ]
            }
            """;

    @Test
    void validOutputShouldParseToComplete() {
        var outcome = parser.parse(ORIGINAL, VALID_OUTPUT);

        assertThat(outcome.outcome()).isEqualTo(DeepSeekOutputParser.Outcome.COMPLETE);
        AnalyzeResponseDTO dto = outcome.response();
        assertThat(dto.isPartial()).isFalse();
        assertThat(dto.isCached()).isFalse();
        assertThat(dto.getText()).isEqualTo(ORIGINAL);
        assertThat(dto.getTranslation()).contains("虽然");
        assertThat(dto.getClauses()).hasSize(1);
        assertThat(dto.getSyntaxComponents()).hasSize(2);
        assertThat(dto.getGrammarPoints()).hasSize(1);
    }

    @Test
    void emptyStructureArraysShouldStillBeComplete() {
        // Prompt 第 8 条：短语输入时结构字段返回空数组，属于合法输出
        String output = """
                {"translation": "发展", "mainSentence": "", "clauses": [], "syntaxComponents": [], "grammarPoints": []}
                """;
        var outcome = parser.parse("development", output);

        assertThat(outcome.outcome()).isEqualTo(DeepSeekOutputParser.Outcome.COMPLETE);
        assertThat(outcome.response().getClauses()).isEmpty();
    }

    // ---------- 坏例 1：非法 JSON ----------

    @Test
    void malformedJsonShouldBeUnparseable() {
        assertThat(parser.parse(ORIGINAL, "{ not json !!").outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.UNPARSEABLE);
    }

    @Test
    void markdownFencedJsonShouldBeUnparseable() {
        // JSON Mode 不保证不带 Markdown 围栏，必须拒绝
        String output = "```json\n" + VALID_OUTPUT + "\n```";
        assertThat(parser.parse(ORIGINAL, output).outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.UNPARSEABLE);
    }

    @Test
    void jsonArrayInsteadOfObjectShouldBeUnparseable() {
        assertThat(parser.parse(ORIGINAL, "[]").outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.UNPARSEABLE);
    }

    // ---------- 坏例 2：字段缺失 / 类型错误 ----------

    @Test
    void missingTranslationShouldBeMissingTranslation() {
        String output = """
                {"mainSentence": "we decided to go out", "clauses": [], "syntaxComponents": [], "grammarPoints": []}
                """;
        assertThat(parser.parse(ORIGINAL, output).outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.MISSING_TRANSLATION);
    }

    @Test
    void blankTranslationShouldBeMissingTranslation() {
        String output = """
                {"translation": "   ", "mainSentence": "we decided to go out", "clauses": [], "syntaxComponents": [], "grammarPoints": []}
                """;
        assertThat(parser.parse(ORIGINAL, output).outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.MISSING_TRANSLATION);
    }

    @Test
    void wrongFieldTypeShouldBeStructureInvalidButKeepTranslation() {
        // clauses 条目里 text 是数字而非字符串 → 结构非法但翻译有效
        String output = """
                {
                  "translation": "虽然下雨还是出门了。",
                  "mainSentence": "we decided to go out",
                  "clauses": [{"text": 123, "type": "x", "label": "y", "explanation": "z"}],
                  "syntaxComponents": [],
                  "grammarPoints": []
                }
                """;
        var outcome = parser.parse(ORIGINAL, output);

        assertThat(outcome.outcome()).isEqualTo(DeepSeekOutputParser.Outcome.STRUCTURE_INVALID);
        assertThat(outcome.response().isPartial()).isTrue();
        assertThat(outcome.response().getTranslation()).isEqualTo("虽然下雨还是出门了。");
        assertThat(outcome.response().getClauses()).isEmpty();
        assertThat(outcome.response().getSyntaxComponents()).isEmpty();
        assertThat(outcome.response().getGrammarPoints()).isEmpty();
    }

    // ---------- 坏例 3：片段编造（text 不在原句中） ----------

    @Test
    void fabricatedClauseTextShouldBeStructureInvalid() {
        String output = """
                {
                  "translation": "翻译有效。",
                  "mainSentence": "we decided to go out",
                  "clauses": [{"text": "Although it is raining", "type": "adverbial_clause", "label": "从句", "explanation": "编造了时态。"}],
                  "syntaxComponents": [],
                  "grammarPoints": []
                }
                """;
        assertThat(parser.parse(ORIGINAL, output).outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.STRUCTURE_INVALID);
    }

    @Test
    void fabricatedGrammarPointTextShouldBeStructureInvalid() {
        String output = """
                {
                  "translation": "翻译有效。",
                  "mainSentence": "we decided to go out",
                  "clauses": [],
                  "syntaxComponents": [],
                  "grammarPoints": [{"name": "虚构搭配", "text": "decided going out", "explanation": "原文中不存在该片段。"}]
                }
                """;
        assertThat(parser.parse(ORIGINAL, output).outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.STRUCTURE_INVALID);
    }

    // ---------- mainSentence 是主干重构，不参与逐字校验（§4.3-2 只校验片段字段） ----------

    @Test
    void reconstructedMainSentenceShouldStillBeComplete() {
        // 回归用例：长难句的主干被从句切开，模型只能给出重构后的主干。
        // 曾经的实现要求 mainSentence 逐字命中，导致这类句子一律降级为 partial。
        String original = "The book that you lent me last week, which I finally finished on the train, "
                + "is far more interesting than I expected.";
        String output = """
                {
                  "translation": "你上周借我的那本书比我预想的有趣得多。",
                  "mainSentence": "The book is far more interesting than I expected.",
                  "clauses": [
                    {"text": "that you lent me last week", "type": "relative_clause", "label": "定语从句", "explanation": "修饰 book。"}
                  ],
                  "syntaxComponents": [],
                  "grammarPoints": []
                }
                """;
        var outcome = parser.parse(original, output);

        assertThat(outcome.outcome()).isEqualTo(DeepSeekOutputParser.Outcome.COMPLETE);
        assertThat(outcome.response().isPartial()).isFalse();
        assertThat(outcome.response().getMainSentence())
                .isEqualTo("The book is far more interesting than I expected.");
        assertThat(outcome.response().getClauses()).hasSize(1);
    }

    @Test
    void missingMainSentenceShouldStillBeComplete() {
        // 短语输入时模型常省略 mainSentence，不应因此丢掉整个结构
        String output = """
                {"translation": "发展", "clauses": [], "syntaxComponents": [], "grammarPoints": []}
                """;
        assertThat(parser.parse("development", output).outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.COMPLETE);
    }

    @Test
    void oversizedArrayShouldBeStructureInvalid() {
        StringBuilder items = new StringBuilder();
        for (int i = 0; i < 25; i++) {
            items.append("{\"text\": \"we\", \"component\": \"subject\", \"label\": \"主语\", \"explanation\": \"x\"},");
        }
        String output = """
                {
                  "translation": "翻译有效。",
                  "mainSentence": "we decided to go out",
                  "clauses": [],
                  "syntaxComponents": [%s],
                  "grammarPoints": []
                }
                """.formatted(items.substring(0, items.length() - 1));
        assertThat(parser.parse(ORIGINAL, output).outcome())
                .isEqualTo(DeepSeekOutputParser.Outcome.STRUCTURE_INVALID);
    }
}
