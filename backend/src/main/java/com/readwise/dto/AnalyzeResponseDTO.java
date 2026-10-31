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
 * 句子分析响应（说明书 §6.1）。
 * partial / cached 必须始终返回布尔值：
 * partial=true 表示翻译成功但结构分析不可用（HTTP 仍为 200，结构字段为空数组）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AnalyzeResponseDTO {

    private String text;
    private String translation;
    private String mainSentence;
    private List<Clause> clauses;
    private List<SyntaxComponent> syntaxComponents;
    private List<GrammarPoint> grammarPoints;
    private boolean partial;
    private boolean cached;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class Clause {
        private String text;
        private String type;
        private String label;
        private String explanation;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class SyntaxComponent {
        private String text;
        private String component;
        private String label;
        private String explanation;
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class GrammarPoint {
        private String name;
        private String text;
        private String explanation;
    }
}
