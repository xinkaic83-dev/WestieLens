/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.exception;

import lombok.Getter;

/**
 * 大模型服务调用异常（网络故障/超时/限流/鉴权/响应结构异常）。
 * 按 §4.3 约定：此类错误不做盲目重复请求，由全局处理器映射统一错误码。
 */
@Getter
public class ModelServiceException extends RuntimeException {

    private final ErrorCode errorCode;

    public ModelServiceException(ErrorCode errorCode, String detail, Throwable cause) {
        super(detail, cause);
        this.errorCode = errorCode;
    }
}
