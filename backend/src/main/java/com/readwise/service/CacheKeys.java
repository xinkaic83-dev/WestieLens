/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;

/**
 * 缓存键生成（说明书 §4.5）。
 * 分析缓存键使用原文 SHA-256 而非明文，顺带满足 §4.6.1：
 * 不在进程内数据与日志里长期保留完整选区文本。
 */
public final class CacheKeys {

    private CacheKeys() {
    }

    /** 查词缓存 key = 单词/短语小写形式 */
    public static String wordKey(String text) {
        return text.trim().toLowerCase(Locale.ROOT);
    }

    /** 分析缓存 key = 原文 SHA-256 + features 列表 */
    public static String analysisKey(String text, List<String> features) {
        String joined = features == null || features.isEmpty() ? "-" : String.join(",", features);
        return sha256(text.trim()) + "|" + joined;
    }

    private static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 是 JDK 必备算法，正常不会走到这里
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }
}
