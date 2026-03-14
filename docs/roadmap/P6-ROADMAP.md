# P6 Roadmap — 응답 품질 & 런타임 제어

> 목표: LLM이 언제 응답하고 언제 침묵할지 정확히 판단하도록 + 불필요한 응답 억제

---

## 발견된 문제 (P5 슬랙 테스트)

### 확인된 버그
1. **멘션 받았는데 "not mentioned"로 판단** — LLM이 자기가 멘션된 건지 모름. `<@U봇ID>` 텍스트만 오는데 자기 ID가 뭔지 안 알려줌
2. **"조용히 하겠다"면서 그 텍스트를 슬랙에 보냄** — 응답 억제 메커니즘 없음. LLM이 뭘 반환하든 그대로 슬랙에 올라감

### 테스트 중 추가 발견 사항
> 주인님이 테스트하면서 발견하는 문제 여기에 추가

- [ ] (테스트 후 추가)

---

## Phase 1: 메시지 메타데이터 주입

**목표:** LLM이 멘션 여부, 채널/DM 구분, 스레드 여부를 정확히 인지

**구현 방안 (OpenClaw 패턴 채택):**
- 유저 메시지 본문 **앞에** JSON + markdown fence 블록을 prepend:
  ```
  Conversation info (untrusted metadata):
  ```json
  {
    "message_id": "12345",
    "sender": "John",
    "sender_id": "U0ABC123",
    "channel": "#dev",
    "channel_id": "C0AHPDVG7EF",
    "is_thread": false,
    "was_mentioned": true,
    "triggered_by": "app_mention"
  }
  ```

  Sender (untrusted metadata):
  ```json
  {
    "label": "John (@john_doe)",
    "id": "U0ABC123",
    "name": "John",
    "username": "john_doe"
  }
  ```

  안녕 뭐하고 있어?
  ```
- **핵심 설계 원칙:**
  - JSON + markdown fence 형식 — LLM이 structured data를 자연어와 혼재해도 잘 파싱
  - 모든 유저 데이터에 `(untrusted metadata)` 라벨 필수 (prompt injection 방어)
  - system prompt가 아닌 user message에 inline — 대화별로 달라지는 정보를 자연스럽게 전달
  - DM에서는 불필요한 필드(channel, is_thread 등) 생략
- 봇 멘션 텍스트 `<@U봇ID>` 는 메시지에서 제거 (중복 정보)
- **시스템 태그 spoofing 방지:** 유저가 `[System Message]` 같은 태그를 보내서 시스템 메시지를 위장하는 것을 방지하는 sanitize 함수 구현
  ```typescript
  function sanitizeInboundSystemTags(input: string): string {
    return input
      .replace(/\[\s*(System\s*Message|System)\s*\]/gi, (_, tag) => `(${tag})`)
      .replace(/^(\s*)System:(?=\s|$)/gim, "$1System (untrusted):");
  }
  ```
- 저장/표시 시 메타데이터 제거하는 `stripInboundMetadata()` 함수도 구현 (sentinel 문자열 기반)

**체크리스트:**
- [ ] `buildInboundContext()` — JSON 메타데이터 프리픽스 생성 함수
- [ ] DM vs 채널 분기 (DM은 sender만, 채널은 channel/thread/mention 포함)
- [ ] `<@U봇ID>` 텍스트 strip
- [ ] `sanitizeInboundSystemTags()` — prompt injection 방어
- [ ] `stripInboundMetadata()` — 저장/표시 시 메타데이터 제거
- [ ] 시스템 프롬프트에 메타데이터 형식 설명 추가
- [ ] 테스트: 멘션 메시지 → LLM이 `was_mentioned: true` 인지
- [ ] 테스트: 유저가 `[System Message]` 입력 → sanitize 되는지

## Phase 2: 응답 억제 (NO_REPLY)

**목표:** LLM이 "응답 안 함"을 선택할 수 있는 메커니즘

**구현 방안:**
- AGENTS.md 기본 템플릿에 규칙 추가:
  ```
  ## Silent Response
  If you determine no response is needed, reply with exactly: NO_REPLY
  Do not explain why you are silent. Just return NO_REPLY.
  ```
- 슬랙 핸들러에서 필터:
  - `NO_REPLY` → 슬랙에 안 보냄, 👀 리액션 제거
  - 빈 문자열 / whitespace only → 슬랙에 안 보냄
  - `HEARTBEAT_OK` → 슬랙에 안 보냄

**추가 고려사항 (OpenClaw 분석):**
- **미디어 예외:** 텍스트가 NO_REPLY여도 파일/이미지 첨부가 있으면 전송해야 함
- **스트리밍 prefix 매칭 (선택):** Pi SDK가 스트리밍 지원 시, `NO_R` 같은 부분 출력 단계에서 미리 억제 시작하면 UX 깜빡임 방지
- **message tool 후 NO_REPLY:** LLM이 `message` tool로 직접 보낸 경우, 중복 방지를 위해 NO_REPLY 반환 유도

**체크리스트:**
- [ ] `buildDefaultAgentsMd()`에 Silent Response 섹션 추가
- [ ] 시스템 프롬프트 템플릿에 NO_REPLY 규칙 추가 (예시 포함)
- [ ] 슬랙 응답 필터 구현 (NO_REPLY / HEARTBEAT_OK / 빈 응답 차단)
- [ ] 미디어 첨부 예외 처리 (텍스트=NO_REPLY + 미디어 있으면 → 미디어만 전송)
- [ ] 👀 리액션 제거 로직 (NO_REPLY 시)
- [ ] 테스트: LLM이 NO_REPLY 반환 → 슬랙 메시지 안 보냄
- [ ] 테스트: NO_REPLY + 이미지 첨부 → 이미지만 전송됨
- [ ] (후속) 메타코멘트("stays silent" 등)가 여전히 발생하면 정규식 필터 추가 검토

## Phase 3: 디버그 로깅 강화

**목표:** 테스트/디버깅 시 메시지 흐름 전체를 추적 가능하게

**현재 문제:**
- 로그에 `messageLength: 378` 만 찍힘 — 실제 내용 안 보임
- LLM 응답도 로그에 없음 → 문제 재현/분석 불가

**구현 방안:**
- `LOG_LEVEL=debug` 일 때:
  - 유저 → LLM 메시지 전문 (메타데이터 포함)
  - LLM → 슬랙 응답 전문
  - 응답 필터링 결과 (NO_REPLY 감지 등)
  - 시스템 프롬프트 (세션 최초 생성 시 1회)
- `LOG_LEVEL=info` (기본): 현재처럼 길이만

**체크리스트:**
- [ ] session.ts `handleMessage()`에서 debug 레벨 로깅 추가 (inbound message)
- [ ] LLM 응답 debug 로깅 (outbound response)
- [ ] 응답 필터 결과 로깅 (filtered=true/false, reason)
- [ ] 시스템 프롬프트 debug 로깅 (세션 생성 시)
- [ ] config.yaml에 `log.level: debug` 옵션 지원 확인

## Phase 4: 커스텀 툴 확장

**목표:** 에이전트에 웹검색/메모리 같은 추가 도구 제공

**현재 상태:**
- Pi SDK `codingTools` = read, write, edit, bash 만 제공
- 웹검색, URL fetch, 메모리 없음

### Phase 4a: 필수 툴 (이번 구현)

| 툴 | 설명 | 우선순위 |
|---|---|---|
| `web_search` | 웹 검색 (Brave Search API) | P0 |
| `web_fetch` | URL → 마크다운 추출 | P0 |
| `memory_read` | 에이전트 메모리 파일 읽기 | P0 |
| `memory_write` | 에이전트 메모리 파일 쓰기 | P0 |

**구현 방안:**
- Pi SDK `AgentTool` 인터페이스로 커스텀 툴 정의
- agent.json에서 사용할 도구 세트 선택 가능하게:
  ```json
  "tools": ["coding", "web_search", "web_fetch", "memory"]
  ```
- 기본값: `["coding"]` (기존 동작 유지)
- OpenClaw 구현 분석 → [tool-research.md](./tool-research.md) 참고

**체크리스트 (Phase 4a):**
- [ ] Pi SDK AgentTool 인터페이스 확인 및 커스텀 툴 타입 정의
- [ ] `web_search` 툴 구현 (Brave Search API, 키는 config.yaml)
- [ ] `web_fetch` 툴 구현 (URL → markdown 변환)
- [ ] `memory_read` / `memory_write` 툴 구현 (워크스페이스 내 memory/ 디렉토리)
- [ ] agent.json `tools` 필드 추가 + 툴 레지스트리에서 조합
- [ ] 시스템 프롬프트에 각 툴 사용법 가이드 추가
- [ ] 테스트: 에이전트가 웹검색 요청 → 결과 반환
- [ ] 테스트: 메모리 읽기/쓰기 → 파일 영속화

## Phase 5: 슬랙 파일 첨부

**목표:** 에이전트가 생성한 파일을 슬랙 응답에 첨부

**현재 문제:**
- 에이전트가 write로 워크스페이스에 파일 생성은 가능
- 하지만 슬랙에 파일을 보내는 방법이 없음 → "만들었습니다!" 하고 끝
- 유저는 파일을 볼 수 없음

**구현 방안 (MEDIA: 토큰 파싱 — OpenClaw 패턴 채택):**

~~기존안: 워크스페이스 diff로 자동 감지~~ → 복잡하고 오탐 리스크 있음

**새 접근: LLM이 응답에 `MEDIA:` 토큰을 포함시키면 파싱해서 첨부**
- LLM 응답 텍스트에서 `MEDIA:` 토큰 감지:
  ```
  여기 요청하신 파일입니다.
  MEDIA:/path/to/file.png
  ```
- 파싱 로직:
  ```typescript
  const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^\n]+?)`?\s*$/gim;

  function splitMediaFromOutput(raw: string) {
    const media: string[] = [];
    const keptLines: string[] = [];

    for (const line of raw.split("\n")) {
      if (line.trimStart().startsWith("MEDIA:")) {
        const matches = Array.from(line.matchAll(MEDIA_TOKEN_RE));
        for (const m of matches) media.push(m[1].trim());
      } else {
        keptLines.push(line);
      }
    }
    return { text: keptLines.join("\n").trim(), mediaUrls: media };
  }
  ```
- 슬랙 전송 시 `files.uploadV2`로 첨부 (MIME 기반 자동 분기)
- **코드블록 내부의 MEDIA: 는 무시** (예시 코드 오탐 방지)
- **보안:** 워크스페이스 내부 경로만 허용, 절대경로/상위 디렉토리 접근 차단

**보조 경로: message tool (Phase 5 커스텀 툴 구현 후)**
- LLM이 `message` tool의 `media`/`filePath` 파라미터로 직접 전송도 가능
- MEDIA: 토큰과 양쪽 지원하면 LLM이 유연하게 선택

**시스템 프롬프트 가이드:**
```
## 파일 첨부
워크스페이스에 파일을 생성한 후 슬랙에 보내려면:
MEDIA:./path/to/file.png

- 워크스페이스 내부 경로만 사용 (절대경로 금지)
- 한 줄에 하나의 MEDIA: 토큰
- 코드블록 안에서는 사용하지 마세요
```

**체크리스트:**
- [x] 봇 토큰 `files:write` 스코프 확인
- [x] `splitMediaFromOutput()` — MEDIA: 토큰 파싱 함수
- [x] 코드블록 내부 MEDIA: 무시 처리
- [x] 경로 보안 검증 (워크스페이스 내부만, `..` 차단)
- [x] MIME 기반 슬랙 전송 분기 (이미지→image, 기타→file)
- [x] `files.uploadV2`로 현재 채널/스레드에 업로드
- [x] 시스템 프롬프트에 MEDIA: 사용법 추가
- [x] 테스트: LLM이 MEDIA: 포함 응답 → 슬랙에 파일 첨부
- [ ] 테스트: 코드블록 안 MEDIA: → 무시됨

## Phase 6: 이미지 비전 (멀티모달 입력)

**목표:** 유저가 보낸 이미지를 LLM이 실제로 "볼 수 있게"

**현재 문제:**
- 이미지 다운로드 후 파일 경로만 텍스트로 LLM에 전달
- LLM이 read로 열면 바이너리 or HTML (슬랙 리다이렉트 페이지) → 내용 파악 불가
- 비전(멀티모달) API를 사용하고 있지 않음

**구현 방안 (OpenClaw 패턴 참고):**

처리 파이프라인:
```
슬랙 이벤트 → 파일 다운로드 (Bearer 토큰) → MIME 감지 → 리사이즈 → base64 → LLM content block
```

- **base64 content block이 표준** (URL 참조 아님 — 모든 프로바이더 호환):
  ```typescript
  // Pi SDK 내부 포맷
  { type: "image", data: "<base64>", mimeType: "image/jpeg" }

  // OpenAI API 호환 변환
  { type: "input_image", source: { type: "base64", media_type: "image/jpeg", data: "<base64>" } }
  ```

- **자동 리사이즈 (필수):** 원본 그대로 보내면 API 에러 or 토큰 낭비
  ```typescript
  const MAX_IMAGE_DIMENSION_PX = 1200;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

  async function resizeImageIfNeeded(buffer: Buffer, mimeType: string) {
    // side grid (큰→작은) × quality steps 조합 탐색
    // 1200px/5MB 이내가 될 때까지 축소
    // JPEG로 변환 (quality 단계별 시도)
  }
  ```

- **MIME 매직바이트 감지:** 파일 확장자가 아닌 base64 첫 바이트로 실제 타입 판별
  ```typescript
  function inferMimeTypeFromBuffer(buffer: Buffer): string | null {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return "image/jpeg";
    if (buffer.toString("ascii", 1, 4) === "PNG") return "image/png";
    if (buffer.toString("ascii", 0, 4) === "GIF8") return "image/gif";
    if (buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
    return null;
  }
  ```

- **비이미지 파일:** 텍스트 추출 후 XML 태그로 감싸서 주입
  ```typescript
  `<file name="${safeName}" mime="${mimeType}">\n${content}\n</file>`
  ```

- **Lazy loading:** 파일이 여러 개일 때 필요한 것만 다운로드 (MediaAttachmentCache 패턴)
- 지원 포맷: jpeg, png, gif, webp
- 다운로드 인증: `url_private` + `Authorization: Bearer xoxb-...` 헤더

**체크리스트:**
- [x] 슬랙 파일 다운로드 유틸 (`url_private` + Bearer 토큰)
- [x] `inferMimeType()` — 매직바이트 기반 MIME 감지
- [x] `resizeImageIfNeeded()` — 1200px/5MB 한도 자동 리사이즈 (sharp 또는 canvas)
- [x] base64 변환 + content block 생성
- [x] Pi SDK 세션에 이미지 content block 전달 방식 확인
- [x] `handleSlackEvent()`에서 이미지/비이미지 분기
- [x] 비이미지 파일 → `<file>` 태그로 텍스트 주입
- [x] 다운로드 인증 디버깅 (HTML 리다이렉트 문제)
- [x] 테스트: 이미지 업로드 → LLM이 내용 설명
- [x] 테스트: 큰 이미지 (4000x3000) → 자동 리사이즈 후 정상 처리
- [x] 테스트: JPEG 확장자인데 실제 PNG → 매직바이트로 정확히 감지

## Phase 7: (예비) 추가 발견 사항

> 테스트 중 발견되는 추가 이슈 여기에 Phase로 추가

## 향후 검토

- **에이전트 Spawn (서브에이전트 위임)** — OpenClaw `sessions_spawn` 패턴 참고. P3 멀티에이전트 + P6 기본 응답 품질 안정화 이후 검토.

---

## 참고 문서

- [OpenClaw 구현 분석](./openclaw-analysis.md) — Phase 1, 2, 6, 7의 구현 방안에 반영됨

---

## 운영 원칙

- 각 Phase: 구현 → Codex 리뷰 → 빌드/테스트 → 커밋
- **LLM 행동 변경은 실제 슬랙에서 수동 테스트 필수**
- 필터링은 보수적으로 — 정상 응답을 삼키는 것보다 비정상 응답이 나가는 게 나음
