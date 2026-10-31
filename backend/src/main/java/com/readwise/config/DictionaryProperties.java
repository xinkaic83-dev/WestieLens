/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 词典数据源配置（说明书 §4.4 / §11.2）：Free Dictionary API，免费无需 Key。
 * 词典属于"可有可无"的主数据源，超时设得比大模型更短，失败即转入 AI 兜底，
 * 不能因为词典慢而拖住整个查词请求。
 */
@Data
@Component
@ConfigurationProperties(prefix = "dictionary")
public class DictionaryProperties {

    /** 词条接口前缀，实际请求 {base-url}/{word} */
    private String baseUrl = "https://api.dictionaryapi.dev/api/v2/entries/en";

    private int connectTimeoutMs = 5000;

    /** 词典读超时：独立于分析链路的大模型超时，取较短值 */
    private int readTimeoutMs = 8000;
}
