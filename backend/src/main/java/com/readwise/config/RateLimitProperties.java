/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 请求频率限制配置（说明书 §4.6.1 / 风险 R6）。
 * 本地后端只监听回环地址并不等于安全：网页仍可能意外触发或恶意触发，
 * 从而消耗 DeepSeek 额度，因此需要按客户端做限流。
 */
@Data
@Component
@ConfigurationProperties(prefix = "rate-limit")
public class RateLimitProperties {

    /** 关闭后 Filter 直接放行，便于本地压测/调试 */
    private boolean enabled = true;

    /** 每个客户端每分钟允许的请求数 */
    private int permitsPerMinute = 30;
}
