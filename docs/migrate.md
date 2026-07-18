# Streaming Captions — Frontend Integration Guide

This document describes the WebSocket event contract and the state machine
FE must implement to render Google Meet-style live captions with real-time
translation.

## What changed

Previously the FE flow was:

1. `stt.partial` → grey Vietnamese caption updating
2. `stt.final` → black Vietnamese caption locked
3. `translate.token` → English caption streaming in token-by-token
4. `translate.done` → English caption locked

Now there is an intermediate step: while the user is still talking, the
backend also translates the ASR partial and sends `translate.partial`
events. The English caption starts appearing WHILE the Vietnamese is
still being spoken, then gets replaced by the final translation.

New timeline:

1. `stt.partial` → grey VI caption updating (~every 600ms)
2. `translate.partial` → grey EN caption updating alongside (~every 1-2s)
3. `stt.final` → black VI caption locked
4. `translate.token` (stream) → black EN caption streaming
5. `translate.done` → black EN caption locked

## Event contract

All events share these fields:

```ts
{
  type: string,
  clientId: string,       // which participant produced this
  utteranceId: string,    // groups all events for one spoken sentence
  displayName?: string,   // added by the NestJS bridge for convenience
}
```

Events are always Socket.IO events named by their `type` string.

### `stt.partial`

Interim ASR transcript. Full text so far, not a delta. Replace the source
caption for this utteranceId.

```ts
{
  type: 'stt.partial',
  text: string,           // full Vietnamese text so far
  speaker: 'vi' | 'en',   // source language of the speaker
  sourceLang: 'vi' | 'en',
  stability: number,      // 0.0-0.6 for partials
  overlap: boolean,       // true if multiple speakers detected
  utteranceId: string,
  clientId: string,
}
```

### `stt.final`

Final ASR transcript. Lock the source caption.

```ts
{
  type: 'stt.final',
  text: string,
  speaker: 'vi' | 'en',
  sourceLang: 'vi' | 'en',
  stability: number,      // typically > 0.6
  overlap: boolean,
  utteranceId: string,
  clientId: string,
}
```

### `translate.partial` (NEW)

Interim translation of the current partial. Full translated text so far,
NOT a delta. Replace the translated caption for this utteranceId.

```ts
{
  type: 'translate.partial',
  text: string,           // full translation so far
  sourceText: string,     // the source text this translation is for
  speaker: 'vi' | 'en',
  utteranceId: string,
  clientId: string,
}
```

Multiple `translate.partial` events can arrive for the same
utteranceId, each replacing the previous one. They may arrive in
rapid succession or slightly out of order relative to `stt.partial` —
always trust the LATEST event received.

### `translate.token`

Streamed delta for the FINAL translation. Concatenate to the existing
translated text.

```ts
{
  type: 'translate.token',
  token: string,          // delta to append
  reset?: boolean,        // if true, clear buffer and start fresh
  utteranceId: string,
  clientId: string,
}
```

Note: on the first `translate.token` for a given utteranceId, you should
CLEAR whatever `translate.partial` had put there and start streaming
tokens fresh. If `reset: true` is set on any token, also clear the buffer
(server signals a mid-stream restart, e.g. quality → fast fallback).

### `translate.done`

Final translation locked. This is the source of truth; any partial or
streamed content should be overwritten by `fullText`.

```ts
{
  type: 'translate.done',
  fullText: string,       // the definitive translation
  sourceText: string,
  speaker: 'vi' | 'en',
  utteranceId: string,
  clientId: string,
}
```

### `error`

Any non-fatal error. Common codes:

- `AI_NOT_READY` — send audio before session.ready ACK
- `RAW_TRANSCRIPT` — translation failed, showing source text as translation
- `AI_MODEL_UNAVAILABLE` / `AI_PIPELINE_ERROR` — hard failure this turn
- `AI_CONN_ERROR` / `AI_CONN_CLOSED` — worker disconnected

## Caption line state machine

For every `utteranceId` maintain a single "caption line" with this shape:

```ts
type CaptionLine = {
  utteranceId: string;
  clientId: string;
  displayName?: string;
  speaker: 'vi' | 'en';

  // Source (VI)
  sourceText: string;
  sourceStatus: 'partial' | 'final';

  // Translation (EN)
  translatedText: string;
  translationStatus: 'partial' | 'streaming' | 'final';
  hasStreamStarted: boolean;   // has translate.token fired yet?

  createdAt: number;           // for sorting
};
```

### Reducer

```ts
function reduce(lines: Map<string, CaptionLine>, event: AiEvent): Map<string, CaptionLine> {
  const next = new Map(lines);
  const existing = next.get(event.utteranceId);

  switch (event.type) {
    case 'stt.partial': {
      next.set(event.utteranceId, {
        ...blankLine(event),
        ...existing,
        sourceText: event.text,        // REPLACE
        sourceStatus: 'partial',
      });
      return next;
    }

    case 'stt.final': {
      next.set(event.utteranceId, {
        ...blankLine(event),
        ...existing,
        sourceText: event.text,        // REPLACE with final
        sourceStatus: 'final',
      });
      return next;
    }

    case 'translate.partial': {
      // Ignore if translate.token has already started streaming for
      // this utterance — token stream is more authoritative.
      if (existing?.hasStreamStarted) return next;

      next.set(event.utteranceId, {
        ...blankLine(event),
        ...existing,
        translatedText: event.text,    // REPLACE
        translationStatus: 'partial',
      });
      return next;
    }

    case 'translate.token': {
      const line = existing ?? blankLine(event);
      const startingStream = !line.hasStreamStarted || event.reset;
      const baseText = startingStream ? '' : line.translatedText;

      next.set(event.utteranceId, {
        ...line,
        translatedText: baseText + event.token,   // APPEND
        translationStatus: 'streaming',
        hasStreamStarted: true,
      });
      return next;
    }

    case 'translate.done': {
      next.set(event.utteranceId, {
        ...blankLine(event),
        ...existing,
        translatedText: event.fullText,   // REPLACE with final
        translationStatus: 'final',
        hasStreamStarted: true,
      });
      return next;
    }

    default:
      return next;
  }
}

function blankLine(event: any): CaptionLine {
  return {
    utteranceId: event.utteranceId,
    clientId: event.clientId,
    displayName: event.displayName,
    speaker: event.speaker ?? event.sourceLang ?? 'vi',
    sourceText: '',
    sourceStatus: 'partial',
    translatedText: '',
    translationStatus: 'partial',
    hasStreamStarted: false,
    createdAt: Date.now(),
  };
}
```

### Key rules

1. **REPLACE vs APPEND**:
   - `stt.partial`, `stt.final`, `translate.partial`, `translate.done`
     → REPLACE the field with the new value.
   - `translate.token` → APPEND to `translatedText`.

2. **Precedence**: once `translate.token` has fired for a utterance,
   ignore further `translate.partial` events for that utterance
   (the `hasStreamStarted` guard). This prevents a slow partial from
   overwriting an already-streaming final translation.

3. **`translate.done` always wins**. Its `fullText` is the source of
   truth even if it disagrees with what tokens streamed.

4. **Line identity is `utteranceId`**. Never key on clientId+timestamp
   or on the text itself.

## Rendering

Suggested styles:

```css
.caption-source-partial   { color: #999; font-style: italic; }
.caption-source-final     { color: #000; }
.caption-translated-partial   { color: #999; font-style: italic; }
.caption-translated-streaming { color: #444; }
.caption-translated-final     { color: #000; }
```

The italic-grey → black transition matches what Meet does and gives users
a clear signal that partials are provisional.

## Example: React with useReducer

```tsx
import { useEffect, useReducer } from 'react';
import { io, Socket } from 'socket.io-client';

type CaptionState = Map<string, CaptionLine>;

function captionReducer(state: CaptionState, event: AiEvent): CaptionState {
  return reduce(state, event);  // the function above
}

export function useLiveCaptions(socketUrl: string, query: Record<string, string>) {
  const [lines, dispatch] = useReducer(captionReducer, new Map());

  useEffect(() => {
    const socket: Socket = io(socketUrl, { query, transports: ['websocket'] });

    const events = [
      'stt.partial', 'stt.final',
      'translate.partial', 'translate.token', 'translate.done',
    ];
    events.forEach(name => {
      socket.on(name, (payload) => dispatch({ type: name, ...payload }));
    });

    return () => { socket.disconnect(); };
  }, [socketUrl]);

  // Sort by createdAt so lines render in speaking order.
  return Array.from(lines.values()).sort((a, b) => a.createdAt - b.createdAt);
}
```

Render:

```tsx
function CaptionList() {
  const lines = useLiveCaptions('wss://api.example.com/audio', {
    sessionId, clientId, language: 'vi',
  });

  return (
    <div>
      {lines.map(line => (
        <div key={line.utteranceId}>
          <strong>{line.displayName ?? line.clientId}:</strong>
          <div className={`caption-source-${line.sourceStatus}`}>
            {line.sourceText}
          </div>
          <div className={`caption-translated-${line.translationStatus}`}>
            {line.translatedText}
          </div>
        </div>
      ))}
    </div>
  );
}
```

## Edge cases

### Out-of-order events

Rare but possible over lossy networks. Rules:

- A newer `translate.partial` for the same utteranceId always wins over
  an older one (each carries the full text so ordering within partials
  doesn't matter much).
- A `translate.done` always wins, even if a `translate.partial` arrives
  after it. Guard: after receiving `translate.done` for a utterance, drop
  further partials for that same utteranceId. Add this to the reducer if
  observed in practice:

  ```ts
  case 'translate.partial':
    if (existing?.translationStatus === 'final') return next;
    // ...
  ```

### Reconnect

When the socket reconnects mid-meeting, any partials that were
in-flight are lost. Users will see a gap for one utterance. This is
acceptable — do not attempt to replay past events; the server does not
store them.

### Speaker switch mid-utterance

If the user hits a language toggle while speaking, the backend
finalizes the current utterance first, then switches. FE receives a
normal `stt.final` + `translate.done` for the pre-switch content.
After switching, subsequent events arrive with the new `speaker`.

### Bounded history

Cap the `Map` to the last ~200 utterances to avoid memory bloat in
long meetings:

```ts
if (next.size > 200) {
  const oldest = Array.from(next.values())
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, next.size - 200);
  oldest.forEach(line => next.delete(line.utteranceId));
}
```

### Session lifecycle

The gateway may still emit these existing events:

- `session.ready` — session initialized, ok to send audio
- `session.ended` — meeting ended, disconnect
- `session.participants` — participant list changed
- `system.status` — pipeline health degraded/recovered

None of these interact with the caption reducer; handle them separately
in a session-level slice.

## Testing checklist

- [ ] Say a 5-second sentence and confirm the English caption starts
      appearing while you're still talking, not after you stop.
- [ ] Pause mid-sentence (~600ms) and confirm the utterance does NOT
      split into two lines. The English caption should continue growing
      after the pause.
- [ ] Say a 15-second sentence and confirm the caption doesn't freeze —
      partials keep updating throughout.
- [ ] Trigger a fast-path fallback (kill quality LLM) and confirm the
      final translation still arrives, possibly with `reset: true` on
      the token stream.
- [ ] Have two participants speak simultaneously and confirm each
      utterance stays keyed to its own line.
- [ ] Kill the WebSocket mid-utterance and reconnect; confirm the FE
      recovers without stuck grey text.

## FAQ

**Q: The English caption sometimes flickers between two versions.**
Almost always the reducer is missing the `hasStreamStarted` guard, so
a late `translate.partial` overwrites the streamed final. Add the guard.

**Q: The English caption never appears until the user stops talking.**
Check the backend `PARTIAL_TRANSLATE_ENABLED` env var. Also check
`session.ready` payload for `partialTranslateEnabled: true`.

**Q: I see `translate.partial` events but they're always identical.**
The backend debounces with `PARTIAL_TRANSLATE_MIN_DELTA_WORDS`. If the
user is speaking slowly, updates will be coarse (every 2-3 words). Lower
the env var to get finer updates at the cost of more FPT calls.

**Q: Should I show `stability` to the user?**
No. It's exposed for logging/debugging only.