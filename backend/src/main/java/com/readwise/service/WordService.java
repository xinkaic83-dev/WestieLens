/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.readwise.client.DictionaryClient;
import com.readwise.client.DictionaryEntry;
import com.readwise.dto.WordDetailDTO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * 查词编排（说明书 §11.1）：
 * 校验 → 查缓存 → 词典 → 英文释义交 DeepSeek 译为中文 → 组装(source=dictionary) → 写缓存；
 * 词典超时/异常/未命中 → DeepSeek 全量补全(source=ai_fallback, fallbackTts=true) → 写缓存；
 * AI 也不可用 → 5002（查无此词）或原样上抛 5003/5004（服务故障）。
 */
@Slf4j
@Service
public class WordService {

    /**
     * 词典接口是按"词条"设计的，过长的选区（例如用户误选一整段没标句末标点的文字）
     * 不可能命中，还会拼出超长 URL。超过该规模直接走 AI 兜底，不做无意义请求。
     */
    private static final int MAX_DICTIONARY_QUERY_LENGTH = 60;
    private static final int MAX_DICTIONARY_QUERY_WORDS = 4;

    private final TextValidator validator;
    private final DictionaryClient dictionaryClient;
    private final ChineseGlossTranslator glossTranslator;
    private final WordDetailAssembler assembler;
    private final AiWordFallbackGenerator fallbackGenerator;
    private final Cache<String, WordDetailDTO> wordCache;

    public WordService(TextValidator validator,
                       DictionaryClient dictionaryClient,
                       ChineseGlossTranslator glossTranslator,
                       WordDetailAssembler assembler,
                       AiWordFallbackGenerator fallbackGenerator,
                       Cache<String, WordDetailDTO> wordCache) {
        this.validator = validator;
        this.dictionaryClient = dictionaryClient;
        this.glossTranslator = glossTranslator;
        this.assembler = assembler;
        this.fallbackGenerator = fallbackGenerator;
        this.wordCache = wordCache;
    }

    /** GET /api/english/word?text= 与 /analyze 路由到查词时共用这一入口 */
    public WordDetailDTO lookup(String rawText) {
        String text = validator.requireValidText(rawText);
        String cacheKey = CacheKeys.wordKey(text);

        WordDetailDTO cachedValue = wordCache.getIfPresent(cacheKey);
        if (cachedValue != null) {
            // 命中缓存的响应标记 cached=true（§4.5，前端展示“来自缓存”）
            WordDetailDTO hit = assembler.withCached(cachedValue, true);
            // 缓存按小写词条命中，展示仍用用户本次选区的原文写法，不沿用上一次的 size
            hit.setWord(text);
            return hit;
        }

        WordDetailDTO result = load(text, cacheKey);
        wordCache.put(cacheKey, result);
        return result;
    }

    /** @param queryKey 小写形式，保证不同大小写的同一词不会向词典发两个不同请求 */
    private WordDetailDTO load(String displayWord, String queryKey) {
        Optional<DictionaryEntry> entry = dictionaryUsable(displayWord)
                ? dictionaryClient.lookup(queryKey)
                : Optional.empty();

        if (entry.isPresent()) {
            // 中文补全失败时保留词典英文释义，不因此判查词失败
            List<String> chineseMeanings = glossTranslator.translate(entry.get().glosses());
            return assembler.fromDictionary(entry.get(), displayWord, chineseMeanings);
        }
        log.info("词典链路不可用，转 AI 兜底: {}", displayWord);
        return fallbackGenerator.generate(displayWord);
    }

    private boolean dictionaryUsable(String text) {
        if (text.length() > MAX_DICTIONARY_QUERY_LENGTH) {
            return false;
        }
        return text.split("\\s+").length <= MAX_DICTIONARY_QUERY_WORDS;
    }
}
