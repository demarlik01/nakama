# P8 리서치 — 경쟁사 분석 & 트렌드

> 작성일: 2026-03-08
> 목적: P8 로드맵 정비를 위한 경쟁 제품 분석, 업계 트렌드, 빠진 기능 식별

---

## 1. 경쟁 제품 / 유사 플랫폼 분석

### 1.1 Dust.tt

**포지셔닝:** 회사 내부 지식 기반 AI 에이전트 플랫폼

**핵심 기능:**
- **RAG (Retrieval-Augmented Generation):** Notion, Slack, Google Drive, Confluence 등 내부 문서를 벡터화하여 에이전트가 참조
- **멀티 데이터소스 커넥터:** 20+ SaaS 연동 (Slack 메시지 히스토리, Google Docs, Notion, GitHub 등)
- **Webhook 트리거:** GitHub, Jira, Slack 등 외부 이벤트로 에이전트 자동 실행
- **멀티 모델 지원:** OpenAI, Claude 선택 가능
- **Slack 통합:** 채널에서 직접 에이전트 호출, 지식 허브화

**우리와의 차이점:**
- Dust는 **지식 검색 + Q&A** 중심, 우리는 **능동적 행동 + 도구 실행** 중심
- Dust는 RAG가 핵심, 우리는 파일시스템 기반 도메인 지식
- Dust는 코드/셸 실행 능력이 약함, 우리는 Bash + 파일 조작이 강점
- **시사점:** 내부 문서 검색(RAG) 기능은 우리에게도 가치 있음

### 1.2 Slack Agentforce (Salesforce)

**포지셔닝:** Slack 네이티브 AI 에이전트 (Business+/Enterprise+ 전용)

**핵심 기능:**
- **Slack 네이티브 UI:** 전용 에이전트 인터페이스 (DM/멘션 아닌 별도 UI)
- **CRM 데이터 그라운딩:** Salesforce Data Cloud + Slack 대화 데이터 결합
- **Pre-built Slack Actions:** "채널 생성", "Canvas 생성", "메시지 전송" 등 빌트인 액션
- **Proactive 알림:** 버튼 포함 알림 → 유저 클릭 → 에이전트 후속 작업
- **서드파티 에이전트:** Asana, Cohere, Adobe Express 등 외부 에이전트 탑재

**우리와의 차이점:**
- Agentforce는 Salesforce 생태계 종속, 우리는 독립형
- 프로액티브 알림 + 인터랙티브 버튼 패턴은 참고할 만함
- **시사점:** Slack Interactive Components (버튼, 모달) 활용한 승인 워크플로우, 프로액티브 알림 UX

### 1.3 Moveworks

**포지셔닝:** IT/HR 헬프데스크 자동화 + 엔터프라이즈 검색

**핵심 기능:**
- **엔터프라이즈 검색:** Slack 메시지 + 내부 위키 + HR 시스템 통합 검색 (Slack RTS API 활용)
- **티켓 자동 처리:** IT 지원 요청 자동 분류 + 해결
- **멀티 채널:** Slack, Teams, 이메일, 웹 인터페이스 동시 지원
- **컴플라이언스:** 금융/의료/정부 규격 보안

**우리와의 차이점:**
- Moveworks는 특정 도메인(IT/HR) 최적화, 우리는 범용
- 엔터프라이즈 검색 능력은 우리에게 없는 핵심 격차
- **시사점:** Slack 채널/메시지 검색 + 컨텍스트 활용 기능

### 1.4 Slackbot AI (2026년 1월 출시)

**포지셔닝:** Slack 자체 AI 에이전트 (Business+/Enterprise+)

**핵심 기능:**
- **정보 검색:** Slack 워크스페이스 내 채널, 메시지, 파일 검색
- **이메일 초안 작성:** 대화 맥락 기반 이메일 생성
- **미팅 스케줄링:** 캘린더 연동 일정 관리
- **컨텍스트 유지:** "회의에 같이 있었던 팀원" 수준의 맥락 이해

**시사점:** Slack 내부 데이터 활용이 핵심 차별화 포인트

---

## 2. 업계 트렌드 (2025-2026)

### 2.1 Multi-Agent Orchestration
- **A2A (Agent-to-Agent) Protocol:** Google Cloud이 제안, Linux Foundation 관리. 에이전트 간 HTTP/gRPC 기반 P2P 통신 표준
- **MCP (Model Context Protocol):** Anthropic 제안. 도구 접근 + 컨텍스트 전달 표준화 레이어
- **트렌드:** MCP로 도구 통합, A2A로 에이전트 간 협업 → 이중 레이어 아키텍처가 표준화 방향
- **시사점:** 우리의 `spawn_agent` 구상 + 에이전트 간 메시지 전달을 표준 프로토콜 위에 구현 검토

### 2.2 RAG + Agentic AI 결합
- 단순 Q&A RAG → "에이전트가 RAG로 정보 수집 후 행동까지 수행" 패턴이 주류
- Dust, Moveworks 모두 RAG + Action 결합 방향
- **시사점:** 우리의 docs/ 폴더 기반 지식은 스케일에 한계. 벡터 검색 레이어 검토 필요

### 2.3 Human-in-the-Loop / Approval Workflow
- 자율 에이전트의 위험 행동에 대한 **승인 게이트** 필수화 트렌드
- Agentforce의 "버튼 알림 → 유저 승인 → 실행" 패턴
- **시사점:** 위험 명령(배포, 삭제 등) 실행 전 Slack 버튼으로 승인 요청하는 기능

### 2.4 Observability & Governance
- 에이전트 행동의 감사 가능성(auditability) 요구 증가
- 토큰 사용량, 도구 호출 로그, 의사결정 트레이스 필수
- **시사점:** 이미 사용량 추적은 있으나, 의사결정 트레이스 + 도구 호출 감사 로그 강화 필요

### 2.5 Multi-Channel 지원
- Slack 전용은 한계. Teams, Discord, 웹, 이메일 등 멀티채널 요구
- **시사점:** 당장은 Slack 집중이 맞지만, 아키텍처적으로 채널 추상화 레이어 준비

### 2.6 Webhook/Event-Driven Triggers
- Dust: "GitHub PR 생성 시 → 에이전트 자동 리뷰" 같은 이벤트 기반 트리거
- Slack Workflow Builder와 연동
- **시사점:** 현재 크론/하트비트만 있음. 외부 웹훅 수신 → 에이전트 트리거 기능 필요

---

## 3. 우리의 강점 (차별화 포인트)

| 강점 | 설명 |
|------|------|
| **능동적 행동** | 하트비트/크론으로 시키지 않아도 일함 (대부분 경쟁사는 수동 호출) |
| **도구 실행력** | Bash + 파일 시스템 직접 조작 (코드 생성/실행, git, gh CLI 등) |
| **역할 유연성** | AGENTS.md 하나로 개발자/마케터/CS 뭐든 정의 가능 |
| **자체 호스팅** | 데이터가 외부로 나가지 않음 (Dust/Moveworks는 SaaS) |
| **저비용** | Claude 구독 기반 $100-200/월 vs SaaS 과금 |
| **메모리 시스템** | 6계층 메모리 아키텍처 (L1~L6) |
| **멀티에이전트** | 한 채널에 여러 에이전트, 프로파일 커스터마이징 |

---

## 4. 빠진 기능 (Gap Analysis)

| 기능 | 경쟁사 | 우리 현황 | 중요도 |
|------|--------|----------|--------|
| **RAG / 벡터 검색** | Dust, Moveworks | ❌ 없음 (docs/ 수동 참조) | 🔴 높음 |
| **Webhook 트리거** | Dust, Agentforce | ❌ 없음 (크론/하트비트만) | 🟠 중간-높음 |
| **Slack Interactive Components** | Agentforce | ❌ 없음 (텍스트 응답만) | 🟠 중간 |
| **MCP 도구 통합** | 업계 표준화 진행중 | ❌ 없음 | 🟡 중간 |
| **감사 로그 / 트레이스** | Moveworks, Agentforce | △ 기본 로그만 | 🟡 중간 |
| **승인 워크플로우** | Agentforce | ❌ 없음 | 🟠 중간 |
| **에이전트 간 직접 통신** | A2A 프로토콜 | ❌ 없음 (_shared 폴더만) | 🟡 낮음-중간 |
| **멀티 채널 (Teams 등)** | Moveworks | ❌ Slack 전용 | 🟡 낮음 |
| **Slack 메시지 히스토리 검색** | Slackbot AI, Moveworks | ❌ 없음 | 🟠 중간 |

---

## 5. 참고 링크

- [Dust.tt - AI Agent Platform](https://dust.tt/)
- [Dust Slack Integration](https://dust.tt/home/slack/slack-integration)
- [Slack Agentforce](https://slack.com/ai-agents)
- [Slackbot AI Agent — TechCrunch](https://techcrunch.com/2026/01/13/slackbot-is-an-ai-agent-now/)
- [Moveworks Enterprise Search](https://www.moveworks.com/us/en/resources/blog/choosing-the-best-ai-powered-search-for-enterprises)
- [A2A Protocol](https://a2a-protocol.org/latest/)
- [MCP vs A2A Protocols](https://onereach.ai/blog/guide-choosing-mcp-vs-a2a-protocols/)
- [Enterprise AI Agent Trends 2026 — Beam AI](https://beam.ai/agentic-insights/enterprise-ai-agent-trends-2026)
- [AI Agent Trends 2026 — Salesmate](https://www.salesmate.io/blog/future-of-ai-agents/)
- [Agentic RAG Slack Agents — Medium](https://medium.com/data-science-collective/agentic-rag-company-knowledge-slack-agents-98e588fd1209)
- [G2 Enterprise AI Agents Report](https://learn.g2.com/enterprise-ai-agents-report)
- [Top 20 AI Agent Builder Platforms — Vellum](https://www.vellum.ai/blog/top-ai-agent-builder-platforms-complete-guide)
