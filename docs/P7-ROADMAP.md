# P7 Roadmap — 에이전트 프로필 & 메모리 고도화

> 에이전트 개성 + 메모리 관리 강화

---

## 완료

### /crew 서브커맨드 통합 (2026-03-06)
- `/assign`, `/unassign`, `/agents`, `/switch` 4개 → `/crew` 하나로 통합
- 서브커맨드: `agents`, `assign {agent}`, `unassign`, `switch {agent}`
- 서브커맨드 없이 `/crew`만 입력 시 도움말 표시
- Slack 앱 설정에서 `/crew` 커맨드 등록 필요 (Socket Mode)
- 파일: src/slack/commands.ts, tests/slack-commands.test.ts (테스트 6개)

### 멀티에이전트 채널 라우팅 (2026-03-06)
- 한 채널에 여러 에이전트 배정 가능 (1개 제한 해제)
- `/crew default {agent}` — 채널 기본 에이전트 지정
- 라우팅 우선순위: 스레드 점유 → /as → 이름 매칭 → 채널 default → 첫 번째 폴백
- 테스트 115개 통과, 커밋: cf43509

### Heartbeat & Cron (2026-03-06)
- HeartbeatRunner (setTimeout 루프 + HEARTBEAT_OK transcript pruning)
- CronService (croner + JSON store + main/isolated 모드)
- Active hours, HEARTBEAT.md 게이트, API CRUD
- 테스트 145개 통과, 커밋: 4bb89f2

### Web UI Cron 관리 페이지 (2026-03-11)
- CronJobs 페이지: 목록, 생성/수정/삭제, 수동 실행, 활성화 토글
- 에이전트별 필터, cron/every/at 스케줄 타입 지원
- Dialog 폼 (에이전트, 스케줄, 프롬프트, main/isolated, 모델)
- 사이드바 + 라우터 등록, shadcn Switch 컴포넌트 추가

---

## 에이전트 프로필 커스터마이징 ✅

**목표:** 에이전트마다 고유 프로필 사진 + 이름으로 슬랙에 표시

**완료:**
- `slackDisplayName` → `username` 오버라이드 ✅
- `slackIcon` → `icon_emoji` 오버라이드 ✅ (워크스페이스 이모지)
- `slackIcon` → `icon_url` 오버라이드 ✅ (URL 자동 감지, 대소문자 무관)
- `slackIcon` 하나로 이모지/URL 겸용 (별도 필드 불필요)
- 커밋: 7753d5e, fd38fe6

**Slack 앱 설정 필요:**
- OAuth & Permissions → Bot Token Scopes에 `chat:write.customize` 확인
- 앱 설정 → "Allow users to change bot name and icon" 활성화

---

## 세션 모드 (에이전트별 설정)

**목표:** 에이전트별로 세션 격리 수준을 선택 가능하게

**현재:** 에이전트당 단일 세션 (`Map<agentId, SessionRuntime>`) — 채널/스레드 구분 없이 전부 같은 세션

**설계:**
```jsonc
{
  "id": "dev-agent",
  "sessionMode": "per-thread"  // "single" | "per-channel" | "per-thread"
}
```

| 모드 | 세션 키 | 적합한 케이스 |
|---|---|---|
| `single` | `agentId` | 맥락 누적이 중요한 에이전트 (현재 동작 유지) |
| `per-channel` | `agentId:channelId` | 채널별 격리, 적당한 맥락 유지 |
| `per-thread` | `agentId:threadTs` | 이슈별 독립 대화, 프라이버시 (기본값) |

**구현:**
- `SessionManager.sessions` 키를 모드에 따라 분기
- `per-thread`에서 비스레드 채널 메시지 → `per-channel`로 폴백
- TTL/GC: `per-thread` 세션은 일정 시간(예: 24h) 미활동 시 정리
- `per-channel`/`per-thread` 세션도 MEMORY.md 공유 (에이전트 워크스페이스 단위)
- 세션 영속화: 모드별 디렉토리 구조 (`sessions/{agentId}/` 또는 `sessions/{agentId}/{key}/`)
- Web UI: Sessions 탭에서 모드별 세션 목록 표시
- 기본값: `per-thread` (미설정 시)

---

## 에이전트 메모리 관리 고도화 ✅

**목표:** 에이전트가 대화 내용을 자동으로 기억하고 활용

**완료:**
- ✅ 기본 AGENTS.md 템플릿에 Memory 섹션 추가 (22702a1)
- ✅ 기존 에이전트(dev-agent, writer-agent) AGENTS.md에도 적용
- ✅ 시스템 프롬프트에서 MEMORY.md + memory/ 자동 로드 (기존)
- ✅ AGENTS.md 템플릿에 heartbeat 메모리 정리 지침 추가 (5f2bbdf)
- ✅ MEMORY.md 초기 콘텐츠 개선 — 구조화된 섹션 포함 (5f2bbdf)
- Daily 파일은 영구 보관 (토큰 부담 없음, 맥락 추적용)
