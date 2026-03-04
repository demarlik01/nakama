# P6 Roadmap — 응답 품질 & 런타임 제어

> 목표: LLM이 언제 응답하고 언제 침묵할지 정확히 판단하도록 + 불필요한 응답 억제

---

## 배경

P5 테스트에서 발견된 문제:
1. 멘션 받았는데 "not mentioned"로 판단 → 멘션 메타데이터가 LLM에 전달 안 됨
2. "조용히 하겠다"면서 그 텍스트를 슬랙에 보냄 → 응답 억제 메커니즘 없음

## Phase 1: 메시지 메타데이터 주입

**목표:** LLM이 멘션 여부, 채널/DM 구분, 스레드 여부를 정확히 인지

- [ ] 유저 메시지에 컨텍스트 프리픽스 추가:
  ```
  [context: mentioned=true, channel=C0AHPDVG7EF, thread=true, event=app_mention]
  ```
- [ ] 또는 시스템 프롬프트에 동적 섹션으로 현재 대화 상태 주입
- [ ] 봇 멘션 텍스트(`<@U봇ID>`) 정리 — LLM에 깔끔한 텍스트 전달

## Phase 2: 응답 억제 (NO_REPLY / SILENT)

**목표:** LLM이 "응답 안 함"을 선택할 수 있는 메커니즘

- [ ] AGENTS.md 템플릿에 `NO_REPLY` 규칙 추가: "응답이 불필요하면 정확히 `NO_REPLY`만 반환"
- [ ] 슬랙 핸들러에서 LLM 응답이 `NO_REPLY` / `SILENT` / `HEARTBEAT_OK`이면 슬랙에 안 보냄
- [ ] 빈 응답도 슬랙에 안 보냄 (빈 문자열 / whitespace only)

## Phase 3: 응답 품질 가드레일

**목표:** 메타설명("나는 조용히 하겠다") 같은 비정상 응답 필터링

- [ ] 응답 내용이 메타코멘트인지 감지 (예: "stays silent", "I'll skip this")
- [ ] 감지되면 슬랙에 안 보냄 (NO_REPLY 처리)
- [ ] 로그에 기록 (디버깅용)

---

## 운영 원칙

- 각 Phase: 구현 → Codex 리뷰 → 빌드/테스트 → 커밋
- LLM 행동 변경은 실제 슬랙에서 수동 테스트 필수
