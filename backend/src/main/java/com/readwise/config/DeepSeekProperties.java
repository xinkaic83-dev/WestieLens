/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.config;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * DeepSeek 服务配置（说明书 §11.2 配置项清单）。
 * 模型名称集中在配置项管理，禁止散落硬编码（§4.3 / R5）。
 * api-key 通过环境变量 DEEPSEEK_API_KEY 注入，缺失时启动报错（§4.6）。
 */
@Data
@Component
@ConfigurationProperties(prefix = "deepseek")
public class DeepSeekProperties {

    /** OpenAI 兼容协议 base_url */
    private String baseUrl = "https://api.deepseek.com";

    /** 模型名以实现时官方模型列表为准（R5），当前基线 deepseek-flash 非思考模式 */
    private String model = "deepseek-flash";

    /** 密钥仅来自环境变量注入，默认空串占位，由启动校验拒绝 */
    private String apiKey = "";

    /**
     * 是否允许模型在回答前思考。默认关闭（说明书 §3.1 "非思考模式"）。
     * 实测 deepseek-flash 默认 effort=high 会产出约 600+ reasoning tokens：
     * 同一句分析从 2.2s 降到 6.0s、completion 从 360 涨到 955，对划词场景是不可接受的延迟。
     * 关闭思考后结构字段（clauses/syntaxComponents/grammarPoints）仍然完整且片段校验通过。
     */
    private boolean thinkingEnabled = false;

    @PostConstruct
    void validate() {
        if (apiKey == null || apiKey.isBlank() || apiKey.startsWith("${")) {
            throw new IllegalStateException(
                    "deepseek.api-key 未配置：请通过环境变量 DEEPSEEK_API_KEY 注入（禁止硬编码到代码或提交到 Git，见说明书 §4.6）");
        }
    }
}
