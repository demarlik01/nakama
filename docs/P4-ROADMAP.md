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

