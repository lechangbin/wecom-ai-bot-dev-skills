# 企业微信智能机器人开发 Skills

这个仓库存放企业微信智能机器人开发相关的 Codex skills。

当前包含：

- `skills/wecom-message-fetch`：通过企业微信智能机器人消息 MCP 权限获取单聊/群聊消息，支持近 7 天查询、群名/群 ID 定位、`AT`/`NON_AT` 统计、`mixed` 消息展开、JSON 输出和可选发送测试。

## 使用方式

把 skill 目录复制到本机 Codex skills 目录：

```powershell
Copy-Item -Recurse -Force .\skills\wecom-message-fetch C:\Users\a1825\.codex\skills\
```

也可以直接运行 skill 自带脚本：

```powershell
node .\skills\wecom-message-fetch\scripts\fetch_messages.mjs --chat-name "测试群" --hours 168 --mention "@智能机器人"
```

## 凭证

不要提交真实 `Bot Secret`。在运行目录创建 `.env`：

```text
WECOM_BOT_ID=your_bot_id
WECOM_BOT_SECRET=your_bot_secret
```

脚本会自动读取当前工作目录的 `.env`，也支持 PowerShell 环境变量：

```powershell
$env:WECOM_BOT_ID="your_bot_id"
$env:WECOM_BOT_SECRET="your_bot_secret"
```

## 校验

```powershell
python -X utf8 C:\Users\a1825\.codex\skills\.system\skill-creator\scripts\quick_validate.py .\skills\wecom-message-fetch
node --check .\skills\wecom-message-fetch\scripts\fetch_messages.mjs
```
