# Nakama

**Slack에서 소통하고, 팀 맥락을 이해하며, 능동적으로 일하는 AI 팀원.**

## 핵심 가치

1. **에이전트를 쉽게 띄울 수 있다** — 역할 정의(AGENTS.md) + Slack 연결이면 끝
2. **Slack-native 소통** — DM, 멘션, 스레드로 자연스러운 대화
3. **팀 맥락 + 능동적 행동** — 기억을 가지고, 행동 지침에 따라 판단하고, 시키지 않아도 일한다

## 아키텍처

```
┌───────────┐  ┌───────────┐  ┌─────────────────┐
│   Slack   │  │ Web Admin │  │ Cron / Heartbeat│
│  Gateway  │  │ Dashboard │  │   Service       │
└─────┬─────┘  └─────┬─────┘  └───────┬─────────┘
      │              │                │
      ▼              ▼                ▼
┌──────────────────────────────────────────────────┐
│  REST API + SSE → Message Router → Agent Registry│
│                        ↓                          │
│              Session Manager (Pi Agent Loop)      │
│                        ↓                          │
│               Tool Executor + LLM API             │
└──────────────────────────────────────────────────┘
      │
      ▼
~/.nakama/workspaces/{agent}/
  ├── AGENTS.md       역할 + 행동 규칙
  ├── agent.json      Slack 매핑, 모델 설정
  ├── MEMORY.md       장기 기억
  ├── HEARTBEAT.md    능동 행동 체크리스트
  ├── memory/         일별 로그
  ├── sessions/       대화 히스토리 (JSONL)
  └── docs/           도메인 지식
```

## 기술 스택

| 구분 | 선택 |
|------|------|
| 언어 | TypeScript (Node.js ≥22) |
| LLM 런타임 | Pi SDK (`@mariozechner/pi-*`) — 오픈소스 에이전트 프레임워크 |
| LLM 인증 | setup-token (Claude Max/Pro 구독 크레딧 사용) |
| Slack | `@slack/bolt` (Socket Mode) |
| API | Express + SSE |
| Web UI | Vite + React 19 + shadcn/ui (다크 테마) |
| 세션 영속화 | Pi SDK SessionManager (JSONL) |
| 사용량 추적 | SQLite (better-sqlite3) |
| 스케줄러 | croner |
| 이미지 처리 | sharp |
| 패키지 매니저 | pnpm |

## 주요 기능

- **멀티 에이전트** — 역할별 독립 에이전트, 파일시스템 기반 동적 등록/해제
- **세션 모드** — single / per-channel / per-thread
- **Cron & Heartbeat** — 주기적 체크, 능동적 행동
- **이미지 비전** — Slack 첨부 이미지 → LLM 멀티모달 분석
- **Web Dashboard** — 에이전트 관리, 세션 뷰어, 크론 잡, 사용량 모니터링
- **채널 라우팅** — mention / proactive 모드, 리액션 트리거
- **에이전트 메모리** — 일별 로그 + 장기 기억 자동 축적
- **`/crew` 슬래시 커맨드** — Slack에서 에이전트 목록/상태 조회
- **도구** — Bash, Read, Write, Edit, WebSearch, WebFetch, Memory

## 시작하기

### Prerequisites

- Node.js ≥ 22
- pnpm
- Slack App (Socket Mode 활성화, Bot/App Token 발급)

### 개발 모드

```bash
pnpm install
cd web && pnpm install && cd ..

cp config.example.yaml config.yaml
# config.yaml에 Slack 토큰 등 입력

pnpm dev                  # 백엔드 (tsx watch, 포트 3000)
cd web && pnpm dev        # 프론트엔드 (Vite, 포트 5173)
```

### 프로덕션

```bash
pnpm build                # 백엔드 + 프론트엔드 빌드
npx pm2 start ecosystem.config.cjs
# Web Dashboard는 Express가 dist/web/ 서빙 (포트 3001)
```

### 테스트

```bash
pnpm test                 # vitest
pnpm test:watch           # watch 모드
```

## 에이전트 추가

1. Web Dashboard에서 "새 에이전트" 또는 [API](docs/architecture.md#5-rest-api)로 생성
2. AGENTS.md에 역할/행동 규칙 작성
3. Slack 채널 연결
4. 끝 — 에이전트가 자동으로 동작 시작

## 문서

- [사용 가이드](docs/usage-guide.md) — Slack 대화, `/crew` 커맨드, 채널 모드, API
- [PRD](docs/PRD.md) — 제품 요구사항
- [Architecture](docs/architecture.md) — 상세 아키텍처 + API 레퍼런스
- [Roadmap](docs/roadmap/) — P1~P9 개발 로드맵

