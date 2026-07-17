# ViEnMeet

**Two languages. One conversation.**

ViEnMeet is a translation-first meeting product for near real-time
Vietnamese–English business conversations between two participants on separate
devices. This repository currently implements a clickable vertical slice:
meeting setup, terminology management, a deterministic bilingual conversation,
and an exportable meeting summary.

This repository intentionally contains no speech recognition, translation API,
authentication, database, or backend service.

## Product specification

[`REQUIREMENTS.md`](./REQUIREMENTS.md) is the authoritative PRD, target route
map, priority order, and acceptance checklist. Its MVP scope is broader than
the current vertical slice and includes dedicated create, join, device setup,
waiting-room, room-scoped meeting, and summary flows.

This README describes what is implemented now. Project execution rules are in
[`AGENTS.md`](./AGENTS.md), with compatible guidance for Claude in
[`CLAUDE.md`](./CLAUDE.md).

## Tech stack

- React 19.2
- Vite 8
- TypeScript 6 in strict mode
- Tailwind CSS 4
- React Router 8
- Zustand 5
- Lucide React
- Motion 12, the current Framer Motion package
- ESLint 10 flat config
- pnpm 10

Node.js 22.22 or newer is required.

## Run locally

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite.

## Commands

```bash
pnpm dev      # Start the Vite development server
pnpm build    # Type-check and create a production build
pnpm lint     # Run ESLint
pnpm preview  # Preview the production build
```

## Current prototype routes

| Route | Screen |
| --- | --- |
| `/` | Concise product landing page and conversation preview |
| `/create` | Create a local room and continue to setup |
| `/room/:roomId/setup` | Meeting details, mock microphone test, and glossary CRUD |
| `/room/:roomId` | Live bilingual meeting console and scripted demo |
| `/room/:roomId/summary` | Summary, actions, decisions, transcript, and browser export |

The old `/setup`, `/meeting`, and `/summary` paths redirect to a generated
room-scoped URL for compatibility.

## Implemented interactions

- Edit meeting and participant details
- Switch the entire interface between Vietnamese and English with the choice
  saved in the browser
- Switch automatic and push-to-talk conversation modes
- Select and test a mock microphone with deterministic levels
- Add, edit, and remove glossary terms
- Start and end a meeting
- Run or safely reset the deterministic four-turn conversation
- Progress through backend-shaped `stt.partial`, `stt.final`,
  `translate.token`, and `translate.done` events
- Toggle the microphone and swap the visible language order
- Use Space and Enter as simulated push-to-talk controls outside form fields
- Copy and correct translations
- Add and remove meeting notes
- Copy the summary
- Download a UTF-8 `.txt` transcript entirely in the browser
- Start another meeting while retaining the setup and glossary

## Prototype boundaries

The live experience is clearly labeled as scripted. Audio levels, connection
quality, latency, noise level, and translation states are mock values. The
translation mode is shown as **Deterministic mock**; the UI does not claim that
a cloud, local, or on-premise processing pipeline is active.

The room ID in the URL is the canonical future Socket.IO `sessionId` and
LiveKit `roomName`. A stable browser `clientId` is persisted locally for the
future LiveKit participant identity. The deterministic demo passes normalized
backend events through the same typed store reducer intended for a later
Socket.IO adapter.

The production connection remains intentionally disabled. Before enabling it,
the backend must distinguish simultaneous participant audio streams, attach a
participant identity to transcript events, and only report AI readiness after
the AI WebSocket is open. Current server events also omit sequence and timing
metadata, so the frontend derives those values locally until the contract is
extended.

## Project structure

```text
src/
├── app/                  # Router and application entry
├── components/
│   ├── landing/          # Landing conversation preview and benefit strip
│   ├── layout/           # Brand and page headers
│   ├── meeting/          # Feed, controls, sidebar, and status components
│   ├── setup/            # Setup form, microphone test, and glossary editor
│   └── ui/               # Shared accessible primitives
├── data/                 # Realistic mock meeting data
├── hooks/                # Clock, clipboard, PTT, and demo orchestration
├── i18n/                 # Typed English and Vietnamese dictionaries
├── lib/                  # Identity, realtime reducers, formatting, and utilities
├── pages/                # Four route-level page components
├── store/                # Typed Zustand meeting and locale stores
├── styles/               # Tailwind theme and global styles
└── types/                # Meeting, realtime contract, and i18n domain types
```
