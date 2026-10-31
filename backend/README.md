# Java 后端参考实现

当前插件已改为用户在侧边栏配置密钥、Background 直连官方 API；使用插件不需要启动本模块。

本模块原创代码随当前项目采用 [GPL-3.0-only](../LICENSE)；Maven 依赖保留各自许可证。旧版许可记录见项目 Git 历史。

本模块保留原有 Spring Boot 分层、模型输出校验、词典归一化、Caffeine 缓存、限流和单元测试，供独立研究或后续服务端方案参考。插件当前不向这些接口发请求。

```bash
export DEEPSEEK_API_KEY='你的密钥'
cd backend
mvn test
mvn spring-boot:run
```

仅监听 `127.0.0.1:8080`。本机 `application-local.yml` 可覆盖配置，禁止提交真实密钥。此处的环境变量不会自动配置浏览器插件；插件密钥需在侧边栏填写。
