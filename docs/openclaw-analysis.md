# OpenClaw 구현 분석 — agent-for-work P6 참고용

> 분석 대상: OpenClaw v? (bundled dist)
> 소스 위치: `/Users/hyo/.local/share/mise/installs/node/24.14.0/lib/node_modules/openclaw/dist/`
> 분석일: 2026-03-05

---

## 1. 메시지 메타데이터 주입

### 관련 소스
- `reply-DhtejUNZ.js` — `buildInboundUserContextPrefix()` (line ~84959)
- `inbound-context-D4jdbLFJ.js` — `finalizeInboundContext()`
- `chat-envelope-CjZ3-rvQ.js` — `stripInboundMetadata()`, sentinel 정의

### 핵심 패턴

OpenClaw은 유저 메시지 본문 **앞에** JSON 메타데이터 블록을 prepend하여 LLM에 전달한다.

```typescript
function buildInboundUserContextPrefix(ctx) {
  const blocks = [];

  // 1. Conversation info 블록
  const conversationInfo = {
    message_id: resolvedMessageId,
    reply_to_id: safeTrim(ctx.ReplyToId),
    sender_id: safeTrim(ctx.SenderId),
    conversation_label: isDirect ? undefined : safeTrim(ctx.ConversationLabel),
    sender: safeTrim(ctx.SenderName) ?? safeTrim(ctx.SenderId),
    timestamp: timestampStr,
    group_subject: safeTrim(ctx.GroupSubject),
    is_group_chat: !isDirect ? true : undefined,
    was_mentioned: ctx.WasMentioned === true ? true : undefined,
    history_count: ctx.InboundHistory?.length || undefined,
    // ... 더 많은 필드
  };
  blocks.push([
    "Conversation info (untrusted metadata):",
    "```json",
    JSON.stringify(conversationInfo, null, 2),
    "```"
  ].join("\n"));

  // 2. Sender info 블록
  const senderInfo = {
    label: resolveSenderLabel({ name, username, tag, e164, id }),
    id, name, username, tag, e164
  };
  blocks.push([
    "Sender (untrusted metadata):",
    "```json",
    JSON.stringify(senderInfo, null, 2),
    "```"
  ].join("\n"));

  // 3. Reply context, forwarded context, thread starter, chat history 등
  // ... 각각 별도 블록으로 추가

  return blocks.join("\n\n");
}
```

**실제로 LLM에 전달되는 user 메시지 형태:**
```
Conversation info (untrusted metadata):
```json
{
  "message_id": "12345",
  "sender": "John",
  "is_group_chat": true,
  "was_mentioned": true,
  "timestamp": "2026-03-05T01:00:00+09:00"
}
```

Sender (untrusted metadata):
```json
{
  "label": "John (@john_doe)",
  "id": "123456789",
  "name": "John",
  "username": "john_doe"
}
```

안녕 클로, 날씨 어때?
```

### UI 표시 시 메타데이터 제거

`stripInboundMetadata()` 함수로 저장된 메시지에서 메타데이터를 제거하여 사용자에게는 원본 텍스트만 보여준다.

```typescript
const INBOUND_META_SENTINELS = [
  "Conversation info (untrusted metadata):",
  "Sender (untrusted metadata):",
  "Thread starter (untrusted, for context):",
  "Replied message (untrusted, for context):",
  "Forwarded message context (untrusted metadata):",
  "Chat history since last reply (untrusted, for context):"
];
```

### 보안 처리

`sanitizeInboundSystemTags()` — 유저가 `[System Message]` 같은 태그를 보내서 시스템 메시지를 위장하는 것을 방지:
```typescript
function sanitizeInboundSystemTags(input) {
  return input
    .replace(/\[\s*(System\s*Message|System|...)\s*\]/gi, (_, tag) => `(${tag})`)
    .replace(/^(\s*)System:(?=\s|$)/gim, "$1System (untrusted):");
}
```

### agent-for-work 적용 포인트

1. **메타데이터를 user message에 inline으로 주입** — 별도 system prompt보다 user 메시지 앞에 붙이는 것이 컨텍스트 윈도우 관리에 유리
2. **"untrusted" 라벨링** — prompt injection 방지를 위해 모든 유저 데이터에 untrusted 라벨 필수
3. **JSON + markdown fence 형식** — LLM이 structured data를 잘 파싱하면서도 자연어와 혼재 가능
4. **DM vs Group 분기** — DM에서는 sender_id 등 불필요한 정보 생략
5. **Strip 함수 구현** — 저장/표시 시 메타데이터 제거 로직 필요

---

## 2. NO_REPLY / 응답 억제

### 관련 소스
- `tokens-DgYNpQOp.js` — `SILENT_REPLY_TOKEN`, `HEARTBEAT_TOKEN`, `isSilentReplyText()`
- `reply-DhtejUNZ.js` — 응답 처리 파이프라인 (line ~83230, ~83960)
- System prompt 빌더 (line ~34892)

### 핵심 패턴

**토큰 정의:**
```typescript
const HEARTBEAT_TOKEN = "HEARTBEAT_OK";
const SILENT_REPLY_TOKEN = "NO_REPLY";
```

**판별 함수:**
```typescript
function isSilentReplyText(text, token = "NO_REPLY") {
  // 정확히 토큰만 있는지 (공백 허용)
  return /^\s*NO_REPLY\s*$/.test(text);
}

function isSilentReplyPrefixText(text, token = "NO_REPLY") {
  // 스트리밍 중 부분 매칭 (e.g. "NO_", "NO_RE")
  const normalized = text.trimStart().toUpperCase();
  if (!normalized.includes("_")) return false;
  if (/[^A-Z_]/.test(normalized)) return false;
  return token.toUpperCase().startsWith(normalized);
}
```

**시스템 프롬프트에서의 가이드:**
```
## Silent Replies
When you have nothing to say, respond with ONLY: NO_REPLY

⚠️ Rules:
- It must be your ENTIRE message — nothing else
- Never append it to an actual response
- Never wrap it in markdown or code blocks

❌ Wrong: "Here's help... NO_REPLY"
✅ Right: NO_REPLY
```

**스트리밍 중 처리 (핵심 로직):**
```typescript
const normalizeStreamingText = (payload) => {
  let text = payload.text;

  // 1. Heartbeat 아닌데 HEARTBEAT_OK 포함 → strip
  if (!params.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
    const stripped = stripHeartbeatToken(text, { mode: "message" });
    if (stripped.shouldSkip) return { skip: true };
    text = stripped.text;
  }

  // 2. 정확히 NO_REPLY만 → skip
  if (isSilentReplyText(text, "NO_REPLY")) return { skip: true };

  // 3. 스트리밍 중 NO_REPLY 시작 prefix → skip
  if (isSilentReplyPrefixText(text, "NO_REPLY") ||
      isSilentReplyPrefixText(text, "HEARTBEAT_OK"))
    return { skip: true };

  // 4. 빈 텍스트 (미디어 없으면) → skip
  if (!text && (payload.mediaUrls?.length ?? 0) === 0)
    return { skip: true };

  return { text: sanitizeUserFacingText(text), skip: false };
};
```

**Post-processing (최종 페이로드 빌더):**
```typescript
// buildReplyPayloads에서 heartbeat 토큰 제거
params.payloads.flatMap((payload) => {
  if (!text || !text.includes("HEARTBEAT_OK")) return [{ ...payload, text }];
  const stripped = stripHeartbeatToken(text, { mode: "message" });
  if (stripped.shouldSkip && !hasMedia) return []; // 완전 제거
  return [{ ...payload, text: stripped.text }];
})
```

### `stripHeartbeatToken` 동작

```typescript
function stripHeartbeatToken(raw, opts) {
  const trimmed = raw.trim();
  // 정확히 HEARTBEAT_OK만 → shouldSkip: true
  if (/^\s*HEARTBEAT_OK\s*$/.test(trimmed))
    return { text: "", didStrip: true, shouldSkip: true };
  // 뒤에 붙은 HEARTBEAT_OK 제거
  // ... trailing regex로 strip
}
```

### agent-for-work 적용 포인트

1. **2개의 억제 토큰** — `NO_REPLY` (일반 무응답)와 `HEARTBEAT_OK` (하트비트 ack) 분리
2. **스트리밍 중 prefix 매칭** — LLM이 `NO_R`까지 출력했을 때 이미 억제 판단 시작 (사용자에게 깜빡임 방지)
3. **미디어 첨부 시 예외** — 텍스트가 NO_REPLY여도 미디어가 있으면 전송
4. **시스템 프롬프트에 명확한 규칙** — LLM이 올바르게 사용하도록 예시 포함
5. **Stray token strip** — 하트비트가 아닌데 HEARTBEAT_OK이 포함되면 자동 제거
6. **message tool 사용 후 NO_REPLY** — LLM이 `message` tool로 직접 보낸 경우, 중복 방지를 위해 NO_REPLY로 응답하도록 유도

---

## 3. 이미지 비전 (멀티모달)

### 관련 소스
- `tool-images-BCnln0pJ.js` (= `tool-images-BWPsBENR.js`) — 이미지 sanitization, resize
- `audio-transcription-runner-BoyUdfw0.js` — `normalizeAttachments()`, media 파이프라인
- `reply-DhtejUNZ.js` — `applyMediaUnderstanding()` (line ~1414), LLM content block 변환 (line ~73712)
- `image-BfgjMXod.js` — minimax VLM, `extractImageContentFromSource()`

### 인바운드 미디어 처리 파이프라인

```
채널 (Telegram/Discord/...) → InboundContext (MediaPath/MediaUrl/MediaType)
  → normalizeAttachments() → [{path, url, mime, index}]
  → resolveAttachmentKind() → "image" | "video" | "audio" | "document"
  → createMediaAttachmentCache() → getBuffer()로 lazy 로드
  → applyMediaUnderstanding() → 오디오 트랜스크립션, 이미지 이해 등
  → LLM content block으로 변환
```

### LLM 전달 형식 — base64 content block

```typescript
// pi-ai 내부 포맷 (Anthropic 호환)
{
  type: "image",
  data: "<base64 encoded>",
  mimeType: "image/jpeg"
}

// OpenAI API 변환 시 (contentToOpenAIParts)
{
  type: "input_image",
  source: {
    type: "base64",
    media_type: "image/jpeg",
    data: "<base64>"
  }
}
```

### 이미지 Sanitization & Resize

```typescript
const MAX_IMAGE_DIMENSION_PX = 1200;  // default
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;  // 5MB

async function sanitizeContentBlocksImages(blocks, label, opts) {
  for (const block of blocks) {
    if (!isImageBlock(block)) continue;

    // 1. base64 유효성 검증
    const canonical = canonicalizeBase64(block.data);
    if (!canonical) { /* omit */ continue; }

    // 2. MIME 추론 (매직 바이트)
    const mimeType = inferMimeTypeFromBase64(canonical) ?? block.mimeType;

    // 3. 리사이즈 (크기/바이트 초과 시)
    const resized = await resizeImageBase64IfNeeded({
      base64: canonical,
      mimeType,
      maxDimensionPx: 1200,
      maxBytes: 5 * 1024 * 1024,
    });

    out.push({ ...block, data: resized.base64, mimeType: resized.mimeType });
  }
}
```

**리사이즈 전략:**
```typescript
// side grid (최대 → 최소) × quality steps로 조합 탐색
const sideGrid = buildImageResizeSideGrid(maxDimensionPx, sideStart);
for (const side of sideGrid)
  for (const quality of IMAGE_REDUCE_QUALITY_STEPS) {
    const out = await resizeToJpeg({ buffer, maxSide: side, quality });
    if (out.byteLength <= maxBytes) return result;
  }
```

### 인바운드 파일(문서) 처리

이미지가 아닌 파일(PDF, 텍스트 등)은 XML 태그로 감싸서 텍스트로 주입:
```typescript
blocks.push(
  `<file name="${safeName}" mime="${mimeType}">\n${blockText}\n</file>`
);
```

### agent-for-work 적용 포인트

1. **base64가 표준** — URL 참조가 아닌 base64로 LLM에 전달 (모든 프로바이더 호환)
2. **자동 리사이즈** — 1200px/5MB 한도로 자동 축소 (비용+속도 최적화)
3. **MIME 추론** — 파일 확장자가 아닌 base64 매직 바이트로 실제 타입 감지
4. **문서는 텍스트 추출** — PDF/CSV 등은 텍스트로 변환 후 `<file>` 태그로 주입
5. **`MediaAttachmentCache`** — lazy loading으로 필요할 때만 파일 읽기
6. **provider별 변환** — 내부 `{type:"image", data, mimeType}` → OpenAI/Anthropic 포맷 변환

---

## 4. 파일 첨부 (아웃바운드)

### 관련 소스
- `deliver-DCtqEVTU.js` — `splitMediaFromOutput()`, `MEDIA_TOKEN_RE`
- `send-BfbOwTR-.js` — Telegram 미디어 전송 (`sendPhoto`, `sendDocument` 등)
- `outbound-attachment-CH5rNucc.js` — `resolveOutboundAttachmentFromUrl()`
- `reply-DhtejUNZ.js` — message tool의 `send` action (line ~21960)

### 핵심 패턴: MEDIA: 토큰

LLM은 응답 텍스트에 `MEDIA:` 토큰을 포함시켜 파일을 첨부한다:

```
여기 요청하신 이미지입니다.
MEDIA:/path/to/image.png
```

**파싱 로직:**
```typescript
const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^\n]+)`?/gi;

function splitMediaFromOutput(raw) {
  const media = [];
  const keptLines = [];

  for (const line of lines) {
    if (!line.trimStart().startsWith("MEDIA:")) {
      keptLines.push(line);
      continue;
    }
    // MEDIA: 토큰에서 URL/경로 추출
    const matches = Array.from(line.matchAll(MEDIA_TOKEN_RE));
    for (const match of matches) {
      const candidate = normalizeMediaSource(cleanCandidate(match[1]));
      if (isValidMedia(candidate)) media.push(candidate);
    }
  }

  return {
    text: keptLines.join("\n").trim(),
    mediaUrls: media,
    mediaUrl: media[0],
  };
}
```

### `message` tool을 통한 직접 전송

LLM은 `message` tool의 `send` action으로 직접 파일을 보낼 수도 있다:
```typescript
// tool 파라미터
const mediaHint = readStringParam(params, "media")
  ?? readStringParam(params, "path")
  ?? readStringParam(params, "filePath");
```

### Telegram 전송 — MIME 기반 자동 분기

```typescript
const mediaSender = (() => {
  if (isGif) return { label: "animation", sender: api.sendAnimation };
  if (kind === "image") return { label: "photo", sender: api.sendPhoto };
  if (kind === "video") {
    if (isVideoNote) return { sender: api.sendVideoNote };
    return { sender: api.sendVideo };
  }
  if (kind === "audio") {
    if (useVoice) return { sender: api.sendVoice };
    return { sender: api.sendAudio };
  }
  return { label: "document", sender: api.sendDocument };
})();
```

### 보안: 경로 제한

시스템 프롬프트에서 안내:
```
To send an image back, prefer the message tool (media/path/filePath).
If you must inline, use MEDIA:https://example.com/image.jpg or MEDIA:./image.jpg
Avoid absolute paths (MEDIA:/...) and ~ paths — they are blocked for security.
```

### agent-for-work 적용 포인트

1. **2가지 경로** — 응답 텍스트의 `MEDIA:` 토큰 파싱 OR `message` tool의 media 파라미터
2. **MEDIA: 토큰 파싱** — 코드블록 내부는 무시, 따옴표/backtick 처리, 공백 포함 경로 지원
3. **MIME 기반 자동 분기** — image→sendPhoto, audio→sendVoice/Audio, etc.
4. **Sandbox 경로 정규화** — sandbox 내부 경로를 호스트 경로로 변환 (`normalizeSandboxMediaList`)
5. **보안** — 절대경로, 홈 디렉토리 접근 차단
6. **TTS 자동 변환** — `[[audio_as_voice]]` 태그로 음성 메시지 전송 가능

---

## 5. 디버그 로깅

### 관련 소스
- `globals-DyWRcjQY.js` — `logVerbose()`, `shouldLogVerbose()`
- `subsystem-BfkFJ4uQ.js` — `createSubsystemLogger()`
- `logging-BmVZU1jn.js` — config logging

### 아키텍처

OpenClaw은 **2-tier 로깅 시스템**을 사용한다:

#### Tier 1: Verbose Console Logging
```typescript
function logVerbose(message) {
  if (!shouldLogVerbose()) return;
  // 파일 로그에도 기록
  try { getLogger().debug({ message }, "verbose"); } catch {}
  // 콘솔에도 출력 (--verbose 플래그 시)
  if (!globalVerbose) return;
  console.log(theme.muted(message));
}

function shouldLogVerbose() {
  return globalVerbose || isFileLogLevelEnabled("debug");
}
```

메시지 흐름의 주요 지점에서 호출:
```typescript
logVerbose(`telegram inbound: chatId=${chatId} from=${from} len=${body.length} preview="${preview}"`);
logVerbose(`media: file attachment skipped (unsupported mime ${mimeType})`);
logVerbose("Stripped stray HEARTBEAT_OK token from reply");
```

#### Tier 2: Structured Subsystem Logger
```typescript
function createSubsystemLogger(subsystem) {
  const emit = (level, message, meta) => {
    const consoleEnabled = shouldLogToConsole(level, consoleSettings);
    const fileEnabled = isFileLogLevelEnabled(level);

    if (fileEnabled) logToFile(getFileLogger(), level, message, meta);
    if (consoleEnabled) console.log(formatForConsole(level, message));
  };

  return {
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
    debug: (msg, meta) => emit("debug", msg, meta),
    child: (name) => createChildLogger(subsystem, name),
  };
}

// 사용 예:
const log = createSubsystemLogger("agents/tool-images");
log.info(`Image resized: ${sourcePixels} ${sourceBytes} -> ${outputBytes}`, {
  label, fileName, sourceWidth, sourceHeight, outputBytes, ...
});
```

#### 파일 로그

```typescript
const DEFAULT_LOG_DIR = resolvePreferredOpenClawTmpDir();
const DEFAULT_LOG_FILE = path.join(DEFAULT_LOG_DIR, "openclaw.log");
const MAX_LOG_AGE_MS = 1440 * 60 * 1000;  // 24시간
const DEFAULT_MAX_LOG_FILE_BYTES = 500 * 1024 * 1024;  // 500MB

// Rolling log — 날짜별 파일
function defaultRollingPathForToday() { /* openclaw-2026-03-05.log */ }
```

#### 아웃바운드 로깅 (correlation ID)

```typescript
const correlationId = generateSecureUuid();
const logger = getChildLogger({
  module: "web-outbound",
  correlationId,
  to: redactedTo
});
logger.info({ jid: redactedJid, hasMedia }, "sending message");
// ... 작업 수행 ...
logger.info({ jid: redactedJid, messageId }, "sent message");
```

### 프라이버시 보호

아웃바운드 로깅에서 식별자를 redact:
```typescript
const redactedTo = redactIdentifier(to);
const redactedJid = redactIdentifier(jid);
```

### agent-for-work 적용 포인트

1. **2-tier 구조** — 간단한 `logVerbose()`와 구조화된 `subsystemLogger` 분리
2. **Correlation ID** — 메시지 흐름 추적을 위한 UUID 기반 correlation
3. **Rolling file log** — 날짜별 자동 로테이션, 크기 제한
4. **PII Redaction** — 로그에 식별자 기록 시 자동 마스킹
5. **Level 기반 필터링** — console과 file 로그 레벨 독립 설정
6. **`shouldLogVerbose()` 가드** — 성능을 위해 로그 메시지 생성 전 체크

---

## 요약: 아키텍처 패턴

| 항목 | OpenClaw 패턴 | agent-for-work 적용 |
|------|--------------|-------------------|
| 메타데이터 주입 | User message에 JSON 블록 prepend | 동일 패턴 사용, `(untrusted)` 라벨 필수 |
| 응답 억제 | `NO_REPLY` / `HEARTBEAT_OK` 토큰 + regex 매칭 | 시스템 프롬프트에 규칙 명시 + 스트리밍 prefix 체크 |
| 이미지 비전 | base64 content block + 자동 리사이즈 | base64 표준, 1200px/5MB 제한 |
| 파일 첨부 | `MEDIA:` 토큰 파싱 + message tool | MEDIA: 파싱 + 전용 tool 양쪽 지원 |
| 디버그 로깅 | 2-tier (verbose + structured) + correlation ID | 동일 패턴, PII redaction 포함 |

### 핵심 교훈

1. **메타데이터는 user role에** — system prompt이 아닌 user message에 인라인으로 넣어야 대화별로 달라지는 정보를 자연스럽게 전달 가능
2. **스트리밍 중 억제 판단** — `NO_R` 같은 prefix 단계에서 이미 억제를 시작해야 사용자에게 깜빡임 없음
3. **이미지는 항상 정규화** — 크기 제한, MIME 검증, base64 정규화를 거치지 않으면 LLM API 에러 발생
4. **2가지 파일 전송 경로** — 텍스트 내 토큰과 도구 호출 양쪽을 지원해야 LLM이 유연하게 선택 가능
5. **보안 first** — 모든 유저 입력에 untrusted 라벨, 시스템 태그 spoofing 방지, 경로 접근 제한
