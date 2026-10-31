/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.client.DictionaryEntry;
import com.readwise.dto.WordDetailDTO;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * WordDetailDTO 统一转换器（说明书 §4.4：掩盖底层词典数据差异）。
 * 音标的权威性严格按来源标记（§4.4 / R7）：词典提供 → dictionary，AI 生成 → ai_generated，
 * 两者都没有 → unavailable 且音标字段留空。
 */
@Component
public class WordDetailAssembler {

    private static final int MAX_MEANING_LENGTH = 200;

    /** 词典词性全称 → 常用缩写；未收录的按原文展示，不做猜测 */
    private static final Map<String, String> POS_ABBREVIATIONS = Map.ofEntries(
            Map.entry("noun", "n."),
            Map.entry("verb", "v."),
            Map.entry("adjective", "adj."),
            Map.entry("adverb", "adv."),
            Map.entry("pronoun", "pron."),
            Map.entry("conjunction", "conj."),
            Map.entry("preposition", "prep."),
            Map.entry("determiner", "det."),
            Map.entry("interjection", "int."),
            Map.entry("exclamation", "int."),
            Map.entry("suffix", "suffix"),
            Map.entry("prefix", "prefix"));

    /**
     * 词典命中：IPA/音频取词典，中文释义取 DeepSeek 补全结果。
     *
     * @param chineseMeanings 与 entry.glosses 一一对应的中文释义；为 null 或长度不匹配时
     *                        退化为保留词典英文原文（翻译失败不应让整个查词不可用）
     */
    public WordDetailDTO fromDictionary(DictionaryEntry entry, String displayWord, List<String> chineseMeanings) {
        List<DictionaryEntry.Gloss> glosses = entry.glosses();
        boolean translationUsable = chineseMeanings != null && chineseMeanings.size() == glosses.size();

        List<WordDetailDTO.Definition> definitions = new ArrayList<>();
        for (int i = 0; i < glosses.size(); i++) {
            DictionaryEntry.Gloss gloss = glosses.get(i);
            String meaning = translationUsable ? chineseMeanings.get(i) : gloss.englishDefinition();
            if (meaning == null || meaning.isBlank()) {
                meaning = gloss.englishDefinition();
            }
            definitions.add(WordDetailDTO.Definition.builder()
                    .pos(abbreviatePos(gloss.pos()))
                    .meaning(bounded(meaning))
                    .build());
        }

        boolean hasPhonetic = entry.hasPhonetic();
        boolean hasAudio = entry.hasAudio();
        return WordDetailDTO.builder()
                .word(displayWord)
                .phoneticUk(orEmpty(entry.phoneticUk()))
                .phoneticUs(orEmpty(entry.phoneticUs()))
                .audioUkUrl(orEmpty(entry.audioUkUrl()))
                .audioUsUrl(orEmpty(entry.audioUsUrl()))
                .definitions(definitions)
                .source("dictionary")
                .phoneticSource(hasPhonetic ? "dictionary" : "unavailable")
                // 无音频时才允许前端回退浏览器合成语音（§4.4 发音兜底）
                .fallbackTts(!hasAudio)
                .cached(false)
                .build();
    }

    /** 缓存命中时复制一份并改 cached 标记，避免污染缓存内的对象状态 */
    public WordDetailDTO withCached(WordDetailDTO source, boolean cached) {
        return WordDetailDTO.builder()
                .word(source.getWord())
                .phoneticUk(source.getPhoneticUk())
                .phoneticUs(source.getPhoneticUs())
                .audioUkUrl(source.getAudioUkUrl())
                .audioUsUrl(source.getAudioUsUrl())
                .definitions(source.getDefinitions())
                .source(source.getSource())
                .phoneticSource(source.getPhoneticSource())
                .fallbackTts(source.isFallbackTts())
                .cached(cached)
                .build();
    }

    private String abbreviatePos(String pos) {
        if (pos == null || pos.isBlank()) {
            return "";
        }
        return POS_ABBREVIATIONS.getOrDefault(pos.toLowerCase().trim(), pos.trim());
    }

    private String bounded(String text) {
        String trimmed = text.trim();
        return trimmed.length() > MAX_MEANING_LENGTH ? trimmed.substring(0, MAX_MEANING_LENGTH) + "…" : trimmed;
    }

    private String orEmpty(String value) {
        return value == null ? "" : value;
    }
}
