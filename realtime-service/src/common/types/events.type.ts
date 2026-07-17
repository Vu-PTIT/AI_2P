// Event NestJS -> Client (và cũng là event FastAPI -> NestJS, cùng schema)
export type SttPartialEvent = {
  type: 'stt.partial';
  text: string;
  speaker: 'vi' | 'en';
  clientId: string | null;   // ← THÊM
  utteranceId: string;
};

export type SttFinalEvent = {
  type: 'stt.final';
  text: string;
  speaker: 'vi' | 'en';
  clientId: string | null;   // ← THÊM
  utteranceId: string;
};

export type TranslateTokenEvent = {
  type: 'translate.token';
  token: string;
  clientId: string | null;   // ← THÊM
  utteranceId: string;
};

export type TranslateDoneEvent = {
  type: 'translate.done';
  fullText: string;
  sourceText: string;
  speaker: 'vi' | 'en';
  clientId: string | null;   // ← THÊM
  utteranceId: string;
};

export type ErrorEvent = {
  type: 'error';
  code: string;
  message: string;
};

export type AiEvent =
  | SttPartialEvent
  | SttFinalEvent
  | TranslateTokenEvent
  | TranslateDoneEvent
  | ErrorEvent;

// Wrap thêm sessionId khi truyền qua EventEmitter nội bộ NestJS
export type AiEventPayload = AiEvent & { sessionId: string };