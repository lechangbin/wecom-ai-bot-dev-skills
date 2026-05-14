#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';

const DEFAULT_MCP_CONFIG_ENDPOINT =
  'https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_mcp_config';

class WeComMcpError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'WeComMcpError';
    this.code = options.code;
    this.payload = options.payload;
    this.cause = options.cause;
  }
}

async function main() {
  loadDotEnv();

  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const botId = process.env.WECOM_BOT_ID;
  const secret = process.env.WECOM_BOT_SECRET;
  const mentionTokens = normalizeMentionTokens([
    ...args.mention,
    process.env.WECOM_BOT_MENTION,
  ]);
  const { beginTime, endTime } = buildTimeWindow({
    beginTime: args.begin,
    endTime: args.end,
    hours: args.hours,
  });

  const client = new WeComMsgClient({
    botId,
    secret,
    endpoint: process.env.WECOM_MCP_CONFIG_ENDPOINT,
  });
  await client.init();

  log(`connected to msg MCP. time_window="${beginTime} ~ ${endTime}"`);

  const chat = await resolveChat(client, args, beginTime, endTime);
  if (args.listOnly) {
    process.exit(0);
  }

  if (args.sendText) {
    const sendResult = await client.call('send_message', {
      chat_type: chat.chatType,
      chatid: chat.chatId,
      msgtype: 'text',
      text: { content: args.sendText },
    });
    log(`send_message finished: ${sendResult.errmsg || 'ok'}`);
  }

  const messages = await fetchMessages(client, {
    chatType: chat.chatType,
    chatId: chat.chatId,
    beginTime,
    endTime,
    pages: args.pages,
    cursor: args.cursor,
  });

  const summary = summarizeMessagesForDebug(messages, mentionTokens);
  const outputMessages = args.nonAtOnly
    ? summary.messages.filter((message) => message.at_status === 'NON_AT')
    : summary.messages;

  const result = {
    chat,
    begin_time: beginTime,
    end_time: endTime,
    mention_filter: mentionTokens,
    total_count: summary.total_count,
    at_count: summary.at_count,
    non_at_count: summary.non_at_count,
    returned_count: outputMessages.length,
    messages: outputMessages,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResult(result, args.nonAtOnly);
  }
}

async function resolveChat(client, options, beginTime, endTime) {
  const requestedChatType = Number(options.chatType || 2);
  if (options.chatId) {
    return {
      chatId: options.chatId,
      chatName: options.chatName || options.chatId,
      chatType: requestedChatType,
      source: 'argument',
    };
  }

  const list = await client.call('get_msg_chat_list', {
    begin_time: beginTime,
    end_time: endTime,
  });
  const chats = list.chats || [];

  if (chats.length === 0) {
    throw new WeComMcpError('No readable internal group chats were found in this time window.', {
      code: 'NO_CHATS',
      payload: list,
    });
  }

  if (options.listOnly) {
    printChatList(chats);
    return {
      chatId: '',
      chatName: '',
      chatType: requestedChatType,
      source: 'list_only',
    };
  }

  if (!options.chatName) {
    printChatList(chats);
    const first = chats[0];
    log(`no --chat-id/--chat-name provided; using latest chat: ${first.chat_name}`);
    return {
      chatId: first.chat_id,
      chatName: first.chat_name,
      chatType: 2,
      source: 'first_chat',
    };
  }

  const exact = chats.filter((chat) => chat.chat_name === options.chatName);
  const fuzzy = chats.filter((chat) => chat.chat_name?.includes(options.chatName));
  const matches = exact.length > 0 ? exact : fuzzy;

  if (matches.length === 0) {
    printChatList(chats);
    throw new WeComMcpError(`No chat matched --chat-name "${options.chatName}".`, {
      code: 'CHAT_NOT_FOUND',
    });
  }

  if (matches.length > 1) {
    printChatList(matches);
    throw new WeComMcpError('Multiple chats matched. Use --chat-id to choose one.', {
      code: 'AMBIGUOUS_CHAT',
    });
  }

  return {
    chatId: matches[0].chat_id,
    chatName: matches[0].chat_name,
    chatType: 2,
    source: exact.length > 0 ? 'exact_name' : 'fuzzy_name',
  };
}

async function fetchMessages(client, { chatType, chatId, beginTime, endTime, pages, cursor }) {
  const messages = [];
  let nextCursor = cursor || undefined;
  const pageCount = Math.max(Number(pages) || 1, 1);

  for (let page = 0; page < pageCount; page += 1) {
    const result = await client.call('get_message', {
      chat_type: Number(chatType),
      chatid: chatId,
      begin_time: beginTime,
      end_time: endTime,
      ...(nextCursor ? { cursor: nextCursor } : {}),
    });

    messages.push(...(result.messages || []));
    nextCursor = result.next_cursor || '';
    if (!nextCursor) {
      break;
    }
  }

  return messages;
}

function summarizeMessagesForDebug(messages, mentionTokens = ['@']) {
  const annotated = messages.map((message, index) => ({
    index: index + 1,
    at_status: atStatus(message, mentionTokens),
    userid: message.userid || '',
    send_time: message.send_time || '',
    msgtype: message.msgtype || '',
    content: messageDebugContent(message),
    raw: message,
  }));

  const atCount = annotated.filter((message) => message.at_status === 'AT').length;

  return {
    total_count: annotated.length,
    at_count: atCount,
    non_at_count: annotated.length - atCount,
    messages: annotated,
  };
}

function atStatus(message, mentionTokens = ['@']) {
  return isNonAtMessage(message, mentionTokens) ? 'NON_AT' : 'AT';
}

function isNonAtMessage(message, mentionTokens = ['@']) {
  const content = messageText(message);
  if (!content) {
    return true;
  }

  const tokens = mentionTokens.filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  return !tokens.some((token) => content.includes(token));
}

function messageText(message) {
  if (message?.msgtype === 'text') {
    return message.text?.content ?? '';
  }

  if (message?.msgtype === 'mixed') {
    return (message.mixed?.items || [])
      .filter((item) => item.type === 'text')
      .map((item) => item.text?.content ?? '')
      .join('');
  }

  return '';
}

function messageDebugContent(message) {
  const type = message?.msgtype || 'unknown';
  if (type === 'text') {
    return messageText(message);
  }
  if (type === 'mixed') {
    const items = message?.mixed?.items || [];
    const parts = items.map((item) => mixedItemDebugContent(item)).filter(Boolean);
    return parts.length > 0 ? `[mixed] ${parts.join(' | ')}` : '[mixed]';
  }

  const item = message?.[type] || {};
  const parts = [`[${type}]`];
  if (item.name) {
    parts.push(item.name);
  }
  if (item.media_id) {
    parts.push(`media_id=${item.media_id}`);
  }
  if (item.content) {
    parts.push(String(item.content));
  }
  return parts.join(' ');
}

function mixedItemDebugContent(item) {
  const type = item?.type || 'unknown';
  if (type === 'text') {
    return (item.text?.content ?? '').trim();
  }

  const body = item?.[type] || {};
  const parts = [`[${type}]`];
  if (body.name) {
    parts.push(body.name);
  }
  if (body.media_id) {
    parts.push(`media_id=${body.media_id}`);
  }
  if (body.content) {
    parts.push(String(body.content));
  }
  return parts.join(' ');
}

class WeComMsgClient {
  constructor({ botId, secret, endpoint, fetchImpl } = {}) {
    this.botId = botId;
    this.secret = secret;
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.mcpUrl = null;
  }

  async init() {
    const list = await fetchMcpConfig({
      botId: this.botId,
      secret: this.secret,
      endpoint: this.endpoint,
      fetchImpl: this.fetchImpl,
    });
    this.mcpUrl = findMcpUrl(list, 'msg');
    return this;
  }

  async call(method, args, options = {}) {
    if (!this.mcpUrl) {
      await this.init();
    }

    const rpc = await callMcpTool({
      mcpUrl: this.mcpUrl,
      method,
      args,
      timeoutMs: options.timeoutMs,
      fetchImpl: this.fetchImpl,
    });
    return extractToolJson(rpc);
  }
}

async function fetchMcpConfig({
  botId,
  secret,
  endpoint = DEFAULT_MCP_CONFIG_ENDPOINT,
  bindSource = 1,
  fetchImpl = globalThis.fetch,
} = {}) {
  assertRequired('WECOM_BOT_ID', botId);
  assertRequired('WECOM_BOT_SECRET', secret);

  const time = Math.floor(Date.now() / 1000);
  const nonce = generateReqId('mcp');
  const signature = signMcpConfig(secret, botId, time, nonce);
  const body = {
    bot_id: botId,
    time,
    nonce,
    signature,
    bind_source: bindSource,
    cli_version: getUserAgent(),
  };

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': getUserAgent(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new WeComMcpError(`MCP config request failed: HTTP ${response.status}`, {
      code: response.status,
      payload: await safeResponseText(response),
    });
  }

  const payload = await response.json();
  if (payload.errcode && payload.errcode !== 0) {
    throw new WeComMcpError(payload.errmsg || 'MCP config request returned an error', {
      code: payload.errcode,
      payload,
    });
  }

  if (!Array.isArray(payload.list)) {
    throw new WeComMcpError('MCP config response does not contain a list', { payload });
  }

  return payload.list;
}

function findMcpUrl(configList, bizType = 'msg') {
  const item = configList.find((entry) => entry?.biz_type === bizType);
  if (!item?.url) {
    throw new WeComMcpError(
      `Current bot did not return ${bizType} MCP config; confirm the bot has msg permission.`,
      { code: 'MISSING_BIZ_TYPE', payload: configList },
    );
  }
  return item.url;
}

async function callMcpTool({
  mcpUrl,
  method,
  args = {},
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  assertRequired('mcpUrl', mcpUrl);
  assertRequired('method', method);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(mcpUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': getUserAgent(),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: generateReqId('mcp_rpc'),
        method: 'tools/call',
        params: {
          name: method,
          arguments: args,
        },
      }),
    });

    if (!response.ok) {
      throw new WeComMcpError(`MCP tool request failed: HTTP ${response.status}`, {
        code: response.status,
        payload: await safeResponseText(response),
      });
    }

    const payload = await response.json();
    const rpcCode = payload?.error?.code;
    if (rpcCode && rpcCode !== 0) {
      throw new WeComMcpError(`MCP JSON-RPC error: ${rpcCode}`, {
        code: rpcCode,
        payload,
      });
    }
    if (payload?.result?.isError === true) {
      throw new WeComMcpError('MCP tool returned isError=true', { payload });
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new WeComMcpError(`MCP tool request timed out after ${timeoutMs}ms`, {
        code: 'TIMEOUT',
        cause: error,
      });
    }
    if (error instanceof WeComMcpError) {
      throw error;
    }
    throw new WeComMcpError(`MCP tool request failed: ${error.message}`, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function extractToolJson(rpcPayload) {
  const content = rpcPayload?.result?.content;
  if (!Array.isArray(content) || content.length !== 1 || content[0]?.type !== 'text') {
    throw new WeComMcpError('Unexpected MCP tool response shape', { payload: rpcPayload });
  }

  let parsed;
  try {
    parsed = JSON.parse(content[0].text);
  } catch (error) {
    throw new WeComMcpError('MCP tool text content is not JSON', {
      payload: content[0].text,
      cause: error,
    });
  }

  if (parsed.errcode && parsed.errcode !== 0) {
    throw new WeComMcpError(parsed.errmsg || 'WeCom business error', {
      code: parsed.errcode,
      payload: parsed,
    });
  }

  return parsed;
}

function loadDotEnv(envPath = '.env', targetEnv = process.env) {
  if (!fs.existsSync(envPath)) {
    return [];
  }

  const loadedKeys = [];
  const content = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^(?:export\s+)?([^=]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1].trim();
    const value = unquoteEnvValue(match[2].trim());
    if (!key || targetEnv[key]) {
      continue;
    }

    targetEnv[key] = value;
    loadedKeys.push(key);
  }

  return loadedKeys;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function buildTimeWindow({ beginTime, endTime, hours = 24, now = new Date() } = {}) {
  if (beginTime && endTime) {
    return { beginTime, endTime };
  }

  const safeHours = Math.min(Math.max(Number(hours) || 24, 1), 24 * 7);
  const end = endTime ? new Date(endTime.replace(' ', 'T') + '+08:00') : now;
  const begin = beginTime
    ? new Date(beginTime.replace(' ', 'T') + '+08:00')
    : new Date(end.getTime() - safeHours * 60 * 60 * 1000);

  return {
    beginTime: formatBeijingTime(begin),
    endTime: formatBeijingTime(end),
  };
}

function formatBeijingTime(date) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function signMcpConfig(secret, botId, time, nonce) {
  return sha256Hex(`${secret}${botId}${time}${nonce}`);
}

function generateReqId(prefix = 'mcp') {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

function getUserAgent() {
  return `WeComMessageFetchSkill/1.0 node/${process.version} ${process.platform}/${process.arch}`;
}

function normalizeMentionTokens(tokens) {
  const normalized = tokens
    .flatMap((token) => String(token ?? '').split(','))
    .map((token) => token.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : ['@'];
}

function printResult(result, nonAtOnly) {
  const label = nonAtOnly ? 'NON_AT messages' : 'All messages';
  console.log('');
  console.log(`chat_name=${result.chat.chatName}`);
  console.log(`chat_id=${result.chat.chatId}`);
  console.log(`chat_type=${result.chat.chatType}`);
  console.log(`time_window="${result.begin_time} ~ ${result.end_time}"`);
  console.log(`mention_tokens=${result.mention_filter.map((item) => `"${item}"`).join(', ')}`);
  console.log(
    `counts total=${result.total_count} at=${result.at_count} non_at=${result.non_at_count} printed=${result.returned_count}`,
  );
  console.log('');
  console.log(`${label}:`);

  if (result.messages.length === 0) {
    console.log('  (no messages)');
    return;
  }

  for (const message of result.messages) {
    console.log(
      `#${message.index} [${message.at_status}] time="${message.send_time || '<no time>'}" userid="${message.userid || '<unknown>'}" msgtype="${message.msgtype || '<unknown>'}" content="${escapeOneLine(message.content)}"`,
    );
  }
}

function printChatList(chats) {
  console.log('');
  console.log('candidate chats:');
  for (const chat of chats.slice(0, 20)) {
    console.log(
      `- ${chat.chat_name} | chat_id=${chat.chat_id} | last=${chat.last_msg_time} | count=${chat.msg_count}`,
    );
  }
  if (chats.length > 20) {
    console.log(`... ${chats.length - 20} more chats not shown`);
  }
  console.log('');
}

function escapeOneLine(value) {
  return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function parseArgs(argv) {
  const parsed = {
    mention: [],
    pages: 1,
    hours: 24,
    chatType: 2,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${token}`);
      }
      return argv[index];
    };

    switch (token) {
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--chat-id':
        parsed.chatId = next();
        break;
      case '--chat-name':
        parsed.chatName = next();
        break;
      case '--chat-type':
        parsed.chatType = Number(next());
        break;
      case '--begin':
        parsed.begin = next();
        break;
      case '--end':
        parsed.end = next();
        break;
      case '--hours':
        parsed.hours = Number(next());
        break;
      case '--cursor':
        parsed.cursor = next();
        break;
      case '--pages':
        parsed.pages = Number(next());
        break;
      case '--mention':
        parsed.mention.push(next());
        break;
      case '--send-text':
        parsed.sendText = next();
        break;
      case '--non-at-only':
        parsed.nonAtOnly = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--list-only':
        parsed.listOnly = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node fetch_messages.mjs [options]

Environment:
  WECOM_BOT_ID       Required. WeCom AI Bot ID.
  WECOM_BOT_SECRET   Required. WeCom AI Bot Secret.
  WECOM_BOT_MENTION  Optional. Bot mention token, for example "@智能机器人".

Options:
  --chat-name <name>       Find a group chat by name from get_msg_chat_list.
  --chat-id <id>           Use a known chat ID directly.
  --chat-type <1|2>        1=single chat, 2=group chat. Default: 2.
  --begin <time>           "YYYY-MM-DD HH:mm:ss". Must be within recent 7 days.
  --end <time>             "YYYY-MM-DD HH:mm:ss".
  --hours <n>              Default time window when begin/end omitted. Default: 24, max: 168.
  --mention <token>        Token that marks a message as AT. Can be repeated. Default: "@".
  --pages <n>              Number of message pages to fetch. Default: 1.
  --cursor <cursor>        Start from a message cursor.
  --send-text <content>    Optional send_message test before reading messages.
  --non-at-only            Print only NON_AT messages. Default prints all messages.
  --json                   Print machine-readable JSON.
  --list-only              Only print chats from get_msg_chat_list.

Examples:
  node fetch_messages.mjs --chat-name "测试群" --hours 168 --mention "@智能机器人"
  node fetch_messages.mjs --chat-id wrxxxx --chat-type 2 --json
`);
}

function log(message) {
  console.error(`[wecom-message-fetch] ${message}`);
}

function handleError(error) {
  if (error instanceof WeComMcpError) {
    console.error(`[wecom-message-fetch] ${error.message}`);
    if (error.code !== undefined) {
      console.error(`[wecom-message-fetch] code=${error.code}`);
    }
    if (error.code === 846609 || String(error.message).includes('unsupported mcp biz type')) {
      console.error('[wecom-message-fetch] msg permission may not be enabled for this bot.');
    }
    if (process.env.DEBUG_WECOM_MESSAGE_FETCH === '1' && error.payload) {
      console.error(JSON.stringify(error.payload, null, 2));
    }
    process.exit(1);
  }

  console.error(`[wecom-message-fetch] ${error.message}`);
  process.exit(1);
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function assertRequired(name, value) {
  if (value === undefined || value === null || value === '') {
    throw new WeComMcpError(`Missing required value: ${name}`, { code: 'MISSING_REQUIRED' });
  }
}

main().catch(handleError);
