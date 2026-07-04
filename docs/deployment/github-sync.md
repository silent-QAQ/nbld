# GitHub HTTPS Auto Sync

目标仓库：

```text
https://github.com/silent-QAQ/nbld.git
```

## 一次性配置

设置 Git 用户信息：

```bash
cd /nbld
git config user.name "your-name"
git config user.email "your-email@example.com"
```

启用凭证保存：

```bash
git config --global credential.helper store
```

首次手动推送一次：

```bash
cd /nbld
HTTPS_PROXY=http://127.0.0.1:7890 \
HTTP_PROXY=http://127.0.0.1:7890 \
git push -u origin main
```

GitHub 会提示输入：

- Username: GitHub 用户名
- Password: GitHub Personal Access Token

不要输入 GitHub 登录密码，输入 `PAT`。

首次成功后，凭证会保存到：

```text
~/.git-credentials
```

## 自动同步脚本

脚本：

```text
/nbld/scripts/git_auto_sync.sh
```

默认行为：

- 远端：`https://github.com/silent-QAQ/nbld.git`
- 分支：`main`
- 代理：`http://127.0.0.1:7890`

手动执行：

```bash
bash /nbld/scripts/git_auto_sync.sh
```

## 定时任务

示例：

```bash
crontab /nbld/scripts/git_auto_sync.cron.example
```

默认每 15 分钟执行一次。

## 可选环境变量

```bash
NBLD_GIT_REMOTE_URL
NBLD_GIT_REMOTE_NAME
NBLD_GIT_BRANCH
NBLD_GIT_COMMIT_PREFIX
NBLD_GIT_HTTPS_PROXY
```
