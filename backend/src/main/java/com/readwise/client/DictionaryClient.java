/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.client;

import com.readwise.config.DictionaryProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.Duration;
import java.util.Optional;

/**
 * Free Dictionary API 客户端（说明书 §4.4 / §11.1）。
 * 词典是"尽力而为"的主数据源：超时、连接失败、404/502 未命中、结构异常
 * 全部返回 Optional.empty() 交给上层转 AI 兜底，不把外部故障透传成 5xx，
 * 避免一次词典抖动就让整个查词失败。
 */
@Slf4j
@Component
public class DictionaryClient {

    private final DictionaryProperties properties;
    private final DictionaryEntryParser parser;
    private final RestClient restClient;

    public DictionaryClient(DictionaryProperties properties, DictionaryEntryParser parser) {
        this.properties = properties;
        this.parser = parser;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofMillis(properties.getConnectTimeoutMs()));
        factory.setReadTimeout(Duration.ofMillis(properties.getReadTimeoutMs()));
        this.restClient = RestClient.builder().requestFactory(factory).build();
    }

    /**
     * @param word 已 trim 的原文；内部转小写请求，短语请用空格连接（会做 URL 编码）
     */
    public Optional<DictionaryEntry> lookup(String word) {
        if (word == null || word.isBlank()) {
            return Optional.empty();
        }
        String query = word.trim().toLowerCase();
        var uri = UriComponentsBuilder.fromUriString(properties.getBaseUrl())
                .pathSegment(query)
                .build()
                .encode()
                .toUri();
        try {
            String body = restClient.get().uri(uri).retrieve().body(String.class);
            Optional<DictionaryEntry> entry = parser.parse(body);
            if (entry.isEmpty()) {
                log.info("词典未命中或数据不可用: {}", query);
            }
            return entry;
        } catch (RestClientResponseException e) {
            // 未命中词条该接口返回 404，限流/故障返回 5xx：都按不可用处理
            log.info("词典接口返回非成功状态, word={}, status={}", query, e.getStatusCode().value());
            return Optional.empty();
        } catch (Exception e) {
            log.info("词典接口调用失败, word={}, reason={}", query, e.getMessage());
            return Optional.empty();
        }
    }
}
