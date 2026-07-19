export type Language = 'vi' | 'en';

export type SttPartialEvent = {
  type: 'stt.partial';
  text: string;
  speaker: Language;
  clientId: string;
  utteranceId: string;
};

export type SttFinalEvent = {
  type: 'stt.final';
  text: string;
  speaker: Language;
  clientId: string;
  utteranceId: string;
};

/**
 * A best-effort translation of an in-progress utterance produced by the
 * fast path while the speaker is still talking.
 *
 * FE semantics: REPLACE the current translated caption for this
 * utteranceId. Do NOT append. A newer translate.partial for the same
 * utteranceId supersedes the previous one; translate.done supersedes
 * every translate.partial and locks the line.
 *
 * Unlike translate.token, this carries the FULL translated text so far,
 * not a delta. FE state can be a simple `Map<utteranceId, string>`.
 */
export type TranslatePartialEvent = {
  type: 'translate.partial';
  text: string;
  sourceText: string;
  speaker: Language;
  clientId: string;
  utteranceId: string;
};

export type TranslateTokenEvent = {
  type: 'translate.token';
  token: string;
  reset?: boolean;
  clientId: string;
  utteranceId: string;
};

export type TranslateDoneEvent = {
  type: 'translate.done';
  fullText: string;
  sourceText: string;
  speaker: Language;
  clientId: string;
  utteranceId: string;
};

export type SummaryPartialEvent = {
  type: 'summary.partial';
  summary: string;
  clientId: string;
};

export type SummaryDoneEvent = {
  type: 'summary.done';
  summary: string;
  clientId: string;
};

export type ErrorEvent = {
  type: 'error';
  code: string;
  message: string;
  clientId?: string;
};

export type AiEvent =
  | SttPartialEvent
  | SttFinalEvent
  | TranslatePartialEvent
  | TranslateTokenEvent
  | TranslateDoneEvent
  | SummaryPartialEvent
  | SummaryDoneEvent
  | ErrorEvent;

export type AiWorkerEvent =
  | Omit<SttPartialEvent, 'clientId'>
  | Omit<SttFinalEvent, 'clientId'>
  | Omit<TranslatePartialEvent, 'clientId'>
  | Omit<TranslateTokenEvent, 'clientId'>
  | Omit<TranslateDoneEvent, 'clientId'>
  | Omit<SummaryPartialEvent, 'clientId'>
  | Omit<SummaryDoneEvent, 'clientId'>
  | Omit<ErrorEvent, 'clientId'>;

type WithPipelineContext<T> = T extends unknown
  ? T & { sessionId: string; clientId: string }
  : never;

/**
 * Internal NestJS event. The AI worker does not decide participant identity;
 * the bridge attaches it from the WebSocket pipeline that produced the event.
 */
export type AiEventPayload = WithPipelineContext<AiWorkerEvent>;