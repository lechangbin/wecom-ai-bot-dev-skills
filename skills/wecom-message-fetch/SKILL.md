---
name: wecom-message-fetch
description: Use when Codex needs to fetch, inspect, summarize, debug, or classify Enterprise WeChat/WeCom AI Bot chat messages, including group messages, non-@ messages, AT/NON_AT counts, get_msg_chat_list, get_message, send_message, Bot ID/Secret, MCP message permissions, or long-connection mode.
---

# WeCom Message Fetch

## Overview

Use the bundled Node.js script to fetch WeCom AI Bot messages through the message MCP permission. The script handles Bot ID/Secret signing, `.env` loading, chat discovery, `get_message` pagination, `mixed` message text extraction, and AT/NON_AT classification.

## Quick Start

1. Ensure the working directory has either environment variables or a `.env` file:

```text
WECOM_BOT_ID=your_bot_id
WECOM_BOT_SECRET=your_bot_secret
```

2. Run the bundled script from the user's project/workspace directory:

```powershell
node C:\Users\a1825\.codex\skills\wecom-message-fetch\scripts\fetch_messages.mjs --chat-name "测试群" --hours 168 --mention "@智能机器人"
```

3. Use JSON when another agent or script will consume the result:

```powershell
node C:\Users\a1825\.codex\skills\wecom-message-fetch\scripts\fetch_messages.mjs --chat-name "测试群" --hours 168 --mention "@智能机器人" --json
```

## Workflow

Use this sequence for message retrieval tasks:

1. Verify credentials are available without printing the secret.
2. If chat ID is unknown, call `--list-only` or use `--chat-name`.
3. Query at most 168 hours because `get_message` supports only recent 7 days.
4. Pass an exact `--mention` token when AT/NON_AT counts matter. If omitted, any text containing `@` is classified as AT.
5. Print or return all messages by default. Use `--non-at-only` only when the user explicitly asks to filter.
6. For `mixed` messages, trust the script's expanded content: it combines text segments and summarizes image/file media IDs.

## Commands

| Task | Command |
|---|---|
| List candidate group chats | `node ...\fetch_messages.mjs --list-only --hours 24` |
| Fetch by group name | `node ...\fetch_messages.mjs --chat-name "工作同步群" --hours 24 --mention "@智能机器人"` |
| Fetch by chat ID | `node ...\fetch_messages.mjs --chat-id "wrxxxx" --chat-type 2 --hours 168` |
| Emit JSON | Add `--json` |
| Print only non-@ messages | Add `--non-at-only` |
| Send a text test message first | Add `--send-text "测试消息"` |

Run `node C:\Users\a1825\.codex\skills\wecom-message-fetch\scripts\fetch_messages.mjs --help` for the full option list.

## Output Contract

Terminal output includes:

```text
chat_name=测试群
chat_id=wr...
chat_type=2
counts total=5 at=2 non_at=3 printed=5
#1 [NON_AT] time="..." userid="..." msgtype="text" content="..."
#2 [AT] time="..." userid="..." msgtype="mixed" content="[mixed] @智能机器人 | [image] media_id=... | 哈喽"
```

JSON output includes `chat`, `begin_time`, `end_time`, `mention_filter`, `total_count`, `at_count`, `non_at_count`, `returned_count`, and annotated `messages`.

## Common Mistakes

- Do not change the `MISSING_REQUIRED` code; it means `WECOM_BOT_ID` or `WECOM_BOT_SECRET` was not found in process env or `.env`.
- Do not print the secret or access token in final answers or logs.
- Do not assume `mixed` messages are NON_AT. Mentions can appear inside mixed text segments.
- Do not query more than 7 days; use `--hours 168` for the maximum window.
- Do not use `send_message` unless the user asks for a send test.

## References

For MCP tool argument notes and response details, read `references/message-mcp.md` only when needed.
