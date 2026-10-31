/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
package com.readwise.exception;

import com.readwise.dto.ErrorResponseDTO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理：所有错误统一输出 { code, message, retryable }（说明书 §4.7）。
 * retryable=true 映射 503，参数类错误映射 400，内部异常映射 500。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponseDTO> handleBusiness(BusinessException e) {
        return toErrorResponse(e.getErrorCode());
    }

    /** 大模型服务异常：按错误类型映射 5003/5004/5001，不做盲目重试（§4.3-3） */
    @ExceptionHandler(ModelServiceException.class)
    public ResponseEntity<ErrorResponseDTO> handleModelService(ModelServiceException e) {
        log.warn("大模型服务异常: {}", e.getMessage());
        return toErrorResponse(e.getErrorCode());
    }

    private ResponseEntity<ErrorResponseDTO> toErrorResponse(ErrorCode code) {
        HttpStatus status = code.isRetryable() ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_REQUEST;
        return ResponseEntity.status(status)
                .body(new ErrorResponseDTO(code.getCode(), code.getMessage(), code.isRetryable()));
    }

    /**
     * Bean Validation 失败（@NotBlank 等）、缺失参数、请求体不可读、
     * 以及 Content-Type 不是 application/json 的请求，统一映射为 4003（§6.1 / §4.6.1）。
     */
    @ExceptionHandler({MethodArgumentNotValidException.class, MissingServletRequestParameterException.class,
            HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    public ResponseEntity<ErrorResponseDTO> handleValidation(Exception e) {
        return ResponseEntity.badRequest()
                .body(new ErrorResponseDTO(
                        ErrorCode.INVALID_PARAMS.getCode(),
                        ErrorCode.INVALID_PARAMS.getMessage(),
                        ErrorCode.INVALID_PARAMS.isRetryable()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponseDTO> handleOther(Exception e) {
        return ResponseEntity.internalServerError()
                .body(new ErrorResponseDTO(
                        ErrorCode.INTERNAL_ERROR.getCode(),
                        ErrorCode.INTERNAL_ERROR.getMessage(),
                        ErrorCode.INTERNAL_ERROR.isRetryable()));
    }
}
