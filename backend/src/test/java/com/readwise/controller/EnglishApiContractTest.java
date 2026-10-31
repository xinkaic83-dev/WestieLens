/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.controller;

import com.github.benmanes.caffeine.cache.Cache;
import com.readwise.client.DeepSeekClient;
import com.readwise.client.DictionaryClient;
import com.readwise.client.DictionaryEntry;
import com.readwise.dto.AnalyzeResponseDTO;
import com.readwise.dto.WordDetailDTO;
import com.readwise.exception.ErrorCode;
import com.readwise.exception.ModelServiceException;
import com.readwise.service.ChineseGlossTranslator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 接口契约测试（v0.2 分析链路 + v0.3 查词链路）。
 * 只 mock 三个外部依赖出口（DeepSeekClient / DictionaryClient / ChineseGlossTranslator），
 * 编排、Schema 校验、降级、缓存、错误码映射都走真实 Bean，
 * 确保对外 JSON 始终符合说明书 §6 与 §4.7。
 * 测试密钥经 properties 注入，绕过 fail-fast 启动校验（§4.6）。
 * 契约测试会连续发很多请求，必须关闭限流，避免撞上 429 让用例变得不稳定；
 * 限流本身由 RateLimitFilterTest 单独覆盖。
 */
@SpringBootTest(properties = {
        "deepseek.api-key=test-key-for-contract-tests",
        "rate-limit.enabled=false"
})
@AutoConfigureMockMvc
class EnglishApiContractTest {

    private static final String EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    private static final String SENTENCE = "Although it was raining, we decided to go out.";

    private static final String VALID_MODEL_JSON = """
            {
              "translation": "虽然当时正在下雨，我们还是决定出门。",
              "mainSentence": "we decided to go out",
              "clauses": [
                {"text": "Although it was raining", "type": "adverbial", "label": "让步状语从句", "explanation": "although 引导让步状语从句"}
              ],
              "syntaxComponents": [
                {"text": "we", "component": "subject", "label": "主语", "explanation": "代词作主语"},
                {"text": "decided to go out", "component": "predicate", "label": "谓语", "explanation": "decide to do 固定搭配"}
              ],
              "grammarPoints": [
                {"name": "让步状语从句", "text": "Although it was raining", "explanation": "although 引导，表示\\"尽管\\""}
              ]
            }
            """;

    /** 翻译合法但结构片段是编造的（不在原句中）→ 结构校验失败 */
    /** 片段编造（原句没有 "Although it is raining"）→ 结构非法，可恢复，重试一次后降级 */
    private static final String FABRICATED_FRAGMENT_JSON = """
            {
              "translation": "虽然当时正在下雨，我们还是决定出门。",
              "mainSentence": "we decided to go out",
              "clauses": [
                {"text": "Although it is raining", "type": "adverbial", "label": "让步状语从句", "explanation": "编造了时态。"}
              ],
              "syntaxComponents": [],
              "grammarPoints": []
            }
            """;

    /** 连翻译都拿不到 → 翻译失败链路 */
    private static final String NO_TRANSLATION_JSON = """
            {"translation": "", "mainSentence": "we decided to go out"}
            """;

    /** 词典未命中时 AI 兜底的输出（音标必须被标记为 ai_generated） */
    private static final String AI_WORD_JSON = """
            {
              "phoneticUk": "/ˈdeveələpmənt/",
              "phoneticUs": "/dɪˈvɛləpmənt/",
              "definitions": [{"pos": "n.", "meaning": "发展；开发；研制"}]
            }
            """;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private Cache<String, WordDetailDTO> wordCache;

    @Autowired
    private Cache<String, AnalyzeResponseDTO> analysisCache;

    @MockitoBean
    private DeepSeekClient deepSeekClient;

    @MockitoBean
    private DictionaryClient dictionaryClient;

    @MockitoBean
    private ChineseGlossTranslator glossTranslator;

    /** 缓存是有状态的，逐个用例清空，避免用例之间通过缓存互相影响 */
    @BeforeEach
    void clearCaches() {
        wordCache.invalidateAll();
        analysisCache.invalidateAll();
    }

    private DictionaryEntry dictionaryEntry(String word) {
        return new DictionaryEntry(word,
                "/dɪˈvɛləpmənt/",
                "/dɪˈvɛləpmənt/",
                "https://api.dictionaryapi.dev/media/pronunciations/en/development-uk.mp3",
                "https://api.dictionaryapi.dev/media/pronunciations/en/development-us.mp3",
                List.of(new DictionaryEntry.Gloss("noun", "The process of developing; growth, directed change.")));
    }

    // ---------------- v0.3 查词契约 ----------------

    @Test
    void wordShouldReturnDictionaryDtoWithIpaAudioAndChineseMeaning() throws Exception {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(dictionaryEntry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("发展；开发；研制"));

        mockMvc.perform(get("/api/english/word").param("text", "development"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.word").value("development"))
                .andExpect(jsonPath("$.phoneticUk").value("/dɪˈvɛləpmənt/"))
                .andExpect(jsonPath("$.phoneticUs").value("/dɪˈvɛləpmənt/"))
                .andExpect(jsonPath("$.audioUkUrl")
                        .value("https://api.dictionaryapi.dev/media/pronunciations/en/development-uk.mp3"))
                .andExpect(jsonPath("$.audioUsUrl")
                        .value("https://api.dictionaryapi.dev/media/pronunciations/en/development-us.mp3"))
                .andExpect(jsonPath("$.definitions[0].pos").value("n."))
                .andExpect(jsonPath("$.definitions[0].meaning").value("发展；开发；研制"))
                .andExpect(jsonPath("$.source").value("dictionary"))
                .andExpect(jsonPath("$.phoneticSource").value("dictionary"))
                // 有词典音频时不需要浏览器合成语音
                .andExpect(jsonPath("$.fallbackTts").value(false))
                .andExpect(jsonPath("$.cached").value(false))
                // v0.3 起不再有模拟响应标记
                .andExpect(jsonPath("$.mockNote").doesNotExist());
    }

    @Test
    void wordSecondCallShouldBeServedFromCache() throws Exception {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(dictionaryEntry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("发展；开发；研制"));

        mockMvc.perform(get("/api/english/word").param("text", "development"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cached").value(false));

        mockMvc.perform(get("/api/english/word").param("text", "Development"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cached").value(true));

        // §4.5：缓存 key 为小写形式，大小写不敏感，第二次不再请求上游
        verify(dictionaryClient, times(1)).lookup(anyString());
    }

    @Test
    void wordMissShouldDegradeToAiFallbackWithMarkedPhoneticSource() throws Exception {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.empty());
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(AI_WORD_JSON);

        mockMvc.perform(get("/api/english/word").param("text", "development"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("ai_fallback"))
                .andExpect(jsonPath("$.phoneticSource").value("ai_generated"))
                // AI 不产出音频，前端需回退浏览器合成语音并标注（§4.4）
                .andExpect(jsonPath("$.audioUkUrl").value(""))
                .andExpect(jsonPath("$.audioUsUrl").value(""))
                .andExpect(jsonPath("$.fallbackTts").value(true))
                .andExpect(jsonPath("$.definitions[0].meaning").value("发展；开发；研制"));
    }

    @Test
    void wordWithNoResultAnywhereShouldReturn5002() throws Exception {
        when(dictionaryClient.lookup("asdfghjkl")).thenReturn(Optional.empty());
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenReturn("{\"phoneticUk\": \"\", \"phoneticUs\": \"\", \"definitions\": []}");

        mockMvc.perform(get("/api/english/word").param("text", "asdfghjkl"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(5002))
                .andExpect(jsonPath("$.retryable").value(false));
    }

    @Test
    void wordUpstreamModelFailureShouldReturn5003() throws Exception {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.empty());
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenThrow(new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "无法连接大模型服务", null));

        mockMvc.perform(get("/api/english/word").param("text", "development"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(5003))
                .andExpect(jsonPath("$.retryable").value(true));
    }

    @Test
    void wordTranslationFailureShouldKeepEnglishGloss() throws Exception {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(dictionaryEntry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(null);

        mockMvc.perform(get("/api/english/word").param("text", "development"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("dictionary"))
                .andExpect(jsonPath("$.definitions[0].meaning").value("The process of developing; growth, directed change."));
    }

    @Test
    void wordMissingParamShouldReturn4003() throws Exception {
        mockMvc.perform(get("/api/english/word"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4003));
    }

    @Test
    void wordNonEnglishTextShouldReturn4002() throws Exception {
        mockMvc.perform(get("/api/english/word").param("text", "12345"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4002));
    }

    @Test
    void wordTooLongTextShouldReturn4001() throws Exception {
        mockMvc.perform(get("/api/english/word").param("text", "a".repeat(501)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4001));
    }

    @Test
    void wordPhraseShouldBeAccepted() throws Exception {
        // 真实浏览器端 %20 由容器解码；MockMvc param() 为模拟解码后的值
        when(dictionaryClient.lookup("ice cream")).thenReturn(Optional.of(dictionaryEntry("ice cream")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("冰淇淋"));

        mockMvc.perform(get("/api/english/word").param("text", "ice cream"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.word").value("ice cream"))
                .andExpect(jsonPath("$.definitions[0].meaning").value("冰淇淋"));
    }

    // ---------------- v0.2 句子分析契约 ----------------

    @Test
    void analyzeShouldReturnValidatedDeepSeekResponse() throws Exception {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(VALID_MODEL_JSON);

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"text": "Although it was raining, we decided to go out.",
                                 "inputType": "analysis",
                                 "features": ["translation", "clauses", "syntax", "grammar"]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value(SENTENCE))
                .andExpect(jsonPath("$.translation").value("虽然当时正在下雨，我们还是决定出门。"))
                .andExpect(jsonPath("$.mainSentence").value("we decided to go out"))
                .andExpect(jsonPath("$.clauses[0].type").value("adverbial"))
                .andExpect(jsonPath("$.syntaxComponents").isArray())
                .andExpect(jsonPath("$.grammarPoints").isArray())
                .andExpect(jsonPath("$.partial").value(false))
                .andExpect(jsonPath("$.cached").value(false))
                .andExpect(jsonPath("$.mockNote").doesNotExist());
    }

    @Test
    void analyzeSecondIdenticalRequestShouldHitCache() throws Exception {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(VALID_MODEL_JSON);
        String body = "{\"text\": \"" + SENTENCE + "\", \"inputType\": \"analysis\", \"features\": [\"translation\"]}";

        mockMvc.perform(post("/api/english/analyze").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cached").value(false));

        mockMvc.perform(post("/api/english/analyze").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cached").value(true));

        verify(deepSeekClient, times(1)).chatJson(anyString(), anyString());
    }

    @Test
    void analyzeStructureInvalidShouldRetryOnceThenDegradeToPartial() throws Exception {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(FABRICATED_FRAGMENT_JSON);

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"" + SENTENCE + "\", \"inputType\": \"analysis\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.partial").value(true))
                .andExpect(jsonPath("$.translation").isNotEmpty())
                .andExpect(jsonPath("$.mainSentence").doesNotExist())
                .andExpect(jsonPath("$.clauses").isEmpty())
                .andExpect(jsonPath("$.syntaxComponents").isEmpty())
                .andExpect(jsonPath("$.grammarPoints").isEmpty());

        // §4.3-3：可恢复的结构错误仅重试一次，总调用次数 = 2
        verify(deepSeekClient, times(2)).chatJson(anyString(), anyString());
    }

    @Test
    void analyzeMissingTranslationShouldRetryOnceThenReturn5001() throws Exception {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn(NO_TRANSLATION_JSON);

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"" + SENTENCE + "\", \"inputType\": \"analysis\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(5001))
                .andExpect(jsonPath("$.retryable").value(true));

        verify(deepSeekClient, times(2)).chatJson(anyString(), anyString());
    }

    @Test
    void analyzeUnparseableOutputShouldReturn5001() throws Exception {
        when(deepSeekClient.chatJson(anyString(), anyString())).thenReturn("这不是 JSON");

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"" + SENTENCE + "\", \"inputType\": \"analysis\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(5001));
    }

    @Test
    void analyzeModelNetworkErrorShouldMap5003WithoutRetry() throws Exception {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenThrow(new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "无法连接大模型服务", null));

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"" + SENTENCE + "\", \"inputType\": \"analysis\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(5003))
                .andExpect(jsonPath("$.retryable").value(true));

        // §4.3-3：网络类错误不做盲目重复请求，只调用一次
        verify(deepSeekClient, times(1)).chatJson(anyString(), anyString());
    }

    @Test
    void analyzeModelErrorShouldMap5004() throws Exception {
        when(deepSeekClient.chatJson(anyString(), anyString()))
                .thenThrow(new ModelServiceException(ErrorCode.INTERNAL_ERROR, "大模型服务鉴权失败", null));

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"" + SENTENCE + "\", \"inputType\": \"analysis\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(5004))
                .andExpect(jsonPath("$.retryable").value(true));
    }

    @Test
    void analyzeAutoRoutingShouldSendSingleWordToDictionaryChain() throws Exception {
        when(dictionaryClient.lookup("development")).thenReturn(Optional.of(dictionaryEntry("development")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("发展；开发；研制"));

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"development\", \"inputType\": \"auto\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.word").value("development"))
                .andExpect(jsonPath("$.definitions").isArray())
                .andExpect(jsonPath("$.phoneticSource").value("dictionary"));

        verify(deepSeekClient, times(0)).chatJson(anyString(), anyString());
    }

    @Test
    void analyzeMissingInputTypeShouldDefaultToAuto() throws Exception {
        // 无标点多词短语按路由规则视为单词/短语，命中查词分支
        when(dictionaryClient.lookup("ice cream")).thenReturn(Optional.of(dictionaryEntry("ice cream")));
        when(glossTranslator.translate(anyList())).thenReturn(List.of("冰淇淋"));

        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"ice cream\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.word").value("ice cream"))
                .andExpect(jsonPath("$.definitions").isArray());
    }

    @Test
    void analyzeBlankTextShouldReturn4003() throws Exception {
        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"   \", \"inputType\": \"analysis\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4003))
                .andExpect(jsonPath("$.retryable").value(false));
    }

    @Test
    void analyzeTooLongTextShouldReturn4001() throws Exception {
        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"" + "a".repeat(501) + "\", \"inputType\": \"analysis\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4001))
                .andExpect(jsonPath("$.retryable").value(false));
    }

    @Test
    void analyzeNonEnglishTextShouldReturn4002() throws Exception {
        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"你好世界\", \"inputType\": \"analysis\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4002))
                .andExpect(jsonPath("$.retryable").value(false));
    }

    @Test
    void analyzeUnknownInputTypeShouldReturn4003() throws Exception {
        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"hello world\", \"inputType\": \"sentence\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4003));
    }

    @Test
    void analyzeUnknownFeatureShouldReturn4003() throws Exception {
        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\": \"hello world\", \"inputType\": \"analysis\", \"features\": [\"pronunciation\"]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4003));
    }

    @Test
    void analyzeMalformedBodyShouldReturn4003() throws Exception {
        mockMvc.perform(post("/api/english/analyze")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{not-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(4003));
    }

    // ---------------- CORS 契约 ----------------

    @Test
    void corsPreflightFromExtensionOriginShouldBeAllowed() throws Exception {
        mockMvc.perform(options("/api/english/analyze")
                        .header("Origin", EXTENSION_ORIGIN)
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", EXTENSION_ORIGIN));
    }

    @Test
    void corsPreflightFromWebOriginShouldNotBeAllowed() throws Exception {
        mockMvc.perform(options("/api/english/analyze")
                        .header("Origin", "https://evil.example.com")
                        .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }
}
