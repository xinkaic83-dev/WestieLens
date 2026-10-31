/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.dto;

/**
 * 统一错误响应体（说明书 §4.7）：{ code, message, retryable }
 */
public record ErrorResponseDTO(int code, String message, boolean retryable) {
}
