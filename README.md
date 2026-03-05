# Agent for Work

**Slack에서 소통하고, 팀 맥락을 이해하며, 능동적으로 일하는 AI 팀원을 쉽게 추가한다.**

## 핵심 가치

1. **에이전트를 쉽게 띄울 수 있다** — 역할 정의(AGENTS.md) + Slack 연결이면 끝
2. **Slack으로 쉽게 소통한다** — DM, 멘션, 스레드로 자연스러운 대화
3. **팀 맥락을 이해하고 능동적으로 일한다** — 기억을 가지고, 행동 지침에 따라 판단

## 컨셉

- 워크플로우 자동화가 아닌 **팀원 추가**
- AGENTS.md에 "개발자"라고 쓰면 개발자, "마케터"라고 쓰면 마케터
- 각 팀의 필요에 맞게 에이전트를 정의하고 띄울 수 있음
- 특정 직군에 한정되지 않는 범용 에이전트 플랫폼

## 아키텍처 (요약)

```
┌─────────┐   ┌──────────┐   ┌───────────┐
│ Web UI  │   │  Slack   │   │ Scheduler │
└────┬────┘   └────┬─────┘   └─────┬─────┘
     │             │               │
     ▼             ▼               ▼
┌──────────────────────────────────────────┐
│  API Server → Router → Agent Registry   │
│                  ↓                       │
│           Session Manager                │
│           (Pi Agent Loop)                │
│                  ↓                       │
│            Tool Executor                 │
│     (Bash, Read, Write, Web, ...)       │
└──────────────────────────────────────────┘
     │
     ▼
/workspaces/{agent}/
  ├── AGENTS.md    (역할 + 행동 규칙)
  ├── agent.json   (Slack 매핑, 설정)
  ├── MEMORY.md    (장기 기억)
  └── memory/      (일별 로그)
```

## 기술 스택

| 구분 | 선택 |
|------|------|
| 언어 | TypeScript (Node.js) |
| LLM | Pi SDK (`@mariozechner/pi-*`) |
| Slack | `@slack/bolt` |
| API | Express / Fastify |
| 인증 | setup-token (Claude 구독) 또는 API 키 |

## 에이전트 정의

사용자가 쓰는 건 **AGENTS.md 하나**. 나머지는 시스템/에이전트가 관리.

| 파일 | 역할 | 생성 주체 |
|------|------|----------|
| `AGENTS.md` | 역할, 톤, 행동 규칙 | 사용자 |
| `agent.json` | Slack 매핑, 모델 설정 | Web UI / API |
| `MEMORY.md` | 장기 기억 | 에이전트 (자동) |
| `TOOLS.md` | 도구 메모 | 에이전트 (선택) |
| `HEARTBEAT.md` | 능동 행동 체크리스트 | 사용자/에이전트 |

## 개발 단계

| Phase | 기간 | 목표 |
|-------|------|------|
| **Phase 1: PoC** | 2주 | 단일 에이전트 + Slack 대화 + 기본 도구 |
| **Phase 2: MVP** | 4주 | 복수 에이전트 + Web UI + 스케줄러 |
| **Phase 3: Beta** | 8주 | 대시보드 + 역할 템플릿 + 외부 베타 |

## 문서

- **[사용 가이드](docs/usage-guide.md)** — 슬랙 대화, 슬래시 커맨드, 채널 모드, API 사용법
- [PRD](docs/PRD.md) — 제품 요구사항
- [Architecture](docs/architecture.md) — 상세 아키텍처
- [PoC Specs](docs/spec/) — 구현 스펙

## 시작하기

```bash
npm install
cp config.example.yaml config.yaml  # Slack 토큰, API 키 등 설정
npm run build
npx pm2 start ecosystem.config.cjs
```

자세한 사용법은 **[사용 가이드](docs/usage-guide.md)** 참고.
