# P9 Roadmap — UX 개선, 확장 툴, 지식 검색

> P8 완료 후 진행. 실사용 임팩트 기준 우선순위 정리.
> 리서치 기반: [p8-research.md](./p8-research.md)

---

## 우선순위 범례

- 🔴 P0 — 실사용 임팩트 최대, 먼저 구현
- 🟠 P1 — 높은 가치, P0 이후 순차 진행
- 🟡 P2 — 가치 있지만 급하지 않음
- ⚪ P3 — 미래 검토 항목

난이도: `S` (1~2일) / `M` (3~5일) / `L` (1~2주) / `XL` (2주+)

---

## 🔴 P0 — 핵심 기능 확장

### 1. Webhook / 외부 이벤트 트리거

**난이도: M | 임팩트: 높음**

현재 에이전트는 크론/하트비트로만 능동 행동 가능. 외부 시스템 이벤트(GitHub PR, Jira 이슈 등)에 반응하지 못함.

**구현 방안:**
- `POST /api/agents/:id/webhook` 엔드포인트 추가
- 페이로드를 에이전트 메시지로 변환하여 세션에 주입
- 시크릿 기반 인증 (HMAC or Bearer token)
- agent.json에 `webhooks` 설정 추가

**사용 예시:**
```
GitHub PR created → webhook → 에이전트가 자동 코드 리뷰
Jira ticket assigned → webhook → 에이전트가 분석 시작
배포 알림 → webhook → 에이전트가 모니터링 체크
```

**체크리스트:**
- [ ] Webhook 엔드포인트 구현 (인증 + 페이로드 파싱)
- [ ] agent.json `webhooks` 설정 스키마
- [ ] GitHub/Jira 등 주요 소스 페이로드 변환 템플릿
- [ ] Web UI에서 webhook URL 확인 + 테스트 전송
- [ ] rate limit / replay 방어

---

### 2. Slack Interactive Components (버튼/모달)

**난이도: M | 임팩트: 높음**

에이전트 응답이 텍스트만 가능. 승인 요청, 선택지 제시, 진행 상황 업데이트 등에 인터랙티브 UI가 필요.

**구현 방안:**
- Block Kit 빌더 유틸리티 (현재 block-kit.ts 확장)
- 에이전트 응답에서 `ACTION:` 토큰 또는 전용 tool로 버튼/선택지 생성
- `app.action()` 핸들러로 유저 인터랙션 수신 → 에이전트에 결과 전달
- 승인 워크플로우: 에이전트가 위험 명령 전 확인 요청

**사용 예시:**
```
에이전트: "PR #142 머지할까요?"
[머지] [취소] [코멘트 추가]  ← 버튼
유저 클릭 → 에이전트 후속 행동
```

**체크리스트:**
- [ ] Block Kit 버튼/셀렉트 생성 유틸리티
- [ ] Slack `app.action()` 핸들러 → 에이전트 세션 연결
- [ ] 에이전트 → 인터랙티브 메시지 전송 메커니즘 (tool or 토큰)
- [ ] 승인 워크플로우 기본 패턴 (confirm → execute)
- [ ] 타임아웃 처리 (유저가 안 누르면?)
- [ ] 테스트: 버튼 클릭 → 에이전트 응답

---

### 3. Slack 메시지 히스토리 검색

**난이도: S~M | 임팩트: 높음**

에이전트가 Slack 채널/스레드의 과거 메시지를 검색할 수 없음. 팀 맥락을 이해하려면 필수.

**구현 방안:**
- `slack_search` 커스텀 툴 추가
- Slack `search.messages` API 활용
- 검색 쿼리 + 채널/날짜 필터 지원
- 결과를 마크다운으로 포맷팅하여 LLM에 전달
- 필요 스코프: `search:read`

**체크리스트:**
- [ ] `slack_search` 툴 구현 (Slack API wrapper)
- [ ] 검색 결과 → LLM 친화적 마크다운 변환
- [ ] agent.json `tools` 배열에 `slack_search` 추가 가능하게
- [ ] 채널 접근 권한 고려 (에이전트가 속한 채널만)
- [ ] 테스트: "지난주 #dev 채널에서 배포 관련 논의 찾아줘"

---

## 🟠 P1 — 중요 개선

### 4. 지식 베이스 / RAG (벡터 검색)

**난이도: L~XL | 임팩트: 높음**

현재 에이전트의 도메인 지식은 `docs/` 폴더에 파일로 저장. 파일이 많아지면 LLM이 어떤 파일을 읽어야 할지 모름. 경쟁사(Dust, Moveworks)는 RAG가 핵심 기능.

**구현 방안 (단계적):**

Phase A: 로컬 벡터 검색 (SQLite + 벡터 확장)
- `knowledge_search` 커스텀 툴 추가
- 워크스페이스 `docs/` 하위 파일 자동 인덱싱
- 임베딩: Anthropic/OpenAI embedding API
- 벡터 저장: `sqlite-vec` 또는 `better-sqlite3` + 벡터 컬럼
- 파일 변경 시 자동 re-index (fs.watch)

Phase B: 외부 데이터소스 커넥터 (후속)
- Google Drive, Notion, Confluence 등 연동
- 주기적 동기화 + 증분 업데이트

**체크리스트 (Phase A):**
- [ ] 임베딩 API 연동 (Anthropic Voyage or OpenAI)
- [ ] 문서 청킹 로직 (마크다운 heading 기반 분할)
- [ ] SQLite 벡터 저장소 구현
- [ ] `knowledge_search` 툴 구현
- [ ] 파일 변경 감지 → 자동 re-index
- [ ] 시스템 프롬프트에 검색 도구 안내 추가
- [ ] 테스트: 코딩 컨벤션 문서 인덱싱 → 질문 → 정확한 참조 반환

---

### 5. MCP (Model Context Protocol) 도구 통합

**난이도: L | 임팩트: 중간-높음**

업계가 MCP를 도구 통합 표준으로 수렴 중. MCP 서버를 연결하면 GitHub, Jira, Linear, Google Calendar 등 외부 서비스를 에이전트가 직접 조작 가능.

**구현 방안:**
- MCP 클라이언트 라이브러리 통합
- agent.json에 `mcpServers` 설정 추가
- MCP 서버의 도구 목록을 Pi SDK AgentTool로 자동 변환
- 에이전트별 MCP 서버 구성 가능

**사용 예시:**
```json
"mcpServers": {
  "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
  "linear": { "command": "npx", "args": ["-y", "mcp-linear"] }
}
```

**체크리스트:**
- [ ] MCP 클라이언트 통합 (`@modelcontextprotocol/sdk`)
- [ ] MCP tool → Pi SDK AgentTool 어댑터
- [ ] agent.json `mcpServers` 스키마 + 세션 시작 시 MCP 서버 spawn
- [ ] MCP 서버 생명주기 관리 (에이전트 세션과 연동)
- [ ] 테스트: GitHub MCP 서버 연결 → 에이전트가 PR 목록 조회

---

### 6. 에이전트 간 메시지 전달 (Inter-Agent Communication)

**난이도: M | 임팩트: 중간**

현재 에이전트 간 직접 소통 불가. `_shared/` 폴더로 파일 공유만 가능. 업계는 A2A 프로토콜 수준의 에이전트 간 통신으로 진화 중.

**구현 방안 (최소 구현):**
- `delegate` 커스텀 툴: 다른 에이전트에게 메시지 전송
- Router가 내부적으로 대상 에이전트 세션에 메시지 주입
- 응답을 호출 에이전트에 반환 (동기 또는 비동기)

**사용 예시:**
```
engineer 에이전트: "marketer에게 이 기능의 릴리스 노트 초안 부탁해"
→ delegate("marketer", "다음 기능의 릴리스 노트 초안 작성해줘: ...")
→ marketer 에이전트가 처리 후 결과 반환
```

**체크리스트:**
- [ ] `delegate` 툴 정의 (대상 에이전트 ID + 메시지)
- [ ] SessionManager를 통한 에이전트 간 메시지 라우팅
- [ ] 응답 수신 메커니즘 (콜백 or 폴링)
- [ ] 순환 호출 방지 (최대 depth 제한)
- [ ] 테스트: engineer → marketer 위임 → 결과 수신

---

### 7. 감사 로그 & 도구 호출 트레이스

**난이도: M | 임팩트: 중간**

에이전트가 어떤 도구를 호출했는지, 어떤 판단을 내렸는지 추적이 어려움. 엔터프라이즈 환경에서 거버넌스/감사 필수.

**구현 방안:**
- 도구 호출마다 구조화된 로그 기록 (도구명, 입력, 출력 요약, 소요 시간)
- 세션별 트레이스 뷰어 (Web UI)
- API 엔드포인트: `GET /api/agents/:id/sessions/:sid/trace`
- 민감 정보 마스킹 옵션

**체크리스트:**
- [ ] 도구 호출 이벤트 로깅 구조 설계
- [ ] 세션 파일(jsonl)에 도구 호출 메타데이터 포함
- [ ] Web UI 트레이스 뷰어
- [ ] API 엔드포인트
- [ ] 민감 정보 필터 (API 키, 토큰 등)

---

## 🟡 P2 — 가치 있지만 급하지 않음

### 8. Web UI 사용성 개선

**난이도: M~L | 임팩트: 중간**

기존 P8에 있던 항목. 대시보드를 실제로 쓸 만하게 개선.

**Sessions 탭:**
- 세션 상세 영역 넓은 레이아웃 or 확장/축소
- 메시지 말풍선 UI (user/assistant 구분, 마크다운 렌더링)
- 세션 ID 대신 읽기 쉬운 이름/요약 표시
- 토큰 사용량 시각화

**Logs 탭:**
- 기존 로그 히스토리 로딩 (현재 실시간만)
- 세션별/에이전트별 로그 필터링
- 에러 로그 하이라이트

**전반:**
- 모바일 반응형
- 에이전트 카드에 아이콘/상태 표시
- 세션 검색/필터

---

### 9. 슬래시 커맨드 권한 제어

**난이도: S | 임팩트: 낮음-중간**

P5에서 이관된 항목. `/crew assign` 등 채널 관리 커맨드를 채널 관리자만 사용 가능하도록 제한.

- Slack `conversations.info` 또는 멤버 역할 조회로 권한 확인
- 옵션 설정으로 on/off 가능 (기본 off = 누구나 사용 가능)

---

### 10. 브라우저 도구

**난이도: L | 임팩트: 중간**

`web_fetch`로 안 되는 JS 렌더링 페이지(SPA) 접근용.

- Playwright/Puppeteer 기반 headless 브라우저
- 페이지 스냅샷 → 마크다운 변환
- 보안: URL 화이트리스트 or 내부 네트워크 제한
- 리소스 한도: 탭 수, 타임아웃

---

### 11. 메모리 용량 관리 자동화

**난이도: S~M | 임팩트: 중간**

P7에서 남은 항목. 오래된 daily memory 파일 정리 + MEMORY.md 크기 관리.

- 정리 정책: N일 이상 된 daily 파일 아카이브 or 삭제
- MEMORY.md 크기 한도 + 자동 요약 (하트비트에서 주기적 실행)
- 설정: agent.json `memory.retentionDays`, `memory.maxSizeKB`

---

## ⚪ P3 — 미래 검토

### 12. 멀티 채널 추상화 (Teams, Discord 등)

**난이도: XL | 임팩트: 장기**

Slack 전용 → 채널 추상화 레이어로 Teams/Discord/웹 지원.

- `ChannelAdapter` 인터페이스 정의
- SlackAdapter, TeamsAdapter, DiscordAdapter 구현
- 메시지 라우터가 어댑터를 통해 채널에 독립적으로 동작

---

### 13. 에이전트 템플릿 마켓플레이스

**난이도: L | 임팩트: 장기**

사전 정의된 역할 템플릿(코드 리뷰어, 마케터, CS 도우미 등)을 원클릭 설치.

- 템플릿 = AGENTS.md + 추천 tools + HEARTBEAT.md + docs/ 번들
- Web UI에서 "에이전트 추가 → 템플릿 선택" UX
- 커뮤니티 공유 가능한 포맷

---

### 14. 서브에이전트 위임 (spawn_agent)

**난이도: L | 임팩트: 장기**

에이전트가 오래 걸리는 작업을 서브에이전트로 위임. OpenClaw `sessions_spawn` 패턴 참고.

- 메인 에이전트가 `spawn_agent` 도구로 서브 작업 위임
- 서브에이전트는 별도 세션에서 실행
- 완료 시 결과를 메인 에이전트에 push
- 타임아웃 + 리소스 제한

---

## 실행 계획 요약

```
P0 (즉시)     P1 (다음)      P2 (안정화 후)   P3 (미래)
─────────    ──────────     ────────────    ──────────
Webhook      RAG/벡터검색    Web UI 개선     멀티채널
Interactive  MCP 통합        권한 제어       에이전트 템플릿
Slack검색    에이전트간통신   브라우저         서브에이전트
             감사로그        메모리 관리
```

---

## 운영 원칙

- 각 항목: 구현 → 리뷰 → 빌드/테스트 → 커밋
- P0 항목은 실제 슬랙 테스트 필수
- 리서치 기반 결정이므로, 실사용 후 우선순위 재조정 가능
