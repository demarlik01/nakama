# P3 Roadmap — Multi-Agent & Persistence

> P2 완료: 2026-03-02 | P3 목표: 멀티 에이전트 운영 + 세션 영속화 + 운영 고도화

---

## Phase 1: 멀티 에이전트 슬랙 지원 🔧 (진행중)

**목표:** 슬랙 봇 하나로 여러 에이전트가 각자 이름/아이콘으로 응답

- [ ] agent.json에 `slackDisplayName`, `slackIcon` 필드 추가
- [ ] `chat.postMessage`에 `username`, `icon_emoji` 파라미터 전달
- [ ] Slack 앱 설정: "Allow bots to override name/icon" 활성화
- [ ] 메시지 라우팅 고도화: 채널/유저 → 에이전트 매핑 (겹침 시 우선순위)
- [ ] 멘션/DM 시 올바른 에이전트로 라우팅

## Phase 2: 세션 영속화

**목표:** 서버 재시작해도 대화 히스토리 유지, Web UI에서 조회 가능

- [ ] Pi SDK jsonl 세션 파일 그대로 활용 (SQLite 미러링 불필요)
- [ ] 세션 재개: 서버 재시작 후 기존 세션 복원 (jsonl 기반)
- [ ] Web UI: 세션별 대화 뷰어 (jsonl 파싱 → 메시지 목록/타임스탬프)
- [ ] 토큰 사용량 세션별 추적 연동
- [ ] 오래된 세션 파일 자동 정리 (TTL)
- [ ] (향후) 검색 필요 시 SQLite 레이어 추가

## Phase 3: 운영 고도화

**목표:** Web UI에서 에이전트 관리 완결 + 모니터링 강화

- [ ] 에이전트 생성 폼 완성 (agent.json + AGENTS.md 자동 생성)
- [ ] 에이전트 삭제 (확인 다이얼로그)
- [ ] 에이전트별 토큰 사용량 차트 (일별/주별)
- [ ] 알림 채널 커스터마이징 (에이전트별 에러 알림 채널 지정)
- [ ] LLM 프로바이더 추상화 (Anthropic → OpenAI/Gemini 확장 준비)

---

## 제외 (향후)
- Docker 기반 에이전트 격리
- Tailscale 외부 접근
- Pi SDK sandbox (격리 강화)
- 에이전트 간 협업
