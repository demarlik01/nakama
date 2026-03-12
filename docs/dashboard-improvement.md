# Dashboard UI 개선안

> 참고: OpenClaw Control UI 구조 + 현재 agent-for-work 대시보드 분석

---

## 현재 문제점

### 1. 네비게이션 구조
- "Create Agent"가 독립 메뉴로 존재 → Agents 목록 페이지 안에 있어야 함
- 에이전트 관련 기능이 흩어져 있음 (Dashboard에서 카드, Create Agent 별도 메뉴)

### 2. 세션 뷰
- 세션 목록이 좁은 테이블로 표시되어 대화 내용 확인이 불편
- 세션 선택 → 상세 보기 전환이 직관적이지 않음
- 대화 말풍선이 작고 코드 블록 가독성 떨어짐

---

## 개선안

### A. 사이드바 네비게이션 재구성

**Before:**
```
Dashboard
Sessions
Cron Jobs
Create Agent  ← 별도 메뉴
Health
Settings
```

**After:**
```
┌─ Chat (메인)
│
├─ Control
│  ├─ Overview (대시보드 요약)
│  ├─ Channels (Slack 채널 매핑)
│  ├─ Instances (실행 중인 에이전트)
│  └─ Sessions
│
├─ Agent
│  ├─ Agents (목록 + Create 버튼)
│  ├─ Skills (도구/기능)
│  └─ Cron Jobs
│
├─ Settings
│  ├─ Config
│  ├─ Debug
│  └─ Logs
│
└─ Resources
   └─ Docs
```

핵심 (OpenClaw 실제 구조 기반):
- **Agents** 메뉴 안에 에이전트 목록 + "Create" 버튼
- "Create Agent" 독립 메뉴 삭제
- 카테고리별 그룹핑 (Control / Agent / Settings)
- 각 카테고리는 접기/펼치기 가능 (OpenClaw처럼 "−" 토글)
- 상단 헤더: 로고 + 프로젝트명 + Version 뱃지 + Health 상태

### B. 세션 UI 전면 개선

**현재:** 좁은 테이블 → 세션 클릭 → 작은 상세 패널

**개선 (OpenClaw 스타일):**

```
┌──────────────────────────────────────────────────────────┐
│  Chat                                                     │
│  Direct gateway chat session for quick interventions.     │
│                                                           │
│  [세션 셀렉트 박스 ▼] telegram:g-agent-claw-main         │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                                                     │ │
│  │  👤 User (11:29 PM)                                │ │
│  │  이제 agent-for-work 서버좀 띄워보자               │ │
│  │                                                     │ │
│  │  🤖 클로(Claw) (11:29 PM)                          │ │
│  │  ┌─ Exec ─────────────────────────────────┐       │ │
│  │  │ pnpm dev                                │       │ │
│  │  │ > agent-for-work@0.1.0 dev             │       │ │
│  │  │ Completed                               │       │ │
│  │  └─────────────────────── View ✓ ──────────┘       │ │
│  │                                                     │ │
│  │  npm 설치 방법 추가 + GitHub URL 수정...            │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  [Message input...                    ] [New Session] [Send]│
└──────────────────────────────────────────────────────────┘
```

핵심 변경 (OpenClaw Chat 페이지 참고):
1. **세션 전체 화면 사용** — 메인 영역 전체를 대화 뷰로
2. **상단 셀렉트 박스**로 세션 전환 (OpenClaw: `<select>` 드롭다운, 세션 키 표시)
3. **상단 우측 버튼들**: Refresh / Toggle thinking / Focus mode
4. **말풍선 UI** — user(U 아이콘)/assistant(🤖 아이콘) 구분, 이름+시간 표시
5. **도구 호출 접기/펼치기** — "Exec" 라벨 + 명령어 요약 + "View ✓" 토글 + "Completed" 상태
6. **Copy as markdown** 버튼 (각 assistant 메시지)
7. **마크다운 렌더링** — 코드 블록, 리스트, 볼드/인라인코드 등
8. **하단 입력창** — "Message (↵ to send, Shift+↵ for line breaks, paste images)" + [New Session] + [Send] 버튼

### C. Agents 페이지

```
┌──────────────────────────────────────────────────────────┐
│  Agents                                    [+ Create Agent]│
│                                                           │
│  ┌──────────────────────┐  ┌──────────────────────┐     │
│  │  🤖 dev-agent        │  │  ✍️ writer-agent     │     │
│  │  Status: Active      │  │  Status: Active      │     │
│  │  Model: claude-4     │  │  Model: gpt-4o       │     │
│  │  Sessions: 3         │  │  Sessions: 1         │     │
│  │  Channels: #dev      │  │  Channels: #content  │     │
│  │                      │  │                      │     │
│  │  [Edit] [Sessions]   │  │  [Edit] [Sessions]   │     │
│  └──────────────────────┘  └──────────────────────┘     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

- 에이전트 카드 그리드 레이아웃
- 각 카드에 상태, 모델, 세션 수, 채널 표시
- "Create Agent" 버튼은 페이지 우상단

### D. Overview (대시보드) 간소화

현재 대시보드가 에이전트 카드 + 세션을 다 보여주려고 해서 복잡.

개선:
- 요약 카드만 표시 (활성 에이전트 수, 총 세션 수, 오늘 메시지 수)
- 최근 활동 타임라인 (어떤 에이전트가 뭘 했는지)
- 세부사항은 각 페이지로 이동

---

## 구현 우선순위

1. **사이드바 네비게이션 재구성** (S) — Layout.tsx 수정
2. **세션 UI 전면 개편** (L) — Sessions.tsx 재작성, 말풍선 컴포넌트
3. **Agents 목록 페이지** (M) — AgentList.tsx 신규, Create 버튼 통합
4. **Overview 간소화** (M) — Dashboard.tsx 리팩토링

---

## 기술 참고

- 현재 스택: React 19 + shadcn/ui + Vite + Tailwind
- 셀렉트 박스: shadcn `<Select>` 컴포넌트 활용
- 말풍선: 커스텀 `<ChatBubble>` 컴포넌트 (마크다운 렌더링 + 코드 하이라이팅)
- 마크다운: `react-markdown` + `rehype-highlight`
- 도구 호출: `<Collapsible>` 컴포넌트로 접기/펼치기
