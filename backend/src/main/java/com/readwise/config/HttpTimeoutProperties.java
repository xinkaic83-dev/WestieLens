/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * HTTP 超时配置（说明书 §4.2 / §11.2）：
 * Connect 固定 5s；Read 按文本长度动态选择 ≤100 字符 15s、>100 字符 45s。
 */
@Data
@Component
@ConfigurationProperties(prefix = "http")
public class HttpTimeoutProperties {

    private int connectTimeoutMs = 5000;

    private int readTimeoutShortMs = 15000;

    private int readTimeoutLongMs = 45000;

    /** 长文本阈值：超过则使用长读超时（保障长难句分析不超时） */
    private int longTextThreshold = 100;
}
