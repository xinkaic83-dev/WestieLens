/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * 单词查询响应（说明书 §6.2）。
 * source 取值 dictionary / ai_fallback；
 * phoneticSource 取值 dictionary / ai_generated / unavailable，
 * 词典不可用时默认音标返回空值并标记 unavailable（§4.4 / R7）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class WordDetailDTO {

    private String word;
    private String phoneticUk;
    private String phoneticUs;
    private String audioUkUrl;
    private String audioUsUrl;
    private List<Definition> definitions;
    private String source;
    private String phoneticSource;
    private boolean fallbackTts;
    private boolean cached;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Definition {
        /** 词性缩写，如 n. / v. */
        private String pos;
        private String meaning;
    }
}
