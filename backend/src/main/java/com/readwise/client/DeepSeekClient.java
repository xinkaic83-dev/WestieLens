/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.client;

import com.readwise.config.DeepSeekProperties;
import com.readwise.config.HttpTimeoutProperties;
import com.readwise.exception.ErrorCode;
import com.readwise.exception.ModelServiceException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * DeepSeek Client（说明书 §4.3 / §11）：OpenAI 兼容协议封装、JSON Mode、动态超时。
 * POST {base-url}/chat/completions，response_format=json_object。
 * 错误分类（§4.3-3）：网络/超时/限流/服务端错误 → 5003；鉴权/配置 → 5004；
 * 均为不可盲目重试类错误，重试策略只针对可恢复的输出格式/结构错误（在 Service 层）。
 */
@Slf4j
@Component
public class DeepSeekClient {

    private static final String CHAT_PATH = "/chat/completions";

    private final DeepSeekProperties properties;
    private final ObjectMapper objectMapper;
    private final RestClient shortTimeoutClient;
    private final RestClient longTimeoutClient;
    private final HttpTimeoutProperties timeouts;

    public DeepSeekClient(DeepSeekProperties properties,
                          HttpTimeoutProperties timeouts,
                          ObjectMapper objectMapper) {
        this.properties = properties;
        this.timeouts = timeouts;
        this.objectMapper = objectMapper;
        this.shortTimeoutClient = buildClient(timeouts.getReadTimeoutShortMs());
        this.longTimeoutClient = buildClient(timeouts.getReadTimeoutLongMs());
    }

    private RestClient buildClient(int readTimeoutMs) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(timeouts.getConnectTimeoutMs()));
        factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
        return RestClient.builder()
                .baseUrl(properties.getBaseUrl())
                .requestFactory(factory)
                .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + properties.getApiKey())
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .build();
    }

    /**
     * 以 JSON Mode 发起对话，返回模型输出的 JSON 字符串（尚未做业务 Schema 校验）。
     *
     * @param systemPrompt 固定的英语语法分析系统 Prompt（§7）
     * @param userText     用户选中的原文，用于动态选择读超时
     */
    public String chatJson(String systemPrompt, String userText) {
        // 用 LinkedHashMap 而非 Map.of：需要按开关决定是否下发 thinking 字段
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", properties.getModel());
        body.put("messages", List.of(
                Map.of("role", "system", "content", systemPrompt),
                Map.of("role", "user", "content", userText)));
        // JSON Mode：确保输出为合法 JSON 对象；但不保证符合业务 Schema（§4.3）
        body.put("response_format", Map.of("type", "json_object"));
        body.put("temperature", 0.2);
        if (!properties.isThinkingEnabled()) {
            // 非思考模式（§3.1）。实测该字段生效：2.2s / 360 completion
            // vs 默认 effort=high 的 6.0s / 955 completion，输出结构不受影响
            body.put("thinking", Map.of("type", "disabled"));
        }

        RestClient client = userText.length() > timeouts.getLongTextThreshold()
                ? longTimeoutClient : shortTimeoutClient;

        String rawResponse;
        try {
            rawResponse = client.post()
                    .uri(CHAT_PATH)
                    .body(body)
                    .retrieve()
                    .body(String.class);
        } catch (ResourceAccessException e) {
            // 连接失败 / 读写超时：网络类错误，映射 5003
            throw new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "无法连接大模型服务", e);
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            if (status == 401 || status == 403) {
                // 鉴权失败不是重试能解决的问题，按内部配置异常处理（5004）
                log.warn("DeepSeek 鉴权失败, status={}", status);
                throw new ModelServiceException(ErrorCode.INTERNAL_ERROR, "大模型服务鉴权失败", e);
            }
            // 429 限流、5xx 服务端错误等：5003
            log.warn("DeepSeek 返回非成功状态, status={}", status);
            throw new ModelServiceException(ErrorCode.MODEL_NETWORK_ERROR, "大模型服务响应异常", e);
        }

        return extractContent(rawResponse);
    }

    /** 从 OpenAI 协议响应中取 choices[0].message.content */
    private String extractContent(String rawResponse) {
        try {
            JsonNode root = objectMapper.readTree(rawResponse == null ? "" : rawResponse);
            JsonNode content = root.path("choices").path(0).path("message").path("content");
            if (!content.isString() || content.asString().isBlank()) {
                throw new ModelServiceException(ErrorCode.TRANSLATION_UNAVAILABLE, "大模型响应缺少 content", null);
            }
            return content.asString();
        } catch (ModelServiceException e) {
            throw e;
        } catch (Exception e) {
            throw new ModelServiceException(ErrorCode.TRANSLATION_UNAVAILABLE, "大模型响应结构不符合协议", e);
        }
    }
}
