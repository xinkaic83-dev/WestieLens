/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.controller;

import com.readwise.dto.AnalyzeRequestDTO;
import com.readwise.service.AnalyzeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 句子语法分析接口（说明书 §6.1）。
 * v0.2 由 AnalyzeService 编排 DeepSeek 调用 + Schema 校验 + 重试与 partial 降级。
 */
@RestController
@RequestMapping("/api/english")
@RequiredArgsConstructor
public class AnalyzeController {

    private final AnalyzeService analyzeService;

    /**
     * POST /api/english/analyze
     * 路由结果为词时返回 WordDetailDTO，为句子/短语时返回 AnalyzeResponseDTO。
     */
    @PostMapping("/analyze")
    public Object analyze(@Valid @RequestBody AnalyzeRequestDTO request) {
        return analyzeService.analyze(request);
    }
}
