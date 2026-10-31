/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.config;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.readwise.dto.AnalyzeResponseDTO;
import com.readwise.dto.WordDetailDTO;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * 有界缓存容器（说明书 §4.5）：查词缓存与分析缓存分开，互不挤占。
 * 直接使用 Caffeine 而不挂 Spring Cache 注解，是为了让 cached 标记和
 * "哪些结果允许写缓存"的判定留在业务代码里可控（例如 partial 降级结果不缓存）。
 */
@Configuration
@RequiredArgsConstructor
public class CacheConfig {

    private final CacheProperties properties;

    /** key = 单词/短语小写形式 */
    @Bean
    public Cache<String, WordDetailDTO> wordCache() {
        return baseCache().build();
    }

    /** key = 原文 SHA-256 + features 列表 */
    @Bean
    public Cache<String, AnalyzeResponseDTO> analysisCache() {
        return baseCache().build();
    }

    private Caffeine<Object, Object> baseCache() {
        return Caffeine.newBuilder()
                .maximumSize(properties.getMaxSize())
                .expireAfterWrite(Duration.ofHours(properties.getTtlHours()));
    }
}
