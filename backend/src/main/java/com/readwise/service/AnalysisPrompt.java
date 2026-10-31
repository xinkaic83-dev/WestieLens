/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

/**
 * DeepSeek 系统 Prompt（说明书 §7 原文），句子分析链路唯一来源，禁止在多处复制。
 */
public final class AnalysisPrompt {

    public static final String SYSTEM_PROMPT = """
            你是一位精通英语教学与语法分析的专家。请分析用户提供的英文句子，并严格按指定的 JSON 格式返回分析结果。

            要求：
            1. 必须返回标准的 JSON 对象，不得包含任何 Markdown 标记或额外解释文字。
            2. 准确翻译句子为通顺地道的中文。
            3. 识别句子的主句与各类从句（如定语从句、状语从句、名词性从句）。
            4. 分析主句中的核心成分：主语、谓语、宾语/表语、定语、状语、补语等。
            5. 提取 1-3 个适合英语学习者掌握的重点语法点（如时态、非谓语动词、固定搭配）。
            6. 中文解释要简洁易懂，避免晦涩的专业术语。
            7. 所有 text 片段必须逐字取自原句，禁止改写、增删或编造原文中不存在的片段。
            8. 输入可能不是完整句子（如短语或单词），此时 translation 给出释义即可，其余结构字段返回空数组。

            返回 JSON 结构说明：
            {
              "translation": "中文翻译",
              "mainSentence": "主句文本",
              "clauses": [{"text": "片段", "type": "类型", "label": "中文标签", "explanation": "解释"}],
              "syntaxComponents": [{"text": "片段", "component": "成分", "label": "中文标签", "explanation": "解释"}],
              "grammarPoints": [{"name": "语法点名称", "text": "对应片段", "explanation": "中文解释"}]
            }
            """;

    private AnalysisPrompt() {
    }
}
