/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.web;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 固定窗口限流器单测（§4.6.1 / R6）：覆盖配额耗尽、跨窗口重置、key 隔离。
 */
class FixedWindowRateLimiterTest {

    private static final long WINDOW_MILLIS = 60_000L;

    @Test
    void shouldBlockAfterQuotaExhausted() {
        MutableClock clock = new MutableClock();
        FixedWindowRateLimiter limiter = new FixedWindowRateLimiter(3, WINDOW_MILLIS, clock);

        assertThat(limiter.tryAcquire("client")).isTrue();
        assertThat(limiter.tryAcquire("client")).isTrue();
        assertThat(limiter.tryAcquire("client")).isTrue();
        assertThat(limiter.tryAcquire("client")).isFalse();
    }

    @Test
    void shouldResetInNextWindow() {
        MutableClock clock = new MutableClock();
        FixedWindowRateLimiter limiter = new FixedWindowRateLimiter(1, WINDOW_MILLIS, clock);

        assertThat(limiter.tryAcquire("client")).isTrue();
        assertThat(limiter.tryAcquire("client")).isFalse();

        clock.advance(Duration.ofMillis(WINDOW_MILLIS));
        assertThat(limiter.tryAcquire("client")).isTrue();
    }

    @Test
    void shouldIsolateDifferentKeys() {
        FixedWindowRateLimiter limiter = new FixedWindowRateLimiter(1, WINDOW_MILLIS, new MutableClock());

        assertThat(limiter.tryAcquire("a")).isTrue();
        assertThat(limiter.tryAcquire("b")).isTrue();
        assertThat(limiter.tryAcquire("a")).isFalse();
    }

    @Test
    void shouldRejectNonPositiveQuota() {
        assertThatThrownBy(() -> new FixedWindowRateLimiter(0, WINDOW_MILLIS, new MutableClock()))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /** 可控时钟：让窗口边界不依赖真实时间 */
    private static final class MutableClock extends Clock {
        private Instant instant = Instant.parse("2026-10-26T12:00:00Z");

        void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }
}
