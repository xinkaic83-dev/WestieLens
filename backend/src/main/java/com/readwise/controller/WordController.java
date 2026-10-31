/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.controller;

import com.readwise.dto.WordDetailDTO;
import com.readwise.service.WordService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 单词查询接口（说明书 §6.2）。
 * 该接口只负责查词/短语，不承担句子结构分析（§4.1.3）。
 * text 参数由 Spring 完成 URL 解码；非空、长度与字符校验在 Service 中按错误码表执行（§6.1）。
 */
@RestController
@RequestMapping("/api/english")
@RequiredArgsConstructor
public class WordController {

    private final WordService wordService;

    /** GET /api/english/word?text=development */
    @GetMapping("/word")
    public WordDetailDTO word(@RequestParam String text) {
        return wordService.lookup(text);
    }
}
