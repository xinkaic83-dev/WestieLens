/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.client.DeepSeekClient;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.readwise.dto.AnalyzeRequestDTO;
import com.readwise.dto.AnalyzeResponseDTO;
import com.readwise.dto.WordDetailDTO;
import com.readwise.exception.BusinessException;
import com.readwise.exception.ErrorCode;
import com.readwise.exception.ModelServiceException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 分析编排单测（全部 Mock，§8.2）：
 * 覆盖成功、重试一次成功、两次失败降级 partial、翻译失败 5001、网络错误不重试、word 路由、分析缓存。
 */
@ExtendWith(MockitoExtension.class)
class AnalyzeServiceTest {

    private static final String SENTENCE = "Although it was raining, we decided to go out.";

    private static final String VALID_JSON = """
            {
              "translation": "虽然下雨还是出门了。",
              "mainSentence": "we decided to go out",
              "clauses": [{"text": "Although it was raining", "type": "adverbial_clause", "label": "让步状语从句", "explanation": "Although 引导。"}],
              "syntaxComponents": [{"text": "we", "component": "subject", "label": "主语", "explanation": "行为发出者。"}],
              "grammarPoints": [{"name": "过去进行时", "text": "was raining", "explanation": "过去正在发生。"}]
            }
            """;

    /** 翻译有效、结构片段编造（不在原句中） */
    /**
     * 可恢复的结构错误：clauses 里的 text 被编造（原句里没有），
     * 注意不能用"mainSentence 不逐字"来构造——主干重构是允许的（见 DeepSeekOutputParser）。
     */
    private static final String BAD_STRUCTURE_JSON = """
            {
              "translation": "翻译仍然有效。",
              "mainSentence": "we decided to go out",
              "clauses": [
                {"text": "we will fly to mars", "type": "adverbial", "label": "状语从句", "explanation": "原文中不存在该片段。"}
              ],
              "syntaxComponents": [],
              "grammarPoints": []
            }
            """;

    @Mock
    private DeepSeekClient deepSeekClient;

    @Mock
    private WordService wordService;

    private Cache<String, AnalyzeResponseDTO> analysisCache;
    private AnalyzeService service;

    @BeforeEach
    void setUp() {
        // 用真实 Caffeine 实例验证缓存行为，不 mock 缓存本身
        analysisCache = Caffeine.newBuilder().maximumSize(100).build();
        service = new AnalyzeService(
                new TextValidator(),
                deepSeekClient,
                new DeepSeekOutputParser(new JsonMapper()),
                wordService,
                analysisCache);
    }

    private AnalyzeRequestDTO analysisRequest(String text) {
        return new AnalyzeRequestDTO(text, "analysis", List.of("translation", "clauses", "syntax", "grammar"));
    }

    @Test
    void validModelOutputShouldReturnCompleteResponse() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(VALID_JSON);

        Object result = service.analyze(analysisRequest(SENTENCE));

        assertThat(result).isInstanceOf(AnalyzeResponseDTO.class);
        AnalyzeResponseDTO dto = (AnalyzeResponseDTO) result;
        assertThat(dto.isPartial()).isFalse();
        assertThat(dto.isCached()).isFalse();
        assertThat(dto.getTranslation()).isEqualTo("虽然下雨还是出门了。");
        assertThat(dto.getClauses()).hasSize(1);
        verify(deepSeekClient, times(1)).chatJson(anyString(), anyString());
    }

    @Test
    void recoverableStructureErrorShouldRetryOnceAndSucceed() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn(BAD_STRUCTURE_JSON)
                .thenReturn(VALID_JSON);

        AnalyzeResponseDTO dto = (AnalyzeResponseDTO) service.analyze(analysisRequest(SENTENCE));

        assertThat(dto.isPartial()).isFalse();
        assertThat(dto.getClauses()).hasSize(1);
        // 仅重试一次：总共两次调用
        verify(deepSeekClient, times(2)).chatJson(anyString(), anyString());
    }

    @Test
    void structureStillInvalidAfterRetryShouldDegradeToPartial() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(BAD_STRUCTURE_JSON);

        AnalyzeResponseDTO dto = (AnalyzeResponseDTO) service.analyze(analysisRequest(SENTENCE));

        // §4.3-4：翻译成功但结构不可用 → HTTP 200 + partial=true + 结构字段空数组
        assertThat(dto.isPartial()).isTrue();
        assertThat(dto.getTranslation()).isEqualTo("翻译仍然有效。");
        assertThat(dto.getClauses()).isEmpty();
        assertThat(dto.getSyntaxComponents()).isEmpty();
        assertThat(dto.getGrammarPoints()).isEmpty();
        verify(deepSeekClient, times(2)).chatJson(anyString(), anyString());
    }

    @Test
    void retryWithoutTranslationShouldPreserveFirstTranslation() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn(BAD_STRUCTURE_JSON).thenReturn("{}");

        AnalyzeResponseDTO dto = (AnalyzeResponseDTO) service.analyze(analysisRequest(SENTENCE));

        assertThat(dto.isPartial()).isTrue();
        assertThat(dto.getTranslation()).isEqualTo("翻译仍然有效。");
        assertThat(analysisCache.estimatedSize()).isZero();
    }

    @Test
    void retryNetworkFailureShouldPreserveFirstTranslation() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn(BAD_STRUCTURE_JSON)
                .thenThrow(new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "网络不可达", null));

        AnalyzeResponseDTO dto = (AnalyzeResponseDTO) service.analyze(analysisRequest(SENTENCE));

        assertThat(dto.isPartial()).isTrue();
        assertThat(dto.getTranslation()).isEqualTo("翻译仍然有效。");
        assertThat(analysisCache.estimatedSize()).isZero();
        verify(deepSeekClient, times(2)).chatJson(anyString(), anyString());
    }

    @Test
    void unparseableTwiceShouldFailWith5001() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("```json{bad");

        assertThatThrownBy(() -> service.analyze(analysisRequest(SENTENCE)))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.TRANSLATION_UNAVAILABLE);
        verify(deepSeekClient, times(2)).chatJson(anyString(), anyString());
    }

    @Test
    void networkErrorShouldNotBeRetriedAndMapTo5003() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenThrow(new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "网络不可达", null));

        assertThatThrownBy(() -> service.analyze(analysisRequest(SENTENCE)))
                .isInstanceOf(ModelServiceException.class);
        // §4.3-3：网络故障不盲目重复请求
        verify(deepSeekClient, times(1)).chatJson(anyString(), anyString());
    }

    @Test
    void wordRouteShouldDelegateToWordService() {
        WordDetailDTO mockDetail = WordDetailDTO.builder().word("development").build();
        when(wordService.lookup("development")).thenReturn(mockDetail);

        Object result = service.analyze(new AnalyzeRequestDTO("development", "word", null));

        assertThat(result).isInstanceOf(WordDetailDTO.class);
        assertThat(((WordDetailDTO) result).getWord()).isEqualTo("development");
        verifyNoInteractions(deepSeekClient);
    }

    @Test
    void repeatedAnalysisShouldHitCacheOnceAndMarkCached() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(VALID_JSON);

        AnalyzeResponseDTO first = (AnalyzeResponseDTO) service.analyze(analysisRequest(SENTENCE));
        AnalyzeResponseDTO second = (AnalyzeResponseDTO) service.analyze(analysisRequest(SENTENCE));

        // §4.5：第二次命中缓存，cached=true 且不再请求模型
        assertThat(first.isCached()).isFalse();
        assertThat(second.isCached()).isTrue();
        assertThat(second.getTranslation()).isEqualTo(first.getTranslation());
        assertThat(first.isCached()).as("缓存内对象不应被命中读取反向污染").isFalse();
        verify(deepSeekClient, times(1)).chatJson(anyString(), anyString());
    }

    @Test
    void partialResultShouldNotBeCached() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(BAD_STRUCTURE_JSON);

        AnalyzeResponseDTO degraded = (AnalyzeResponseDTO) service.analyze(analysisRequest(SENTENCE));
        assertThat(degraded.isPartial()).isTrue();

        // 降级结果不写缓存：下一次仍应重新请求，避免把一次抖动固化 24h
        service.analyze(analysisRequest(SENTENCE));
        verify(deepSeekClient, times(4)).chatJson(anyString(), anyString());
    }

    @Test
    void differentFeaturesShouldNotShareCacheEntry() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(VALID_JSON);

        service.analyze(new AnalyzeRequestDTO(SENTENCE, "analysis", List.of("translation")));
        service.analyze(new AnalyzeRequestDTO(SENTENCE, "analysis", List.of("translation", "clauses")));

        // key = 原文 SHA-256 + features 列表，features 不同不得串用（§4.5）
        verify(deepSeekClient, times(2)).chatJson(anyString(), anyString());
    }

    @Test
    void autoRouteShouldSendSentenceToModel() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(VALID_JSON);

        Object result = service.analyze(new AnalyzeRequestDTO(SENTENCE, "auto", null));

        assertThat(result).isInstanceOf(AnalyzeResponseDTO.class);
        verify(deepSeekClient, times(1)).chatJson(anyString(), anyString());
    }

    @Test
    void invalidParamsShouldFailBeforeModelCall() {
        assertThatThrownBy(() -> service.analyze(analysisRequest("你好世界")))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.NO_ENGLISH_CONTENT);
        assertThatThrownBy(() -> service.analyze(new AnalyzeRequestDTO(SENTENCE, "sentence", null)))
                .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> service.analyze(new AnalyzeRequestDTO(SENTENCE, "analysis", List.of("unknown"))))
                .isInstanceOf(BusinessException.class);
        verifyNoInteractions(deepSeekClient);
    }
}
