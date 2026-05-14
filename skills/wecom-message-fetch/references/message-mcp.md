# WeCom Message MCP Notes

## Tools

`get_msg_chat_list`

- Purpose: list internal group chats with messages in a time range.
- Arguments: `begin_time`, `end_time`, usually `YYYY-MM-DD HH:mm:ss` in Asia/Shanghai time.
- Use this when only a group name is known.

`get_message`

- Purpose: fetch messages for a chat.
- Arguments: `chat_type`, `chatid`, `begin_time`, `end_time`, optional `cursor`.
- Practical limits: recent 7 days only. Use `--hours 168` for a full supported window.
- `chat_type=2` is group chat. `chat_type=1` is single chat when a direct chat ID is known.

`send_message`

- Purpose: send text to a chat.
- Use only when the user explicitly wants a send test or notification.
- Text payload size is limited to 2048 bytes.

## Authentication

The CLI MCP config endpoint is:

```text
https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_mcp_config
```

Request signing:

```text
signature = sha256_hex(secret + bot_id + unix_seconds + nonce)
```

The bundled script implements this. Do not expose Bot Secret in output.

## Classification

The skill classifies a message as `AT` when the extracted text contains any mention token.

- Default token: `@`
- Preferred token: exact robot mention, for example `@智能机器人`
- For `mixed` messages, concatenate text segments for classification.
- Media-only messages usually classify as `NON_AT` unless adjacent mixed text contains the mention.

## Debugging

If the script says `Missing required value: WECOM_BOT_ID`, check:

1. Current shell env: PowerShell uses `$env:WECOM_BOT_ID`.
2. Project root `.env` exists and contains `WECOM_BOT_ID=...`.
3. The command is being run from the directory containing `.env`.

If the API returns `unsupported mcp biz type` or `846609`, the bot likely lacks the `msg` permission.
