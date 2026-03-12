# Phase 2 Code Review — Chat UI

**Reviewer:** Codex (gpt-5.3-codex)  
**Date:** 2026-03-13  
**Scope:** Phase 2 unstaged changes in `web/` directory

## Files Reviewed

| File | Status |
|------|--------|
| `web/src/pages/Sessions.tsx` | Modified (전면 재작성) |
| `web/src/components/chat/ChatBubble.tsx` | New |
| `web/src/components/chat/ToolCallBlock.tsx` | New |
| `web/src/components/chat/SessionSelect.tsx` | New |
| `web/src/components/ui/collapsible.tsx` | New (shadcn primitive) |
| `web/src/components/ui/scroll-area.tsx` | New (shadcn primitive) |

## Automated Checks

- **TypeScript (`tsc --noEmit`):** ✅ Pass (only pre-existing warning in `useEventSource.ts` — unused `useCallback` import)
- **ESLint:** ✅ Pass — no warnings or errors on all 4 reviewed files

---

## Critical

None found.

---

## Warning

### 1. Unchecked SSE type casts weaken type safety
SSE event data is cast directly (`as string`, `as "user" | "assistant"`) without runtime validation. Malformed server events can silently corrupt UI state.

**Files:** `Sessions.tsx` L65, L95, L113–116

**Fix:** Add a runtime guard/parser (e.g., Zod schema or manual check) before writing SSE data into state.

---

### 2. Suppressed hook dependency on `selected` — stale closure risk
`useCallback` for the SSE handler suppresses `selected` in the dependency array via eslint-disable. The closure reads `selected` but won't re-create when it changes, leading to stale reads.

**Files:** `Sessions.tsx` L54, L60

**Fix:** Use a ref (`selectedRef.current`) to read the latest value inside the callback, or include `selected` in deps and memoize downstream.

---

### 3. `selected` not reconciled on session list refresh
When sessions are refreshed/removed, `selected` may still point to a session that no longer exists. No check resets it.

**Files:** `Sessions.tsx` L85–86, L133, L140, L145

**Fix:** After fetching sessions, verify `selected` is still in the new list; if not, reset to `null` or the first available session.

---

### 4. Accessibility: icon-only buttons lack `aria-label`
Icon-only buttons (refresh, expand/collapse, send) and the session select trigger have no accessible names.

**Files:** `Sessions.tsx` L202, L205 · `ChatBubble.tsx` L81 · `SessionSelect.tsx` L33

**Fix:** Add `aria-label` to all icon-only `<Button>` elements and `<SelectTrigger>`.

---

### 5. Enter-to-send breaks CJK IME composition
`handleKeyDown` fires send on bare Enter without checking `e.nativeEvent.isComposing`. Korean/Japanese/Chinese users will trigger send mid-composition.

**Files:** `Sessions.tsx` L151

**Fix:**
```tsx
if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
```

---

### 6. Performance: full message list re-renders on every input change
Typing in the textarea triggers a state update → full re-render of all `<ChatBubble>` components (each re-parsing markdown). No virtualization for long transcripts.

**Files:** `Sessions.tsx` L232, L247 · `ChatBubble.tsx` L75

**Fix (short-term):** Wrap `ChatBubble` in `React.memo()`. Extract the input area into a separate component so its state changes don't propagate to the message list.

**Fix (long-term):** Add virtualization (`@tanstack/react-virtual` or similar) for sessions with 100+ messages.

---

### 7. Index-based keys risk reconciliation bugs
Message lists use array index as `key`. If messages are inserted/reordered (e.g., optimistic updates), React may reuse wrong DOM nodes.

**Files:** `Sessions.tsx` L234 · `ChatBubble.tsx` L60

**Fix:** Use a stable identifier — `timestamp + role + index` composite, or assign message IDs server-side.

---

### 8. Weak error handling for fetch and clipboard
- Session/message fetch errors are only `console.error`'d — no user-visible feedback.
- Clipboard `navigator.clipboard.writeText()` failure is uncaught.

**Files:** `Sessions.tsx` L58, L147 · `ChatBubble.tsx` L25

**Fix:** Add toast/snackbar for fetch failures. Wrap clipboard calls in try/catch with fallback feedback.

---

## Suggestion

### 1. Harden react-markdown XSS posture
Current usage is safe (no `dangerouslySetInnerHTML`, `react-markdown` v10 strips raw HTML by default). To prevent future regressions:

```tsx
<Markdown skipHtml allowedElements={["p","strong","em","code","pre","a","ul","ol","li","h1","h2","h3","blockquote"]}>
  {content}
</Markdown>
```

**Files:** `ChatBubble.tsx` L75

---

### 2. Memoize ChatBubble and stabilize derived props
`ChatBubble` is a pure display component — wrapping with `React.memo` is free perf. Also stabilize the `sessions.map(...)` derivation in `SessionSelect` with `useMemo`.

**Files:** `ChatBubble.tsx` L21 · `Sessions.tsx` L193

---

## Open Questions

1. **Max message count per session?** — Determines whether virtualization is required now vs. later.
2. **Can backend emit unexpected roles/status values?** — If yes, runtime guards are mandatory (Warning #1).
3. **Enter-to-send policy** — Should it be Ctrl/Cmd+Enter instead of bare Enter? Configurable?

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Warning | 8 |
| Suggestion | 2 |

Overall the code is clean, well-structured, and follows good React patterns. The main areas to address before shipping are: **IME composition handling** (Warning #5 — will break Korean input), **aria-labels** (Warning #4), and **stale `selected` state** (Warnings #2–3). Performance items (Warnings #6–7) can be deferred if message counts stay low during initial rollout.
