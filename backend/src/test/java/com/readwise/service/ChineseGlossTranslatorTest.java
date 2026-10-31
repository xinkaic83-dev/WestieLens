/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.client.DeepSeekClient;
import com.readwise.client.DictionaryEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * 中文释义补全单测（§4.4）：数量必须严格对应，任何不合规输出都返回 null，
 * 由调用方回退词典英文原文，绝不因为补全失败而让查词整体失败。
 */
@ExtendWith(MockitoExtension.class)
class ChineseGlossTranslatorTest {

    @Mock
    private DeepSeekClient deepSeekClient;

    private ChineseGlossTranslator translator;

    @BeforeEach
    void setUp() {
        translator = new ChineseGlossTranslator(deepSeekClient, new JsonMapper());
    }

    private List<DictionaryEntry.Gloss> twoGlosses() {
        return List.of(new DictionaryEntry.Gloss("noun", "The process of developing."),
                new DictionaryEntry.Gloss("verb", "To develop."));
    }

    @Test
    void wellFormedOutputShouldReturnOrderedChineseMeanings() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn("{\"meanings\": [\"发展；开发\", \"发展；开发（动词）\"]}");

        assertThat(translator.translate(twoGlosses()))
                .containsExactly("发展；开发", "发展；开发（动词）");
    }

    @Test
    void countMismatchShouldBeRejected() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn("{\"meanings\": [\"只有一条\"]}");

        assertThat(translator.translate(twoGlosses())).isNull();
    }

    @Test
    void blankOrUnknownShapeShouldBeRejected() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn("{\"meanings\": [\"发展；开发\", \"  \"]}");
        assertThat(translator.translate(twoGlosses())).isNull();

        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("{\"wrong\": []}");
        assertThat(translator.translate(twoGlosses())).isNull();

        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("不是 JSON");
        assertThat(translator.translate(twoGlosses())).isNull();
    }

    @Test
    void modelFailureShouldDegradeQuietly() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenThrow(new com.readwise.exception.ModelServiceException(
                        com.readwise.exception.ErrorCode.MODEL_NETWORK_ERROR, "网络不可达", null));

        // 词典数据本身可用，模型故障时保留英文释义而不是抛错
        assertThat(translator.translate(twoGlosses())).isNull();
    }

    @Test
    void emptyOrNullInputShouldNotCallModel() {
        assertThat(translator.translate(List.of())).isNull();
        assertThat(translator.translate(null)).isNull();
    }
}
