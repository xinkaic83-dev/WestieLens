/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.web;

import com.readwise.config.RateLimitProperties;
import com.readwise.dto.ErrorResponseDTO;
import com.readwise.exception.ErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.time.Clock;

/**
 * /api/** 请求频率限制（说明书 §4.6.1 安全边界 / 风险 R6）。
 *
 * <p>为什么需要：后端只监听 127.0.0.1 并不等于安全。任何本机网页都能向回环地址发请求，
 * 一次误触或一个循环脚本就能把 DeepSeek 额度烧光。
 *
 * <p>来源校验不在本 Filter 内重复实现：{@link com.readwise.config.CorsConfig} 已通过
 * Spring MVC 的 CORS 拦截器对带 Origin 的请求做来源白名单校验，
 * 不匹配时返回 403（CORS 只是浏览器侧控制，不作为鉴权手段）。
 *
 * <p>限流按"客户端地址 + Origin"聚合：同一台机器上不同扩展/页面互不影响，
 * 这样既拦住异常高频调用，也不会让调试时的 curl 把正常使用挤掉。
 */
@Slf4j
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RateLimitFilter extends OncePerRequestFilter {

    private static final String API_PREFIX = "/api/";
    private static final long WINDOW_MILLIS = 60_000L;

    private final RateLimitProperties properties;
    private final FixedWindowRateLimiter limiter;
    private final ObjectMapper objectMapper;

    public RateLimitFilter(RateLimitProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.limiter = new FixedWindowRateLimiter(properties.getPermitsPerMinute(), WINDOW_MILLIS, Clock.systemUTC());
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !properties.isEnabled() || !request.getRequestURI().startsWith(API_PREFIX);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        if (limiter.tryAcquire(clientKey(request))) {
            filterChain.doFilter(request, response);
            return;
        }
        log.warn("触发请求频率限制: {} {}", request.getMethod(), request.getRequestURI());
        response.setStatus(429);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(new ErrorResponseDTO(
                ErrorCode.RATE_LIMITED.getCode(),
                ErrorCode.RATE_LIMITED.getMessage(),
                ErrorCode.RATE_LIMITED.isRetryable())));
    }

    private String clientKey(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        return request.getRemoteAddr() + "|" + (origin == null ? "-" : origin);
    }
}
