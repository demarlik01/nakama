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

## 에이전트 메모리 관리 고도화 ✅

**목표:** 에이전트가 대화 내용을 자동으로 기억하고 활용

**완료:**
- ✅ 기본 AGENTS.md 템플릿에 Memory 섹션 추가 (22702a1)
- ✅ 기존 에이전트(dev-agent, writer-agent) AGENTS.md에도 적용
- ✅ 시스템 프롬프트에서 MEMORY.md + memory/ 자동 로드 (기존)
- ✅ AGENTS.md 템플릿에 heartbeat 메모리 정리 지침 추가 (5f2bbdf)
- ✅ MEMORY.md 초기 콘텐츠 개선 — 구조화된 섹션 포함 (5f2bbdf)
- Daily 파일은 영구 보관 (토큰 부담 없음, 맥락 추적용)
