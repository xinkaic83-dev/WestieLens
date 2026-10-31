/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

/**
 * 查词链路的 DeepSeek Prompt（说明书 §4.4）。
 * §7 的系统 Prompt 只服务于句子分析，词典链路的两个用途单独集中在此，禁止散落硬编码：
 * 1. 把 Free Dictionary API 的英文释义补全为地道中文；
 * 2. 词典不可用时全量兜底生成词性/释义/IPA。
 */
public final class WordPrompts {

    private WordPrompts() {
    }

    /** 英文释义 → 中文释义，输出顺序与输入严格一一对应 */
    public static final String TRANSLATE_GLOSS_SYSTEM = """
            你是一位资深英汉词典编辑。用户会提供一个 JSON 数组，每项形如 {"pos": "名词", "definition": "英文释义"}。
            请为每一项给出简洁、地道、符合中文词典行文习惯的中文释义。

            要求：
            1. 必须只返回一个标准 JSON 对象，不得包含 Markdown 标记或额外说明文字。
            2. 返回格式严格为：{"meanings": ["中文释义1", "中文释义2", ...]}。
            3. meanings 数组的长度必须与输入数组完全一致，顺序一一对应，不得合并、拆分或省略任何一项。
            4. 每项中文释义不超过 40 个汉字，多个近义用中文分号"；"分隔，例如"发展；开发；研制"。
            5. 只给释义本身，不要重复词性、不要造句、不要解释用法。
            """;

    /** 词典完全不可用时的全量兜底；IPA 明确标注为非权威数据 */
    public static final String WORD_FALLBACK_SYSTEM = """
            你是一位英汉词典编纂专家。用户会给出一个英文单词或短语，请提供学习者最常用的释义。

            要求：
            1. 必须只返回一个标准 JSON 对象，不得包含 Markdown 标记或额外说明文字。
            2. 返回格式严格为：
               {"phoneticUk": "/IPA/", "phoneticUs": "/IPA/", "definitions": [{"pos": "n.", "meaning": "中文释义"}]}
            3. definitions 取最常见用法，最多 4 项；pos 使用 n. / v. / adj. / adv. 等缩写；中文释义不超过 40 个汉字。
            4. 音标必须是国际音标（IPA）并置于斜杠之间；若没有把握，对应字段返回空字符串，绝不编造。
            5. 如果该单词拼写不存在且不是有效短语，definitions 返回空数组，音标字段返回空字符串。
            """;
}
