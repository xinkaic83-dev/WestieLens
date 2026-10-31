/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.readwise.client.DictionaryClient;
import com.readwise.client.DictionaryEntry;
import com.readwise.dto.WordDetailDTO;
import com.readwise.exception.BusinessException;
import com.readwise.exception.ErrorCode;
import com.readwise.exception.ModelServiceException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 查词编排单测（§11.1 全部分支，全部 Mock 不打外网）：
 * 词典命中 + 中文补全、中文补全失败回退英文、词典未命中转 AI 兜底、
 * AI 也失败 5002、模型故障 5003 原样上抛、缓存命中 cached=true。
 */
@ExtendWith(MockitoExtension.class)
class WordServiceTest {

    @Mock
    private DictionaryClient dictionaryClient;

    @Mock
    private ChineseGlossTranslator glossTranslator;

    @Mock
    private AiWordFallbackGenerator fallbackGenerator;

    private Cache<String, WordDetailDTO> wordCache;
    private WordService service;

    @BeforeEach
    void setUp() {
        wordCache = Caffeine.newBuilder().maximumSize(100).build();
        service = new WordService(new TextValidator(), dictionaryClient, glossTranslator,
                new WordDetailAssembler(), fallbackGenerator, wordCache);
    }

    private DictionaryEntry entry(String word) {
        return new DictionaryEntry(word, "/ˈdeveləpmənt/", null, null,
                "https://api.dictionaryapi.dev/media/pronunciations/en/development-us.mp3",
                List.of(new DictionaryEntry.Gloss("noun", "The process of developing."),
                        new DictionaryEntry.Gloss("noun", "A newly developed item.")));
    }

    @Test
    void dictionaryHitShouldAssembleChineseMeaningsFromTranslator() {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(entry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("发展；开发", "新产品"));

        WordDetailDTO dto = service.lookup("development");

        assertThat(dto.getSource()).isEqualTo("dictionary");
        assertThat(dto.getPhoneticSource()).isEqualTo("dictionary");
        assertThat(dto.getPhoneticUk()).isEqualTo("/ˈdeveləpmənt/");
        assertThat(dto.getAudioUsUrl()).endsWith("development-us.mp3");
        // 有音频就不需要 TTS 兜底
        assertThat(dto.isFallbackTts()).isFalse();
        assertThat(dto.isCached()).isFalse();
        assertThat(dto.getDefinitions())
                .extracting(WordDetailDTO.Definition::getPos, WordDetailDTO.Definition::getMeaning)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple("n.", "发展；开发"),
                        org.assertj.core.groups.Tuple.tuple("n.", "新产品"));
    }

    @Test
    void translationFailureShouldKeepDictionaryEnglishGlossesInsteadOfFailing() {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(entry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(null);

        WordDetailDTO dto = service.lookup("development");

        // 词典已经给了可靠数据，中文补全失败只降级为英文原文，不报 5xx
        assertThat(dto.getSource()).isEqualTo("dictionary");
        assertThat(dto.getDefinitions().get(0).getMeaning()).isEqualTo("The process of developing.");
    }

    @Test
    void translatorSizeMismatchShouldFallBackToEnglishGlosses() {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(entry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("只有一条"));

        WordDetailDTO dto = service.lookup("development");

        assertThat(dto.getDefinitions().get(0).getMeaning()).isEqualTo("The process of developing.");
    }

    @Test
    void dictionaryMissShouldUseAiFallbackAndMarkAiPhoneticSource() {
        when(dictionaryClient.lookup("colour")).thenReturn(Optional.empty());
        when(fallbackGenerator.generate("colour")).thenReturn(WordDetailDTO.builder()
                .word("colour").phoneticUk("/ˈkʌlə/").phoneticUs("/ˈkʌlər/")
                .audioUkUrl("").audioUsUrl("")
                .definitions(List.of(WordDetailDTO.Definition.builder().pos("n.").meaning("颜色").build()))
                .source("ai_fallback").phoneticSource("ai_generated").fallbackTts(true).cached(false)
                .build());

        WordDetailDTO dto = service.lookup("colour");

        assertThat(dto.getSource()).isEqualTo("ai_fallback");
        assertThat(dto.isFallbackTts()).isTrue();
        assertThat(dto.getPhoneticSource()).isEqualTo("ai_generated");
    }

    @Test
    void aiFallbackWordNotFoundShouldPropagate5002() {
        when(dictionaryClient.lookup("asdfgh")).thenReturn(Optional.empty());
        when(fallbackGenerator.generate("asdfgh"))
                .thenThrow(new BusinessException(ErrorCode.WORD_NOT_FOUND));

        assertThatThrownBy(() -> service.lookup("asdfgh"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.WORD_NOT_FOUND);
    }

    @Test
    void modelNetworkErrorShouldNotBeSwallowed() {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.empty());
        when(fallbackGenerator.generate("development"))
                .thenThrow(new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "无法连接大模型服务", null));

        // §11.1：AI 兜底也失败时按 5003/5004 返回，让用户区分"服务故障"与"查无此词"
        assertThatThrownBy(() -> service.lookup("development"))
                .isInstanceOf(ModelServiceException.class);
        // 失败结果不得写入缓存，否则一次故障会被缓存 24h
        assertThat(wordCache.estimatedSize()).isZero();
    }

    @Test
    void secondLookupShouldHitCacheAndNotTouchUpstream() {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(entry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("发展；开发", "新产品"));

        WordDetailDTO first = service.lookup("Development");
        WordDetailDTO second = service.lookup("  development ");

        // §4.5：缓存 key 为小写形式，大小写与首尾空格不影响命中
        assertThat(first.isCached()).isFalse();
        assertThat(second.isCached()).isTrue();
        assertThat(second.getWord()).isEqualTo("development");
        verify(dictionaryClient, times(1)).lookup(anyString());
        verify(glossTranslator, times(1)).translate(anyList());
    }

    @Test
    void tooLongOrTooManyWordsShouldSkipDictionaryAndGoStraightToAiFallback() {
        String phrase = "the development of modern software systems in the past decade";
        when(fallbackGenerator.generate(phrase)).thenReturn(WordDetailDTO.builder()
                .word(phrase).source("ai_fallback").phoneticSource("unavailable")
                .definitions(List.of(WordDetailDTO.Definition.builder().pos("n.").meaning("现代软件开发").build()))
                .fallbackTts(true).cached(false).build());

        WordDetailDTO dto = service.lookup(phrase);

        // 词典按词条设计，超长/多词查询不可能命中，不做无意义请求
        assertThat(dto.getSource()).isEqualTo("ai_fallback");
        verifyNoInteractions(dictionaryClient);
    }

    @Test
    void shortPhraseShouldStillQueryDictionary() {
        when(dictionaryClient.lookup("ice cream")).thenReturn(Optional.of(entry("ice cream")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("冰淇淋", "新花样"));

        WordDetailDTO dto = service.lookup("ice cream");

        assertThat(dto.getSource()).isEqualTo("dictionary");
        verify(fallbackGenerator, never()).generate(anyString());
    }

    @Test
    void invalidTextShouldFailBeforeAnyUpstreamCall() {
        assertThatThrownBy(() -> service.lookup("   "))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.INVALID_PARAMS);
        assertThatThrownBy(() -> service.lookup("你好世界"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.NO_ENGLISH_CONTENT);
        verifyNoInteractions(dictionaryClient, glossTranslator, fallbackGenerator);
    }
}
