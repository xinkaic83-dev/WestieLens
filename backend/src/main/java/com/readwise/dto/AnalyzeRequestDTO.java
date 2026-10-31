/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.List;

/**
 * 句子/短语分析请求（说明书 §6.1）。
 * <p>
 * 校验约定：
 * <ul>
 *   <li>text 非空（@NotBlank），trim 后长度 1-500 由 Service 校验并映射 4001；</li>
 *   <li>inputType 只允许 word / analysis / auto（缺省按 auto），白名单校验映射 4003；</li>
 *   <li>features 只允许已登记功能值，可为空或部分，未知值映射 4003。</li>
 * </ul>
 * record 的 @NotBlank 会触发 JSON 反序列化阶段的校验（与 @Valid 配合），
 * 反序列化失败/字段缺失同样由全局处理器映射为 4003。
 */
public record AnalyzeRequestDTO(

        @NotBlank(message = "text 不能为空")
        String text,

        String inputType,

        List<String> features
) {
}
