# P4 Roadmap — Prompt & Behavior Tuning

> 목표: 에이전트 응답 품질/일관성 개선 + 프롬프트 표준화

---

## Phase 1: 기본 프롬프트 템플릿 시스템 ✅

- [x] 기본 AGENTS.md 템플릿 내장 (Persona/Boundaries/When To Speak/Response Behavior/Reporting Style)
- [x] 생성 시 `agentsMd` 비어있으면 템플릿 자동 적용
- [x] 유저가 제공한 `agentsMd`는 길이 무관하게 존중 (Codex 리뷰 반영)
- [x] 기존 에이전트 호환 유지

## Phase 2: 메모리 부트스트랩 표준화 ✅

- [x] 생성 시 `MEMORY.md` 자동 생성 (장기 기억 가이드)
- [x] 생성 시 `memory/` 폴더 + `memory/YYYY-MM-DD.md` 자동 생성
- [x] 메모리 파일 없어도 안전하게 동작 (graceful fallback)

## Phase 3: Skills 확장성 기반 ✅

- [x] 생성 시 `skills/` 폴더 자동 생성
- [x] `skills/README.md` 자동 생성 (구조/작성법/예시)

## Phase 4: 시스템 프롬프트 템플릿화 ✅

- [x] `SYSTEM_PROMPT_TEMPLATE` 상수 + `{{변수}}` 치환
- [x] `responseBehavior` 코드 분기 제거 → AGENTS.md 텍스트 위임
- [x] 워크스페이스 경계 보안 문구 복원 (`../` 절대경로 금지)
- [x] 템플릿 치환 fail-closed (알 수 없는 키 → 에러)

## Phase 5: 응답 적극성 제어 (다음)

**목표:** 프리셋 없이, 기본값은 적극적. 유저가 AGENTS.md에서 직접 조절.

- [ ] 기본 AGENTS.md 템플릿에 DM vs 그룹 정책 섹션 추가
- [ ] 그룹 응답 판단 체크리스트 내장 ("나한테 물어본 건가? 새 정보 있나? 누가 이미 답했나?")
- [ ] 과잉 응답 방지 규칙 강화

---

# P5 Roadmap — 채널 라우팅 & 슬래시 커맨드

> 목표: 봇 초대 → 즉시 사용 가능한 UX. 설정 파일 수동 편집 제거.

---

## 배경 & 결정사항

- 슬랙봇 1개 + 에이전트 N개 구조 (P3에서 확정)
- 에이전트-채널 매핑을 `agent.json`에서 동적으로 관리
- 스레드 기반 라우팅: 멘션 → 스레드 생성 → 스레드 내 대화 지속
- 컨시어지는 별도 에이전트가 아닌 라우터 fallback + 슬래시 커맨드 핸들러

## Phase 1: 채널 설정 구조 변경

**목표:** 채널별 모드(mention/proactive) 지원

```jsonc
// 기존
"slackChannels": ["C0AHPDVG7EF"]

// 신규
"channels": {
  "C0AHPDVG7EF": { "mode": "mention" },
  "C0BXYZ12345": { "mode": "proactive" }
}
```

- [ ] `ChannelConfig` 타입 정의: `{ mode: "mention" | "proactive" }`
- [ ] `agent.json` 로드 시 `slackChannels` → `channels` 자동 마이그레이션
- [ ] 새 에이전트는 `channels` 형식으로 생성
- [ ] `findBySlackChannel()` 등 기존 API 호환 유지
- [ ] Web UI 채널 설정 UI 업데이트

## Phase 2: 컨시어지 (라우터 fallback)

**목표:** 매핑 안 된 채널에서 봇 멘션 시 안내 응답

- [ ] 라우터에 fallback 로직: 매핑 없는 채널 → 고정 안내 메시지
- [ ] 안내 내용: 사용 가능한 에이전트 목록 + `/assign` 사용법
- [ ] LLM 호출 없이 룰 베이스 응답 (토큰 절약)

## Phase 3: 슬래시 커맨드

**목표:** 슬랙 안에서 에이전트-채널 매핑 관리

- [ ] `/assign {agent}` — 현재 채널에 에이전트 배정 (agent.json 업데이트)
- [ ] `/unassign` — 현재 채널 매핑 해제
- [ ] `/agents` — 사용 가능한 에이전트 목록 조회
- [ ] `/switch {agent}` — 채널 기본 에이전트 교체
- [ ] 권한 제어: 채널 관리자만 `/assign` 가능 (옵션)

## Phase 4: 스레드 라우팅 고도화

**목표:** 한 채널에서 여러 에이전트 자연스럽게 사용

- [ ] 기본 멘션 → 채널 기본 에이전트로 스레드 생성
- [ ] `@봇 /as {agent}` → 특정 에이전트로 스레드 생성
- [ ] 스레드 내 대화는 멘션 없이 해당 에이전트가 응답
- [ ] 스레드 시작 시 최근 채널 메시지 5~10개를 컨텍스트로 주입

## Phase 5: Proactive 모드 (미래)

**목표:** 에이전트가 채널을 감시하고 판단해서 끼어드는 모드

- [ ] `channelMode: "proactive"` 설정 시 채널 메시지 리스닝
- [ ] 끼어들기 판단 로직 (AGENTS.md 가이드라인 기반)
- [ ] 끼어들 때 새 스레드로 제안 (채널 오염 방지)
- [ ] 토큰 예산 관리 (모든 메시지를 LLM에 보내지 않음)

---

## 실행 흐름 요약

```
[봇 초대] → [매핑 없음] → 컨시어지 안내
                ↓
        /assign engineer
                ↓
[유저 멘션] → [라우터: 채널→에이전트] → [스레드 생성] → [대화]
                ↓
        @봇 /as analyst (다른 에이전트)
                ↓
        [별도 스레드 생성] → [analyst 세션]
```

## 운영 원칙

- 각 Phase는: 구현 → Codex 리뷰 → 빌드/테스트 → 커밋
- 위험 변경(마이그레이션/스키마 변경)은 사전 보고
- 기존 `slackChannels` 하위호환 필수
