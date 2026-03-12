# Dashboard Improvements v2 — OpenClaw 비교 분석

## 현재 문제점 + 개선안 (우선순위순)

### 1. 🔴 Sessions: 에이전트 단위가 아니라 세션 단위로 표시 (P0)
**현재:** 활성 세션만 에이전트별 1행으로 표시. 과거 세션 안 보임.  
**OpenClaw:** 세션 키(agent:claw:main, agent:claw:cron:xxx 등) 단위로 전체 표시.

**개선:**
- `/api/sessions/all` 또는 기존 API 확장 — 활성 + persisted 세션 모두 반환
- 각 에이전트의 persisted 세션을 모아서 세션 리스트에 포함
- 에이전트 필터 드롭다운 (All / dev-agent / writer-agent)
- 컬럼: Session ID, Agent, Status (active/archived), Messages, Created, Last Activity

### 2. 🔴 Sessions: Messages 수 0 표시 (P0)
**현재:** /api/sessions가 메시지 수를 반환하지 않음 → 항상 0.  
**개선:** 서버에서 persisted 세션의 messageCount 포함. 활성 세션도 실시간 카운트.

### 3. 🟠 SessionDetail: raw metadata가 메시지로 표시 (P1)
**현재:** "Conversation info (untrusted metadata)..." 가 그대로 사용자 메시지로 보임.  
**개선:** 메시지 content에서 metadata 블록을 파싱해서:
- "Conversation info" / "Sender" JSON 블록은 접기(Collapsible)로 숨기기
- 실제 사용자 텍스트만 메인 표시
- 또는 서버에서 파싱 시 metadata와 본문 분리

### 4. 🟠 상단 헤더 바 추가 (P1)
**OpenClaw:** 상단에 Version + Health + 테마 토글이 고정 헤더.  
**우리:** 사이드바에만 있어서 찾기 어려움.  
**개선:** Layout에 상단 바 추가, 사이드바 접기 버튼도 포함.

### 5. 🟡 Overview 보강 (P2)
**현재:** 카드 4개 + Agent Status만. 빈 공간 많음.  
**개선:** Slack 연결 상태, 최근 세션 활동 타임라인, 토큰 사용량 요약.

### 6. 🟡 Agents 카드 정보 보강 (P2)
**현재:** 모델명 + 채널 수만 표시.  
**개선:** 활성 세션 수, 마지막 활동, 총 메시지 수 추가.

### 7. 🟡 사이드바 접기 (P2)
**OpenClaw:** 햄버거 메뉴로 사이드바 토글.  
**개선:** collapse 버튼 + 아이콘 전용 모드.

### 8. ⚪ Empty State 개선 (P3)
데이터 없을 때 CTA 버튼 + 안내 메시지.

### 9. ⚪ 테마 토글 위치 (P3)
상단 헤더로 이동.

---

## Agents 페이지 개선 (OpenClaw 비교)

### 10. 🔴 Agents: 카드 → 마스터-디테일 레이아웃 (P0)
**OpenClaw:** 좌측 에이전트 리스트 + 우측 상세 (탭: Overview/Files/Tools/Skills/Channels/Cron Jobs)
**우리:** 카드 2개만 + 클릭하면 별도 AgentDetail 페이지로 이동. 빈 공간 많고 정보 부족.

**개선:**
- 좌측 에이전트 목록 (이모지/아바타 + 이름 + ID + 상태) + 우측 상세 패널
- 또는 현재 카드를 대폭 보강 (세션 수, 마지막 활동, 토큰 사용량 등)
- AgentDetail 탭 구조 참고: Overview / Sessions / Config / Cron Jobs

### 11. 🟠 Agents 카드: 정보 보강 (P1)
**현재:** 이름 + 한 줄 설명 + 모델 + Ch: 1
**개선:**
- 활성/총 세션 수 (예: "2 active / 5 total")
- 마지막 활동 시간
- 토큰 사용량 요약 (오늘/이번 주)
- 에이전트 상태 아이콘 (running 초록 / idle 회색)

### 12. 🟠 AgentDetail: 탭 추가 (P1)
**현재:** Overview / Sessions / Logs / Config 탭
**OpenClaw:** Overview / Files / Tools / Skills / Channels / Cron Jobs
**개선:** 우리 에이전트에 맞게 탭 정리
- Overview: workspace, 모델, 채널, 크론 정보
- Sessions: 이미 개선됨 (상세 네비게이션)
- Config: 인라인 에디팅
- Logs: 실시간 로그 (유지)
