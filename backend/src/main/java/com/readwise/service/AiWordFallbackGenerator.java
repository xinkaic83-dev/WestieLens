/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.client.DeepSeekClient;
import com.readwise.dto.WordDetailDTO;
import com.readwise.exception.BusinessException;
import com.readwise.exception.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/**
 * 词典不可用时的 DeepSeek 全量兜底（说明书 §4.4 / §11.1）。
 * 明确边界（§4.4 / R7）：
 * - AI 生成的 IPA 一律标记 phoneticSource=ai_generated，不当作权威词典数据；
 * - 不提供音频 URL，audioUkUrl/audioUsUrl 留空并置 fallbackTts=true，由浏览器合成语音朗读；
 * - AI 也拿不到可用释义时抛 5002，DeepSeek 自身故障（ModelServiceException）原样上抛映射 5003/5004。
 */
@Slf4j
@Component
public class AiWordFallbackGenerator {

    private static final int MAX_ITEMS = 4;
    private static final int MAX_MEANING_LENGTH = 100;
    private static final int MAX_PHONETIC_LENGTH = 60;

    private final DeepSeekClient deepSeekClient;
    private final ObjectMapper objectMapper;

    public AiWordFallbackGenerator(DeepSeekClient deepSeekClient, ObjectMapper objectMapper) {
        this.deepSeekClient = deepSeekClient;
        this.objectMapper = objectMapper;
    }

    public WordDetailDTO generate(String displayWord) {
        // 网络/鉴权等异常不吞：按 §11.1 返回 5003/5004，让用户知道是服务问题而非查无此词
        String output = deepSeekClient.chatJson(WordPrompts.WORD_FALLBACK_SYSTEM, displayWord);
        JsonNode root;
        try {
            root = objectMapper.readTree(output == null ? "" : output);
        } catch (Exception e) {
            log.warn("AI 兜底输出不是合法 JSON");
            throw new BusinessException(ErrorCode.WORD_NOT_FOUND);
        }
        if (!root.isObject()) {
            throw new BusinessException(ErrorCode.WORD_NOT_FOUND);
        }

        String phoneticUk = boundedText(root, "phoneticUk", MAX_PHONETIC_LENGTH);
        String phoneticUs = boundedText(root, "phoneticUs", MAX_PHONETIC_LENGTH);
        List<WordDetailDTO.Definition> definitions = parseDefinitions(root.get("definitions"));
        if (definitions.isEmpty()) {
            // 词条不存在或模型未按约定返回，§4.7 的"未查到可靠词条"
            throw new BusinessException(ErrorCode.WORD_NOT_FOUND);
        }

        boolean hasPhonetic = !phoneticUk.isEmpty() || !phoneticUs.isEmpty();
        return WordDetailDTO.builder()
                .word(displayWord)
                .phoneticUk(phoneticUk)
                .phoneticUs(phoneticUs)
                .audioUkUrl("")
                .audioUsUrl("")
                .definitions(definitions)
                .source("ai_fallback")
                .phoneticSource(hasPhonetic ? "ai_generated" : "unavailable")
                .fallbackTts(true)
                .cached(false)
                .build();
    }

    private List<WordDetailDTO.Definition> parseDefinitions(JsonNode array) {
        if (array == null || !array.isArray()) {
            return List.of();
        }
        List<WordDetailDTO.Definition> result = new ArrayList<>();
        for (JsonNode item : array) {
            if (result.size() >= MAX_ITEMS) {
                break;
            }
            if (!item.isObject()) {
                continue;
            }
            String meaning = text(item, "meaning");
            if (meaning == null || meaning.isEmpty() || meaning.length() > MAX_MEANING_LENGTH) {
                continue;
            }
            String pos = text(item, "pos");
            result.add(WordDetailDTO.Definition.builder()
                    .pos(pos == null ? "" : pos)
                    .meaning(meaning)
                    .build());
        }
        return result;
    }

    private String boundedText(JsonNode node, String field, int maxLength) {
        String value = text(node, field);
        if (value == null || value.length() > maxLength) {
            return "";
        }
        return value;
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
