# P7 Roadmap — 추가 툴 확장

> P6 Phase 4a 완료 후 진행. 에이전트 능력 확장.

---

## 완료

### /crew 서브커맨드 통합 (2026-03-06)
- `/assign`, `/unassign`, `/agents`, `/switch` 4개 → `/crew` 하나로 통합
- 서브커맨드: `agents`, `assign {agent}`, `unassign`, `switch {agent}`
- 서브커맨드 없이 `/crew`만 입력 시 도움말 표시
- Slack 앱 설정에서 `/crew` 커맨드 등록 필요 (Socket Mode)
- 파일: src/slack/commands.ts, tests/slack-commands.test.ts (테스트 6개)

---

## 멀티에이전트 채널 라우팅

**목표:** 한 채널에 여러 에이전트를 배정하고 자연스럽게 라우팅

**설계:**
- `/crew assign` 으로 채널에 여러 에이전트 배정 가능 (1개 제한 해제)
- `/crew default {agent}` — 채널 기본 에이전트 지정
- `@Crew` 만 멘션 → 기본 에이전트가 응답
- `@Crew {agent-name} ...` → 지정한 에이전트가 응답
- 스레드 점유: 에이전트가 스레드에 처음 응답하면 그 스레드는 해당 에이전트 담당

**변경 필요:**
- `registry.assignChannel()` — 채널당 복수 에이전트 허용
- `router` — 메시지에서 에이전트 이름 파싱 → 매칭
- `router` — 스레드 내 기존 응답자 확인 로직
- `/crew assign`, `/crew unassign` — 복수 배정 UX
- `/crew default {agent}` 서브커맨드 추가

---

## 에이전트 프로필 커스터마이징

**목표:** 에이전트마다 고유 프로필 사진 + 이름으로 슬랙에 표시

**현재 상태:**
- `slackDisplayName` → `username` 오버라이드 ✅
- `slackIcon` → `icon_emoji` 오버라이드 ✅ (워크스페이스 이모지만)
- `icon_url` → ❌ 미지원

**구현 방안:**
- `slackIcon`이 URL(http/https)이면 `icon_url`, 이모지(`:xxx:`)면 `icon_emoji`로 분기
- agent.json에 `slackIconUrl` 필드 추가 또는 `slackIcon` 자체를 URL/이모지 겸용으로
- 에이전트별 아바타 이미지는 워크스페이스에 저장 or 외부 URL

**Slack 앱 설정 필요:**
- OAuth & Permissions → Bot Token Scopes에 `chat:write.customize` 확인
- 앱 설정 → "Allow users to change bot name and icon" 활성화

---

## 후보 툴

| 툴 | 설명 | 비고 |
|---|---|---|
| `browser` | 브라우저 제어 (JS 렌더 페이지) | web_fetch로 안 되는 SPA 등 |
| `spawn_agent` | 서브에이전트 위임 | 멀티에이전트 (P3) 연계 |
| `message` | 슬랙 외 채널로 메시지 전송 | 필요성 확인 후 |

---

## 우선순위 미정

실제 사용하면서 필요한 것부터 추가. P6 안정화 + 실사용 피드백 이후 결정.
