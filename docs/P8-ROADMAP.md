# P8 Roadmap — Web Dashboard UI 전면 개편

> P7 완료 후 진행. OpenClaw Control UI를 벤치마크로 대시보드 UX 대폭 개선.
> 착수일: 2026-03-12 | 상태: 🔄 진행 중

---

## 배경

기존 대시보드는 기본 기능만 있었음:
- 사이드바가 flat 메뉴 (카테고리 없음)
- "Create Agent"가 독립 메뉴로 존재
- 세션 뷰가 좁은 카드 리스트 + 간단한 메시지 뷰
- 세션 히스토리 로드 안 됨 (SSE 실시간만)
- 에이전트 목록 페이지 없음

OpenClaw Control UI 분석 후 개선안 수립 → `docs/dashboard-improvement.md`

---

## 완료 항목

### Phase 1: 사이드바 재구성 + Agents 목록 ✅

**커밋:** `feb69ae` (2026-03-12)

| 파일 | 변경 내용 |
|------|-----------|
| `Layout.tsx` | 카테고리별 그룹핑 (Control/Agent/Settings), 접기/펼치기 + localStorage 저장, Health/Version 뱃지, aria-expanded/controls |
| `AgentList.tsx` (신규) | 에이전트 카드 그리드, 상태/모델/채널/하트비트/크론 표시, 키보드 접근성 |
| `Dashboard.tsx` | "Overview"로 간소화 — 요약 카드 4개 (Total Agents, Running, Cron Jobs, Health) + Agent Status 목록 |
| `App.tsx` | `/agents` 라우트 추가 |

**Codex 리뷰:** `docs/phase1-review.md` — Critical 0, Warning 4 (모두 수정 완료)
- W1: 카드 키보드 접근성 → role/tabIndex/onKeyDown 추가
- W3: localStorage try/catch + 타입 검증
- W4: statusVariant 타입을 `Record<Agent["status"], ...>`로 강화
- S1: aria-expanded/aria-controls 추가
- S3: Health 로딩 중 outline variant

### Phase 2: 세션 Chat UI ✅

**커밋:** `feb69ae` (2026-03-12, Phase 1과 함께)

| 파일 | 변경 내용 |
|------|-----------|
| `Sessions.tsx` | 전체 화면 Chat UI로 재작성 — 세션 셀렉터, Focus 모드, 메시지 입력/전송, SSE 실시간 유지 |
| `ChatBubble.tsx` (신규) | user/assistant 말풍선, react-markdown 렌더링, Copy 버튼, React.memo |
| `ToolCallBlock.tsx` (신규) | 도구 호출 Collapsible 블록 (이름/상태/파라미터/결과) |
| `SessionSelect.tsx` (신규) | shadcn Select 기반 세션 드롭다운 |
| `collapsible.tsx` (신규) | shadcn Collapsible primitive |
| `scroll-area.tsx` (신규) | shadcn ScrollArea primitive |

**설치 패키지:** `react-markdown` 10.1.0

**Codex 리뷰:** `docs/phase2-review.md` — Critical 0, Warning 8 (핵심 수정 완료)
- W5: IME 한글 입력 중 전송 방지 (`isComposing`)
- W2-3: stale selected 상태 → ref 기반 + session:end 리셋
- W4: 아이콘 버튼 aria-label 추가
- W6: ChatBubble React.memo
- W7: 메시지 key 개선 (role+timestamp+index)
- W8: clipboard try/catch

---

## 진행 중 항목

### Phase 3: 세션 리스트 → 상세 패턴 + 히스토리 로드 🔄

**상태:** 서브에이전트 작업 중 (2026-03-13)

**문제:**
1. Sessions 페이지가 바로 Chat UI → 세션이 많으면 드롭다운 전환만 가능해 불편
2. 세션 히스토리 로드 안 됨 — SSE 실시간 메시지만 표시
3. 서버 `listPersistedSessions`가 서브디렉토리 .jsonl 파일 미탐색

**계획:**

| 작업 | 파일 | 설명 |
|------|------|------|
| 세션 목록 테이블 | `Sessions.tsx` | Chat UI → 테이블 목록으로 변경 (Agent, Status, Messages, Updated) |
| 세션 상세 페이지 | `SessionDetail.tsx` (신규) | Chat UI를 여기로 이동, URL 파라미터로 세션 지정 |
| 라우팅 | `App.tsx` | `/sessions/:agentId/:sessionId` 추가 |
| 서버 수정 | `session-files.ts` | 서브디렉토리 재귀 탐색 fallback |
| 히스토리 로드 | `SessionDetail.tsx` | 페이지 로드 시 fetchAgentSession으로 기존 메시지 로드 |

---

## 진행 중 항목

### Phase 4: Sessions 세션 단위 리스트 + 에이전트 필터 🔄

**상태:** 서브에이전트 작업 중 (2026-03-13)

**문제:**
- 에이전트 단위로만 표시 (에이전트별 1행) → 세션 단위로 표시해야 함
- 과거(persisted) 세션이 안 보임
- Messages 수 항상 0
- sessionKey가 agentId와 중복 표시

**계획:**

| 작업 | 파일 | 설명 |
|------|------|------|
| 서버 API | `src/api/routes/` | `/api/sessions/all` — 활성+과거 세션 통합, messageCount 포함, agent 필터 |
| 세션 목록 | `Sessions.tsx` | 세션 단위 테이블 + 에이전트 필터 드롭다운 |
| API 클라이언트 | `api.ts` | `fetchAllSessions(agent?)` 추가 |

---

## 미착수 항목 — OpenClaw 비교 개선점 (P8 범위)

> 상세: `docs/dashboard-improvements-v2.md`

### P1: SessionDetail raw metadata 처리
- "Conversation info (untrusted metadata)..." 가 사용자 메시지로 그대로 노출
- 메타데이터 블록을 접기/숨기기 처리 또는 서버에서 본문 분리

### P1: 상단 헤더 바 추가
- Layout에 고정 헤더 (Version + Health + 테마 토글 + 사이드바 접기 버튼)
- OpenClaw처럼 상단에 정보 집약

### P2: Overview 대시보드 고도화
- Slack 연결 상태 카드
- 최근 세션 활동 타임라인
- 토큰 사용량 요약
- 시스템 상태 상세 (uptime, 메모리)

### P2: Agents 카드 정보 보강
- 활성 세션 수, 마지막 활동, 총 메시지 수, 토큰 사용량 요약

### P2: 사이드바 접기 (collapse)
- 햄버거 메뉴로 사이드바 토글
- 아이콘 전용 모드

### P3: Empty State 개선
- 데이터 없을 때 일러스트 + 안내 + CTA 버튼

### P3: 테마 토글 위치
- 사이드바 → 상단 헤더로 이동

### P3: 사이드바 아이콘 스타일 통일
- 카테고리 접기를 `-`/`+`로 변경 (OpenClaw 스타일)

---

## 기술 스택

- **프론트:** React 19, shadcn/ui, Vite 7, Tailwind v4 (CSS-first), react-markdown
- **서버:** TypeScript + tsx, Pi SDK (SessionManager)
- **세션 저장:** JSONL (append-only tree 구조)
- **실시간:** SSE (Server-Sent Events)

## 참고 문서

- `docs/dashboard-improvement.md` — OpenClaw UI 분석 + 초기 개선안
- `docs/phase1-review.md` — Phase 1 Codex 리뷰
- `docs/phase2-review.md` — Phase 2 Codex 리뷰
- `docs/openclaw-analysis.md` — OpenClaw 아키텍처 분석
