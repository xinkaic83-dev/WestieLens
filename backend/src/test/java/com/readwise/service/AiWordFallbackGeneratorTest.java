/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import com.readwise.client.DeepSeekClient;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * AI 查词兜底单测（§4.4 / R7）：
 * AI 音标必须标记 ai_generated、不返回音频、强制 fallbackTts=true；
 * 拿不到可用释义时按 5002 处理，模型自身故障原样上抛（5003/5004）。
 */
@ExtendWith(MockitoExtension.class)
class AiWordFallbackGeneratorTest {

    @Mock
    private DeepSeekClient deepSeekClient;

    private AiWordFallbackGenerator generator;

    @BeforeEach
    void setUp() {
        generator = new AiWordFallbackGenerator(deepSeekClient, new JsonMapper());
    }

    @Test
    void wellFormedOutputShouldBeMarkedAsAiFallback() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("""
                {"phoneticUk":"/ˈkʌlə/", "phoneticUs":"/ˈkʌlər/",
                 "definitions":[{"pos":"n.","meaning":"颜色"},{"pos":"v.","meaning":"给…着色"}]}
                """);

        WordDetailDTO dto = generator.generate("colour");

        assertThat(dto.getWord()).isEqualTo("colour");
        assertThat(dto.getSource()).isEqualTo("ai_fallback");
        assertThat(dto.getPhoneticSource()).isEqualTo("ai_generated");
        assertThat(dto.getPhoneticUk()).isEqualTo("/ˈkʌlə/");
        assertThat(dto.getPhoneticUs()).isEqualTo("/ˈkʌlər/");
        // AI 不产出音频 URL，必须由浏览器合成语音兜底并在 UI 标注
        assertThat(dto.getAudioUkUrl()).isEmpty();
        assertThat(dto.getAudioUsUrl()).isEmpty();
        assertThat(dto.isFallbackTts()).isTrue();
        assertThat(dto.getDefinitions()).hasSize(2);
    }

    @Test
    void missingPhoneticShouldBeMarkedUnavailable() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("""
                {"phoneticUk":"", "phoneticUs":"",
                 "definitions":[{"pos":"n.","meaning":"颜色"}]}
                """);

        WordDetailDTO dto = generator.generate("colour");

        assertThat(dto.getPhoneticSource()).isEqualTo("unavailable");
        assertThat(dto.getPhoneticUk()).isEmpty();
    }

    @Test
    void emptyDefinitionsShouldReturn5002() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn("{\"phoneticUk\":\"/x/\", \"definitions\": []}");

        assertThatThrownBy(() -> generator.generate("asdfgh"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.WORD_NOT_FOUND);
    }

    @Test
    void unparseableOutputShouldReturn5002() {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("抱歉，我不确定这个词");

        assertThatThrownBy(() -> generator.generate("asdfgh"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ErrorCode.WORD_NOT_FOUND);
    }

    @Test
    void oversizeItemsShouldBeDroppedOrRejected() {
        // 超出 4 条只取前 4 条；释义过长的条目被丢弃
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("""
                {"definitions":[
                  {"pos":"n.","meaning":"一"},{"pos":"v.","meaning":"二"},
                  {"pos":"adj.","meaning":"三"},{"pos":"adv.","meaning":"四"},
                  {"pos":"n.","meaning":"五"}]}
                """);
        assertThat(generator.generate("run").getDefinitions()).hasSize(4);

        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("""
                {"definitions":[{"pos":"n.","meaning":"%s"}]}
                """.formatted("超".repeat(101)));
        assertThatThrownBy(() -> generator.generate("run"))
                .isInstanceOf(BusinessException.class);
    }

    @Test
    void modelNetworkErrorShouldPropagateFor5003Mapping() {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenThrow(new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "无法连接大模型服务", null));

        assertThatThrownBy(() -> generator.generate("run"))
                .isInstanceOf(ModelServiceException.class);
    }
}
