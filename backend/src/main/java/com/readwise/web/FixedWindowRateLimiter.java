/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.web;

import java.time.Clock;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 固定窗口限流器（说明书 §4.6.1）。
 * 单机、单进程场景下不需要 Redis 或 Bucket4j：本地后端只服务一个扩展客户端，
 * 这里用"按分钟分桶 + 原子计数"就足够拦住异常高频调用。
 * 时间来自注入的 Clock，便于单测构造窗口边界。
 */
public class FixedWindowRateLimiter {

    /** 超过该 key 规模才做一次过期清理，避免每次请求都遍历 */
    private static final int CLEANUP_THRESHOLD = 1024;

    private final int permitsPerWindow;
    private final long windowMillis;
    private final Clock clock;
    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();

    public FixedWindowRateLimiter(int permitsPerWindow, long windowMillis, Clock clock) {
        if (permitsPerWindow <= 0) {
            throw new IllegalArgumentException("permitsPerWindow must be positive");
        }
        this.permitsPerWindow = permitsPerWindow;
        this.windowMillis = windowMillis;
        this.clock = clock;
    }

    /**
     * 尝试获取一个配额。
     *
     * @return true 表示放行；false 表示当前窗口配额已用尽
     */
    public boolean tryAcquire(String key) {
        long now = clock.millis();
        long windowStart = now - (now % windowMillis);

        Window window = windows.compute(key, (k, existing) ->
                existing == null || existing.startMillis != windowStart ? new Window(windowStart) : existing);

        // 同一个 Window 对象上同步，保证"读计数 → 判定 → 自增"是原子的
        synchronized (window) {
            if (window.count >= permitsPerWindow) {
                return false;
            }
            window.count++;
        }

        if (windows.size() > CLEANUP_THRESHOLD) {
            windows.entrySet().removeIf(entry -> entry.getValue().startMillis != windowStart);
        }
        return true;
    }

    private static final class Window {
        private final long startMillis;
        private int count;

        private Window(long startMillis) {
            this.startMillis = startMillis;
        }
    }
}
