# WestieLens 公开仓库与镜像

本项目使用独立的 GPLv3 首发 Git 历史，默认分支 main，不导入私有开发仓库的提交或远程引用。

| 远程名 | 规划地址 | 职责 |
|---|---|---|
| origin | git@github.com:xinkaic83-dev/WestieLens.git | 主开发、Issues、PR、Actions |
| gitee | git@gitee.com:wttcxk/westie-lens.git | 国内访问镜像 |

远端地址需由仓库创建后的页面确认；配置 remote 不代表创建或推送成功。两个新仓库选择 Public/公开空仓库，不自动生成 README、LICENSE 或 .gitignore。不要修改原来的私有开发仓库可见性。

## 同步

先推 GitHub，再推 Gitee；两个推送分别验证。不使用强推或 --mirror。

```bash
git push -u origin main
git push gitee main
# 版本标签按需推送
git push origin v0.1.0-beta.1
git push gitee v0.1.0-beta.1
```

新仓库使用项目局部的 GitHub noreply 提交邮箱；不改变全局 Git 身份。首次只有一个 GPLv3 根提交，不导入旧仓库对象或标签。

不提交真实密钥、本地配置、node_modules、构建目录、IDE 或 AI 工具状态。安装包/源码归档放在版本发布附件中，发布源码需与对应提交一致。

## 验证

```bash
git status
git log --oneline
git rev-list --all --count
git ls-remote origin refs/heads/main
git ls-remote gitee refs/heads/main
```

首发时独立历史应只有一个根提交；两边 main 指向相同提交。新仓库 GitHub Actions 的结果必须在新仓库单独确认，Gitee 不执行 GitHub Actions。
