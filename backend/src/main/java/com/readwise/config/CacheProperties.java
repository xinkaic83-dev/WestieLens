/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 后端有界缓存配置（说明书 §4.5）：最大 1000 条、TTL 24 小时。
 * 明确不承诺严格的传统 LRU 淘汰顺序，只保证容量有界、条目会过期。
 */
@Data
@Component
@ConfigurationProperties(prefix = "cache")
public class CacheProperties {

    private int maxSize = 1000;

    private long ttlHours = 24;
}
