/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.dto.AnalyzeResponseDTO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * DeepSeek 输出解析与校验（说明书 §4.3 输出校验与降级）：
 * 1. 严格解析 JSON，校验字段类型、长度和允许值；
 * 2. 校验 clauses / syntaxComponents / grammarPoints 的 text 片段是否逐字出现在原句中
 *    —— 基本一致性检查，不等于证明语法结论正确；
 *    mainSentence 是主干重构，不参与逐字校验（长难句的主干天然被从句切开）；
 * 3. 结果分类供 Service 决定重试或降级：
 *    UNPARSEABLE / MISSING_TRANSLATION → 翻译都拿不到（重试一次后 5001）；
 *    STRUCTURE_INVALID → 翻译成功但结构不可用（重试一次后降级 partial=true）；
 *    COMPLETE → 全部通过。
 */
@Slf4j
@Component
public class DeepSeekOutputParser {

    private static final int MAX_ARRAY_ITEMS = 20;
    private static final int MAX_GRAMMAR_ITEMS = 10;
    private static final int MAX_FRAGMENT_LENGTH = 500;
    private static final int MAX_TRANSLATION_LENGTH = 1000;
    private static final int MAX_LABEL_LENGTH = 100;
    private static final int MAX_EXPLANATION_LENGTH = 1000;

    public enum Outcome {
        /** 全部字段合法 */
        COMPLETE,
        /** 翻译合法但结构字段校验失败（可降级 partial） */
        STRUCTURE_INVALID,
        /** translation 缺失或不合法（翻译失败） */
        MISSING_TRANSLATION,
        /** JSON 不可解析或非对象 */
        UNPARSEABLE
    }

    public record ParseOutcome(Outcome outcome, AnalyzeResponseDTO response) {
    }

    private final ObjectMapper objectMapper;

    @Autowired
    public DeepSeekOutputParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 解析模型输出为响应 DTO。
     *
     * @param originalText 用户选中的原文（trim 后），用于片段一致性检查
     * @param modelOutput  模型返回的 JSON 字符串
     */
    public ParseOutcome parse(String originalText, String modelOutput) {
        JsonNode root;
        try {
            root = objectMapper.readTree(modelOutput == null ? "" : modelOutput);
        } catch (Exception e) {
            log.debug("模型输出不是合法 JSON");
            return new ParseOutcome(Outcome.UNPARSEABLE, null);
        }
        if (!root.isObject()) {
            return new ParseOutcome(Outcome.UNPARSEABLE, null);
        }

        // translation 是底线：拿不到翻译则整体失败（§4.3-5）
        String translation = optionalText(root, "translation");
        if (translation == null || translation.isBlank() || translation.length() > MAX_TRANSLATION_LENGTH) {
            return new ParseOutcome(Outcome.MISSING_TRANSLATION, null);
        }

        AnalyzeResponseDTO response = AnalyzeResponseDTO.builder()
                .text(originalText)
                .translation(translation)
                .cached(false)
                .build();

        boolean structureValid = true;

        // mainSentence 是"主干重构"，天然不可能逐字出现在带插入语的长句里。
        // 实测长难句下模型返回的是 The book is far more interesting than I had expected.，
        // 原句则是被两个定语从句切开的结构——若按逐字命中判定，最有价值的长难句会全部降级。
        // §4.3-2 的逐字校验只针对 clauses / syntaxComponents / grammarPoints 的 text 片段，
        // 因此这里只做长度与类型校验；缺失也不视为结构非法（短语输入时模型通常省略该字段）。
        String mainSentence = optionalText(root, "mainSentence");
        if (mainSentence != null && !mainSentence.isBlank() && mainSentence.length() <= MAX_FRAGMENT_LENGTH) {
            response.setMainSentence(mainSentence.trim());
        }

        List<AnalyzeResponseDTO.Clause> clauses = parseClauses(root, originalText);
        List<AnalyzeResponseDTO.SyntaxComponent> syntax = parseSyntaxComponents(root, originalText);
        List<AnalyzeResponseDTO.GrammarPoint> grammar = parseGrammarPoints(root, originalText);
        if (clauses == null || syntax == null || grammar == null) {
            structureValid = false;
            clauses = clauses == null ? List.of() : clauses;
            syntax = syntax == null ? List.of() : syntax;
            grammar = grammar == null ? List.of() : grammar;
        }

        response.setClauses(clauses);
        response.setSyntaxComponents(syntax);
        response.setGrammarPoints(grammar);

        if (structureValid) {
            response.setPartial(false);
            return new ParseOutcome(Outcome.COMPLETE, response);
        }
        // 翻译成功、结构降级：结构字段置空数组（§4.3-4），partial 由 Service 决定是否立即生效
        response.setMainSentence(null);
        response.setClauses(List.of());
        response.setSyntaxComponents(List.of());
        response.setGrammarPoints(List.of());
        response.setPartial(true);
        return new ParseOutcome(Outcome.STRUCTURE_INVALID, response);
    }

    private List<AnalyzeResponseDTO.Clause> parseClauses(JsonNode root, String originalText) {
        JsonNode array = root.get("clauses");
        if (array == null || array.isNull()) {
            return List.of();
        }
        if (!array.isArray() || array.size() > MAX_ARRAY_ITEMS) {
            return null;
        }
        List<AnalyzeResponseDTO.Clause> result = new ArrayList<>();
        for (JsonNode item : array) {
            String text = requireValidFragment(item, originalText);
            String type = requireBoundedText(item, "type", MAX_LABEL_LENGTH);
            String label = requireBoundedText(item, "label", MAX_LABEL_LENGTH);
            String explanation = requireBoundedText(item, "explanation", MAX_EXPLANATION_LENGTH);
            if (text == null || type == null || label == null || explanation == null) {
                return null;
            }
            result.add(new AnalyzeResponseDTO.Clause(text, type, label, explanation));
        }
        return result;
    }

    private List<AnalyzeResponseDTO.SyntaxComponent> parseSyntaxComponents(JsonNode root, String originalText) {
        JsonNode array = root.get("syntaxComponents");
        if (array == null || array.isNull()) {
            return List.of();
        }
        if (!array.isArray() || array.size() > MAX_ARRAY_ITEMS) {
            return null;
        }
        List<AnalyzeResponseDTO.SyntaxComponent> result = new ArrayList<>();
        for (JsonNode item : array) {
            String text = requireValidFragment(item, originalText);
            String component = requireBoundedText(item, "component", MAX_LABEL_LENGTH);
            String label = requireBoundedText(item, "label", MAX_LABEL_LENGTH);
            String explanation = requireBoundedText(item, "explanation", MAX_EXPLANATION_LENGTH);
            if (text == null || component == null || label == null || explanation == null) {
                return null;
            }
            result.add(new AnalyzeResponseDTO.SyntaxComponent(text, component, label, explanation));
        }
        return result;
    }

    private List<AnalyzeResponseDTO.GrammarPoint> parseGrammarPoints(JsonNode root, String originalText) {
        JsonNode array = root.get("grammarPoints");
        if (array == null || array.isNull()) {
            return List.of();
        }
        if (!array.isArray() || array.size() > MAX_GRAMMAR_ITEMS) {
            return null;
        }
        List<AnalyzeResponseDTO.GrammarPoint> result = new ArrayList<>();
        for (JsonNode item : array) {
            String name = requireBoundedText(item, "name", MAX_LABEL_LENGTH);
            String text = requireValidFragment(item, originalText);
            String explanation = requireBoundedText(item, "explanation", MAX_EXPLANATION_LENGTH);
            if (name == null || text == null || explanation == null) {
                return null;
            }
            result.add(new AnalyzeResponseDTO.GrammarPoint(name, text, explanation));
        }
        return result;
    }

    /** item.text：非空字符串、长度受限，且必须逐字出现在原句中（§4.3-2 基本一致性检查） */
    private String requireValidFragment(JsonNode item, String originalText) {
        String text = optionalText(item, "text");
        if (text == null || text.isEmpty() || text.length() > MAX_FRAGMENT_LENGTH
                || !originalText.contains(text)) {
            return null;
        }
        return text;
    }

    /** 必填字符串字段且长度受限，非法返回 null */
    private String requireBoundedText(JsonNode item, String field, int maxLength) {
        String value = optionalText(item, field);
        if (value == null || value.isEmpty() || value.length() > maxLength) {
            return null;
        }
        return value;
    }

    /** 可选字符串字段：非字符串/缺失返回 null */
    private String optionalText(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isString()) {
            return null;
        }
        return value.asString();
    }
}
