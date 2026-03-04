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

**구현 방안:**
- 유저 메시지를 LLM에 넘기기 전에 컨텍스트 헤더 추가:
  ```
  [message_context]
  - triggered_by: app_mention (you were directly @mentioned)
  - channel: #dev (C0AHPDVG7EF)
  - is_thread: false
  - sender: @username
  [/message_context]

  안녕 뭐하고 있어?
  ```
- 봇 멘션 텍스트 `<@U봇ID>` 는 메시지에서 제거 (중복 정보)
- DM은 `triggered_by: direct_message`

**체크리스트:**
- [ ] `handleSlackEvent()`에서 메타데이터 프리픽스 생성
- [ ] `<@U봇ID>` 텍스트 strip
- [ ] 시스템 프롬프트에 메타데이터 형식 설명 추가
- [ ] 테스트: 멘션 메시지 → LLM이 "mentioned=true" 인지

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

**체크리스트:**
- [ ] `buildDefaultAgentsMd()`에 Silent Response 섹션 추가
- [ ] 시스템 프롬프트 템플릿에 NO_REPLY 규칙 추가
- [ ] 슬랙 응답 필터 구현 (NO_REPLY / 빈 응답 차단)
- [ ] 👀 리액션 제거 로직 (NO_REPLY 시)
- [ ] 테스트: LLM이 NO_REPLY 반환 → 슬랙 메시지 안 보냄

## Phase 3: 메타코멘트 필터

**목표:** "stays silent", "I'll skip this" 같은 메타설명 응답 차단

**구현 방안:**
- 정규식/키워드 기반 감지:
  - `stays silent`, `remain silent`, `I'll skip`, `not responding`, `no response needed`
  - 응답 전체가 짧고 (< 100자) 위 패턴 매치 → NO_REPLY 처리
- 로그에 기록 (왜 필터됐는지 디버깅용)

**체크리스트:**
- [ ] 메타코멘트 패턴 리스트 정의
- [ ] 응답 필터 함수 구현
- [ ] 필터링 시 로그 기록
- [ ] 테스트: "stays silent" 응답 → 슬랙에 안 보냄

## Phase 4: 디버그 로깅 강화

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

## Phase 5: 커스텀 툴 확장

**목표:** 에이전트에 웹검색/브라우저 같은 추가 도구 제공

**현재 상태:**
- Pi SDK `codingTools` = read, write, edit, bash 만 제공
- 웹검색, URL fetch, 브라우저 없음

**구현 방안:**
- Pi SDK 커스텀 Tool 인터페이스로 추가 도구 정의:
  - `web_search` — Brave Search / Tavily API
  - `web_fetch` — URL → 마크다운 추출
- agent.json에서 사용할 도구 세트 선택 가능하게:
  ```json
  "tools": ["coding", "web_search", "web_fetch"]
  ```
- 기본값: `["coding"]` (기존 동작 유지)

**체크리스트:**
- [ ] Pi SDK Tool 인터페이스 확인 및 커스텀 툴 타입 정의
- [ ] `web_search` 툴 구현 (API 키 config.yaml에서 관리)
- [ ] `web_fetch` 툴 구현
- [ ] agent.json `tools` 필드 추가 + 레지스트리에서 도구 세트 조합
- [ ] 테스트: 에이전트가 웹검색 요청 → 결과 반환

## Phase 6: 슬랙 파일 업로드

**목표:** 에이전트가 생성한 파일을 슬랙 채널/스레드에 업로드

**현재 문제:**
- 에이전트가 write 도구로 워크스페이스에 파일 생성은 가능
- 하지만 슬랙에 파일을 보내는 도구가 없음 → "만들었습니다!" 하고 끝
- 유저는 파일을 볼 수 없음

**구현 방안:**
- Pi SDK 커스텀 툴로 `slack_upload` 제공:
  - 입력: `{ filePath: string, channel?: string, thread_ts?: string, comment?: string }`
  - 내부: Slack `files.uploadV2` API 호출
- 또는 LLM 응답에 파일 경로 감지 → 자동 업로드 (후처리)
- 봇 토큰에 `files:write` 스코프 필요 (이미 있을 수 있음)

**체크리스트:**
- [ ] 봇 토큰 `files:write` 스코프 확인
- [ ] `slack_upload` 커스텀 툴 구현
- [ ] 현재 대화 채널/스레드에 자동 타겟팅
- [ ] 테스트: 에이전트가 파일 생성 → 슬랙에 업로드

## Phase 7: (예비) 추가 발견 사항

> 테스트 중 발견되는 추가 이슈 여기에 Phase로 추가

---

## 운영 원칙

- 각 Phase: 구현 → Codex 리뷰 → 빌드/테스트 → 커밋
- **LLM 행동 변경은 실제 슬랙에서 수동 테스트 필수**
- 필터링은 보수적으로 — 정상 응답을 삼키는 것보다 비정상 응답이 나가는 게 나음
