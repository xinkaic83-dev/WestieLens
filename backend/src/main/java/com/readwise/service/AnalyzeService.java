/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.readwise.client.DeepSeekClient;
import com.readwise.dto.AnalyzeRequestDTO;
import com.readwise.dto.AnalyzeResponseDTO;
import com.readwise.exception.BusinessException;
import com.readwise.exception.ErrorCode;
import com.readwise.exception.ModelServiceException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 句子分析编排（说明书 §11 / §4.5）：
 * 校验 → 查分析缓存 → 路由 → 调 DeepSeek → Schema 校验 → 仅对可恢复的格式/结构错误重试一次 → 降级为仅翻译。
 * 网络故障/限流/鉴权失败按错误类型直接返回统一错误体，不盲目重复请求（§4.3-3）。
 * 查词分支交给 WordService（v0.3 词典 + AI 兜底）。
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AnalyzeService {

    private final TextValidator validator;
    private final DeepSeekClient deepSeekClient;
    private final DeepSeekOutputParser outputParser;
    private final WordService wordService;
    private final Cache<String, AnalyzeResponseDTO> analysisCache;

    /**
     * 处理 /analyze 请求。inputType=word 走查词链路，
     * 其余走 DeepSeek 句子分析。
     */
    public Object analyze(AnalyzeRequestDTO request) {
        String text = validator.requireValidText(request.text());
        validator.requireValidInputType(request.inputType());
        validator.requireValidFeatures(request.features());

        String inputType = request.inputType() == null ? "auto" : request.inputType();
        String route = switch (inputType) {
            case TextRouting.ROUTE_WORD -> TextRouting.ROUTE_WORD;
            case TextRouting.ROUTE_ANALYSIS -> TextRouting.ROUTE_ANALYSIS;
            default -> TextRouting.routeByWords(text);
        };
        if (TextRouting.ROUTE_WORD.equals(route)) {
            return wordService.lookup(text);
        }
        return analyzeSentence(text, request.features());
    }

    /** 命中缓存直接返回；未命中则调模型，仅完整结果写缓存 */
    private AnalyzeResponseDTO analyzeSentence(String text, List<String> features) {
        String cacheKey = CacheKeys.analysisKey(text, features);
        AnalyzeResponseDTO cachedValue = analysisCache.getIfPresent(cacheKey);
        if (cachedValue != null) {
            return withCached(cachedValue, true);
        }

        AnalyzeResponseDTO result = analyzeWithRetry(text);
        // partial=true 的降级结果只保翻译，缓存 24h 会把一次抖动固化下来，故不写缓存
        if (!result.isPartial()) {
            analysisCache.put(cacheKey, result);
        }
        return result;
    }

    /** DeepSeek 句子分析：首次失败时对可恢复错误重试一次 */
    private AnalyzeResponseDTO analyzeWithRetry(String text) {
        DeepSeekOutputParser.ParseOutcome first = callAndParse(text);
        switch (first.outcome()) {
            case COMPLETE:
                return first.response();
            case STRUCTURE_INVALID: {
                // 可恢复的结构错误：重试一次，仍失败则接受降级结果（partial=true，HTTP 200）
                DeepSeekOutputParser.ParseOutcome second;
                try {
                    second = callAndParse(text);
                } catch (ModelServiceException exception) {
                    // 首次译文已可用，重试故障不应丢弃已有的降级结果。
                    return first.response();
                }
                if (second.outcome() == DeepSeekOutputParser.Outcome.COMPLETE) {
                    return second.response();
                }
                if (second.outcome() == DeepSeekOutputParser.Outcome.STRUCTURE_INVALID) {
                    log.info("结构校验两次未通过，降级为仅翻译");
                    return second.response();
                }
                // 重试没有有效译文时保留首次译文。
                return first.response();
            }
            case UNPARSEABLE:
            case MISSING_TRANSLATION:
            default: {
                DeepSeekOutputParser.ParseOutcome second = callAndParse(text);
                if (second.outcome() == DeepSeekOutputParser.Outcome.COMPLETE) {
                    return second.response();
                }
                if (second.outcome() == DeepSeekOutputParser.Outcome.STRUCTURE_INVALID) {
                    // 重试后翻译恢复但结构仍不可用 → 降级
                    return second.response();
                }
                throw new BusinessException(ErrorCode.TRANSLATION_UNAVAILABLE);
            }
        }
    }

    /**
     * 调模型并解析。ModelServiceException（网络/限流/鉴权）直接向上抛出，
     * 不属于"可恢复的格式/结构错误"，不参与重试。
     */
    private DeepSeekOutputParser.ParseOutcome callAndParse(String text) {
        String modelOutput = deepSeekClient.chatJson(AnalysisPrompt.SYSTEM_PROMPT, text);
        return outputParser.parse(text, modelOutput);
    }

    /** 缓存命中时复制一份再改 cached 标记，避免污染缓存内对象 */
    private AnalyzeResponseDTO withCached(AnalyzeResponseDTO source, boolean cached) {
        return AnalyzeResponseDTO.builder()
                .text(source.getText())
                .translation(source.getTranslation())
                .mainSentence(source.getMainSentence())
                .clauses(source.getClauses())
                .syntaxComponents(source.getSyntaxComponents())
                .grammarPoints(source.getGrammarPoints())
                .partial(source.isPartial())
                .cached(cached)
                .build();
    }
}
