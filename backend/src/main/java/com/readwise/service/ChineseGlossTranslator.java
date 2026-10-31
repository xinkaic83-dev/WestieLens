/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.client.DeepSeekClient;
import com.readwise.client.DictionaryEntry;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 英文释义 → 中文释义补全（说明书 §4.4：DeepSeek 翻译/补全为地道中文释义）。
 * 这一步是"锦上添花"：词典已经给了 IPA/音频/英文释义，翻译失败不该让查词整体失败，
 * 因此所有异常（含 DeepSeek 网络故障）都返回 null，由调用方保留词典英文原文。
 */
@Slf4j
@Component
public class ChineseGlossTranslator {

    private static final int MAX_MEANING_LENGTH = 100;

    private final DeepSeekClient deepSeekClient;
    private final ObjectMapper objectMapper;

    public ChineseGlossTranslator(DeepSeekClient deepSeekClient, ObjectMapper objectMapper) {
        this.deepSeekClient = deepSeekClient;
        this.objectMapper = objectMapper;
    }

    /**
     * @return 与 glosses 顺序严格对应的中文释义；任何异常或数量不匹配都返回 null
     */
    public List<String> translate(List<DictionaryEntry.Gloss> glosses) {
        if (glosses == null || glosses.isEmpty()) {
            return null;
        }
        String userPayload;
        try {
            List<Map<String, String>> items = new ArrayList<>();
            for (DictionaryEntry.Gloss gloss : glosses) {
                items.add(Map.of("pos", gloss.pos() == null ? "" : gloss.pos(),
                        "definition", gloss.englishDefinition()));
            }
            userPayload = objectMapper.writeValueAsString(items);
        } catch (Exception e) {
            log.warn("构造释义翻译请求失败", e);
            return null;
        }

        try {
            String output = deepSeekClient.chatJson(WordPrompts.TRANSLATE_GLOSS_SYSTEM, userPayload);
            return parse(output, glosses.size());
        } catch (Exception e) {
            log.warn("中文释义补全失败，回退词典英文原文: {}", e.getMessage());
            return null;
        }
    }

    /** meanings 数组必须等长且每项为非空短字符串，否则视为不可用（§4.3 输出严格校验） */
    private List<String> parse(String output, int expectedSize) {
        try {
            JsonNode root = objectMapper.readTree(output == null ? "" : output);
            JsonNode array = root.get("meanings");
            if (array == null || !array.isArray() || array.size() != expectedSize) {
                log.warn("中文释义数量与词典释义不匹配: expected={}, actual={}",
                        expectedSize, array == null ? -1 : array.size());
                return null;
            }
            List<String> result = new ArrayList<>();
            for (JsonNode item : array) {
                if (!item.isString()) {
                    return null;
                }
                String meaning = item.asString().trim();
                if (meaning.isEmpty() || meaning.length() > MAX_MEANING_LENGTH) {
                    return null;
                }
                result.add(meaning);
            }
            return result;
        } catch (Exception e) {
            log.warn("中文释义输出不是约定 JSON: {}", e.getMessage());
            return null;
        }
    }
}
