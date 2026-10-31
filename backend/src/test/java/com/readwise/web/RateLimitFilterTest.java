/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.web;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 限流 Filter 的接口级验证（§4.6.1 / R6）。
 * 配额调到 2，第三个请求必须拿到 429 与统一错误体 { code: 4290, retryable: true }。
 * 用会立即失败的请求（缺 text 参数）消耗配额，避免触发真实大模型调用。
 */
@SpringBootTest(properties = {
        "deepseek.api-key=test-key-for-rate-limit-tests",
        "rate-limit.permits-per-minute=2"
})
@AutoConfigureMockMvc
class RateLimitFilterTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void thirdRequestShouldBeRateLimited() throws Exception {
        mockMvc.perform(get("/api/english/word")).andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/english/word")).andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/english/word"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value(4290))
                .andExpect(jsonPath("$.retryable").value(true))
                .andExpect(jsonPath("$.message").isNotEmpty());
    }
}
