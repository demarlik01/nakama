# P2 Roadmap — Production Ready

> P1 완료: 2026-03-02 | P2 목표: 실사용 품질 + UI 고도화

---

## Phase 1: Web UI 리빌드 (Vite + React + shadcn/ui)

| 항목 | 설명 |
|------|------|
| Vite + React + TS 세팅 | `web/` 디렉토리, 빌드 → Express 서빙 |
| Tailwind CSS + shadcn/ui | 다크 테마, 컴포넌트 라이브러리 |
| 대시보드 | 에이전트 카드, 상태 배지, 활동 시간 |
| 에이전트 상세 | 탭 — Config, AGENTS.md, Usage 차트, Sessions |
| 에이전트 생성/편집 | shadcn Form + 유효성 검증 |
| 헬스 페이지 | 시스템 상태, Slack 연결, 전체 사용량 |

## Phase 2: 실시간 기능

| 항목 | 설명 |
|------|------|
| SSE 엔드포인트 | 세션 상태 실시간 push |
| 세션 모니터링 | 활성 세션, 대화 내역 실시간 |
| 로그 스트리밍 | 에이전트 로그 뷰어 |
| 토스트 알림 | 에러/비용 초과 알림 |

## Phase 3: Slack 고도화 + 복수 에이전트

| 항목 | 설명 |
|------|------|
| Block Kit 응답 | 마크다운 → Slack Block Kit |
| reaction_added | 이모지 리액션 트리거 |
| 복수 에이전트 라우팅 | 멘션 기반 disambiguation |
| 리소스 제한 | 동시 세션 수, 일일 토큰 한도 |

## Phase 4: 운영 안정성

| 항목 | 설명 |
|------|------|
| PM2 설정 | 자동 재시작, ecosystem.config.js |
| 에러 알림 | 관리자 Slack DM |
| Basic Auth | Web UI 접근 제어 |
| E2E 테스트 | 주요 플로우 자동화 |

---

## 기술 스택
- Frontend: Vite + React 19 + TS + Tailwind + shadcn/ui
- State: TanStack Query
- Realtime: SSE
- Charts: Recharts
