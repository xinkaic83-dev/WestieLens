/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Free Dictionary API 响应解析与归一化（说明书 §4.4）。
 * 实测该接口的数据形态并不规整，按以下规则保守处理：
 * 1. 响应为数组，取第一个词条对象；空数组/对象结构异常一律视为"未命中"；
 * 2. 英/美区分只能靠音频 URL 的地域后缀（如 read-1-uk.mp3 / read-1-us.ogg），
 *    phonetics[].text 本身不带地域标签；
 * 3. 无地域标签的 IPA（top-level phonetic 或无地域的 phonetics[].text）视为词典给出的中性发音，
 *    用于补齐尚未知的那个区域（§6.2 示例中 UK/US 相同即此情形）；
 *    已标 -us/-uk 的音标只填自己那一边，不跨区伪造；
 * 4. 只承认 uk/gb/us 三种地域标签，其他地域（如 au）的音频直接丢弃，不冒充英美发音；
 * 5. 释义按词性顺序取前 5 条并去重，避免长词条把下游 token 成本打爆。
 * 解析器不抛异常：任何失败都归为 Optional.empty()，由 Service 转 AI 兜底（§11.1）。
 */
@Slf4j
@Component
public class DictionaryEntryParser {

    static final int MAX_GLOSS_ITEMS = 5;

    private final ObjectMapper objectMapper;

    public DictionaryEntryParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Optional<DictionaryEntry> parse(String body) {
        try {
            JsonNode root = objectMapper.readTree(body == null ? "" : body);
            if (!root.isArray() || root.isEmpty()) {
                return Optional.empty();
            }
            return parseEntry(root.get(0));
        } catch (Exception e) {
            log.debug("词典响应解析失败: {}", e.getMessage());
            return Optional.empty();
        }
    }

    private Optional<DictionaryEntry> parseEntry(JsonNode entry) {
        if (!entry.isObject()) {
            return Optional.empty();
        }
        String word = text(entry, "word");
        List<DictionaryEntry.Gloss> glosses = parseGlosses(entry.get("meanings"));
        if (word == null || glosses.isEmpty()) {
            // 没有可用释义的词条对学习者无价值，按未命中处理，交给 AI 兜底
            return Optional.empty();
        }

        PhoneticResult phonetic = parsePhonetics(entry);
        return Optional.of(new DictionaryEntry(word,
                phonetic.ipaUk(), phonetic.ipaUs(), phonetic.audioUk(), phonetic.audioUs(), glosses));
    }

    /** 词性 + 英文释义：跨词性按出现顺序截断到 MAX_GLOSS_ITEMS，并按释义文本去重 */
    private List<DictionaryEntry.Gloss> parseGlosses(JsonNode meanings) {
        if (meanings == null || !meanings.isArray()) {
            return List.of();
        }
        List<DictionaryEntry.Gloss> result = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (JsonNode meaning : meanings) {
            String pos = text(meaning, "partOfSpeech");
            JsonNode definitions = meaning.get("definitions");
            if (definitions == null || !definitions.isArray()) {
                continue;
            }
            for (JsonNode definition : definitions) {
                String english = text(definition, "definition");
                if (english == null || !seen.add(english.toLowerCase())) {
                    continue;
                }
                result.add(new DictionaryEntry.Gloss(pos, english));
                if (result.size() >= MAX_GLOSS_ITEMS) {
                    return result;
                }
            }
        }
        return result;
    }

    private record PhoneticResult(String ipaUk, String ipaUs, String audioUk, String audioUs) {
    }

    private PhoneticResult parsePhonetics(JsonNode entry) {
        String ipaUk = null;
        String ipaUs = null;
        String audioUk = null;
        String audioUs = null;
        String neutralIpa = text(entry, "phonetic");
        String neutralAudio = text(entry, "audio");

        JsonNode phonetics = entry.get("phonetics");
        if (phonetics != null && phonetics.isArray()) {
            for (JsonNode item : phonetics) {
                String ipa = text(item, "text");
                String audio = text(item, "audio");
                String region = detectRegion(audio);
                if ("other".equals(region)) {
                    // 非英美地域的音频直接丢弃，既不归入 UK/US，也不当作中性候选
                    continue;
                }
                if ("uk".equals(region)) {
                    if (ipa != null && ipaUk == null) {
                        ipaUk = ipa;
                    }
                    if (audio != null && audioUk == null) {
                        audioUk = audio;
                    }
                } else if ("us".equals(region)) {
                    if (ipa != null && ipaUs == null) {
                        ipaUs = ipa;
                    }
                    if (audio != null && audioUs == null) {
                        audioUs = audio;
                    }
                } else {
                    // 无地域标签：IPA 保留为中性候选，音频留作最后的兜底候选
                    if (ipa != null && neutralIpa == null) {
                        neutralIpa = ipa;
                    }
                    if (audio != null && neutralAudio == null) {
                        neutralAudio = audio;
                    }
                }
            }
        }

        if (ipaUk == null && ipaUs == null && neutralIpa != null) {
            // 词典只给了一个不带地域的 IPA：两边都用它，不假装知道是英音还是美音
            ipaUk = neutralIpa;
            ipaUs = neutralIpa;
        } else if (ipaUk == null) {
            // 已知一侧的区域音标，另一侧用中性 IPA 补齐（词典本身未区分地域，不算猜测）
            ipaUk = neutralIpa;
        } else if (ipaUs == null) {
            ipaUs = neutralIpa;
        }

        if (audioUk == null && audioUs == null && neutralAudio != null) {
            // 无地域标记的音频归入美式（该语料库的默认倾向），并在字段上保留可辨识的 URL
            audioUs = neutralAudio;
        }
        return new PhoneticResult(ipaUk, ipaUs, audioUk, audioUs);
    }

    /** 从音频 URL 识别地域码：只承认 uk/gb/us，其他地域（如 au）返回 other 表示“有标签但不是英美”，不得归为中性 */
    private static final Pattern REGION_SUFFIX =
            Pattern.compile("[-_]([a-z]{2})\\.[a-z0-9]+$");

    private String detectRegion(String audio) {
        if (audio == null) {
            return null;
        }
        String lastSegment = audio.toLowerCase();
        int slash = lastSegment.lastIndexOf('/');
        if (slash >= 0) {
            lastSegment = lastSegment.substring(slash + 1);
        }
        Matcher matcher = REGION_SUFFIX.matcher(lastSegment);
        if (!matcher.find()) {
            return null;
        }
        String code = matcher.group(1);
        if (code.equals("uk") || code.equals("gb")) {
            return "uk";
        }
        if (code.equals("us")) {
            return "us";
        }
        return "other";
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || !value.isString()) {
            return null;
        }
        String s = value.asString().trim();
        return s.isEmpty() ? null : s;
    }
}
