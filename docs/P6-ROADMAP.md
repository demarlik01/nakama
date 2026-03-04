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

## Phase 4: (예비) 추가 발견 사항

> 테스트 중 발견되는 추가 이슈 여기에 Phase로 추가

---

## 운영 원칙

- 각 Phase: 구현 → Codex 리뷰 → 빌드/테스트 → 커밋
- **LLM 행동 변경은 실제 슬랙에서 수동 테스트 필수**
- 필터링은 보수적으로 — 정상 응답을 삼키는 것보다 비정상 응답이 나가는 게 나음
