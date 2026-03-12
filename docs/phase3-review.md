# Phase 3 Code Review — Codex

**Date:** 2026-03-13  
**Reviewer:** Codex (via OpenClaw subagent)  
**Scope:** Unstaged + untracked changes in `~/dev/agent-for-work/`

## Files Reviewed

| File | Status |
|------|--------|
| `src/core/session-files.ts` | Modified — 서브디렉토리 재귀 탐색 추가 |
| `web/src/pages/Sessions.tsx` | Modified — Chat UI → 세션 목록 테이블 |
| `web/src/pages/SessionDetail.tsx` | New — Chat UI 상세 페이지 |
| `web/src/components/ui/table.tsx` | New — shadcn Table 컴포넌트 |
| `web/src/App.tsx` | Modified — 라우트 추가 |

---

## Findings

### 🔴 HIGH

#### 1. Symlink path traversal gap in recursive session scan

- **Location:** `src/core/session-files.ts` L130, L153, L161
- **Description:** The fallback recursive scan accepts `.jsonl` paths based on `path.resolve` + `path.relative`, then reads them directly. A symlink inside `sessions/` can point outside the directory and still be read.
- **Impact:** Unintended server-side reads outside the session directory (at least metadata/parsing side effects), and potential DoS via large target files.
- **Fix direction:** Canonicalize with `realpath` before trust checks and skip symlinks (`lstat`) during recursion.

#### 2. Session updates are keyed by `agentId`, not session identity

- **Location:** `web/src/pages/Sessions.tsx` L84, L101, L122; `web/src/pages/SessionDetail.tsx` L67; `src/core/session.ts` L618, L686
- **Description:** `Sessions` and `SessionDetail` apply SSE updates by `agentId` only, but runtime/session events include `sessionKey`; this breaks correctness when an agent has multiple sessions.
- **Impact:** Wrong rows updated/removed, and detail view can show messages from another session of the same agent.
- **Fix direction:** Track/update by `sessionKey` (or emit `sessionId` consistently and route/filter by that).

---

### 🟡 MEDIUM

#### 3. Stale message state in `SessionDetail` on empty history

- **Location:** `web/src/pages/SessionDetail.tsx` L44
- **Description:** History load only calls `setMessages(...)` when `detail.messages.length > 0`; empty sessions leave old messages rendered.
- **Impact:** Incorrect UI data after navigation/refresh to an empty session.
- **Fix direction:** Clear state before/after fetch (`setMessages([])`), then populate if any messages exist.

#### 4. Table row navigation is mouse-only (a11y)

- **Location:** `web/src/pages/Sessions.tsx` L204
- **Description:** Click handler is on `<tr>` without keyboard semantics.
- **Impact:** Keyboard users cannot activate row navigation reliably.
- **Fix direction:** Use a real interactive element (`<Link>`/`<button>`) in a cell, or add `tabIndex`, `role="button"`, and `onKeyDown` handling.

---

### 🟢 LOW

#### 5. Type-safety weakened with broad string casts for session payloads

- **Location:** `web/src/pages/Sessions.tsx` L21, L130; `web/src/pages/SessionDetail.tsx` L24, L78
- **Description:** `status`/message role types are widened to `string`, with multiple unchecked `as string` casts from SSE payloads.
- **Impact:** Contract drift won't be caught at compile time; bad payloads can silently flow into UI state.
- **Fix direction:** Use shared union types and runtime guards for SSE data.

#### 6. Error handling is mostly `console.error` with no user feedback

- **Location:** `web/src/pages/Sessions.tsx` L69; `web/src/pages/SessionDetail.tsx` L55
- **Description:** Fetch failures are swallowed from UX perspective.
- **Impact:** Users see stale/empty states without actionable error messaging.
- **Fix direction:** Surface toast/inline error state and support retry UX.

---

## Notes

### `web/src/components/ui/table.tsx`
- Standard shadcn/ui Table component. No issues found — follows established patterns with proper `cn()` usage and slot-based data attributes.

### Open Questions / Assumptions

1. Multi-session per agent is assumed to be intended (given `sessionKey` usage and recursive session-file changes). If not, finding #2 severity drops.
2. Untrusted file content/symlinks may exist in workspace session dirs. If workspace is fully trusted, finding #1 is still worth hardening but lower risk.

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 High | 2 |
| 🟡 Medium | 2 |
| 🟢 Low | 2 |

**Recommendation:** Address findings #1 (symlink traversal) and #2 (session key routing) before merge. #3–#4 should be fixed in this phase. #5–#6 can be deferred but tracked.
