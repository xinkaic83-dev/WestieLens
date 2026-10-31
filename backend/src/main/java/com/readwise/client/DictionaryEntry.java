/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.client;

import java.util.List;

/**
 * 词典原始数据归一化后的中间结构（说明书 §4.4：后端提供统一转换器，掩盖底层词典数据差异）。
 * 只承载"词典确实给了什么"，不含任何 AI 推断值。
 *
 * @param word        词典回显的词条
 * @param phoneticUk  英式 IPA，词典未提供时为 null
 * @param phoneticUs  美式 IPA，词典未提供时为 null
 * @param audioUkUrl  英式音频 URL，无则 null
 * @param audioUsUrl  美式音频 URL，无则 null
 * @param glosses     词性 + 英文释义（词典原文，中文由 DeepSeek 补全）
 */
public record DictionaryEntry(String word,
                              String phoneticUk,
                              String phoneticUs,
                              String audioUkUrl,
                              String audioUsUrl,
                              List<Gloss> glosses) {

    /** @param pos       词典词性全称，如 noun / verb */
    public record Gloss(String pos, String englishDefinition) {
    }

    public boolean hasPhonetic() {
        return notBlank(phoneticUk) || notBlank(phoneticUs);
    }

    public boolean hasAudio() {
        return notBlank(audioUkUrl) || notBlank(audioUsUrl);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
