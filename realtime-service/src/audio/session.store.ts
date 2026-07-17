import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';

export type ServerSession = {
  id: string;
  domain: string;
  languagePair: string;
  startedAt: Date;
  endedAt?: Date;
  utterances: Array<{
    id: string;
    speaker: 'vi' | 'en';
    clientId: string | null;              
    sourceText: string;
    translatedText: string;
    timestamp: number;
  }>;
  clientSockets: Map<string, Socket>;
  currentSpeakerClientId: string | null;  
};

@Injectable()
export class SessionStore {
  private readonly logger = new Logger(SessionStore.name);
  private sessions = new Map<string, ServerSession>();

  create(id: string, domain: string, languagePair: string): ServerSession {
    const session: ServerSession = {
      id,
      domain,
      languagePair,
      startedAt: new Date(),
      utterances: [],
      clientSockets: new Map(),
      currentSpeakerClientId: null,        
    };
    this.sessions.set(id, session);
    this.logger.log(`Session created: ${id}`);
    return session;
  }

  get(id: string): ServerSession | undefined {
    return this.sessions.get(id);
  }

  getOrCreate(id: string, domain = 'business', languagePair = 'vi-en'): ServerSession {
    return this.sessions.get(id) ?? this.create(id, domain, languagePair);
  }

  addClient(sessionId: string, clientId: string, client: Socket): void {
    this.sessions.get(sessionId)?.clientSockets.set(clientId, client);
  }

  removeClient(sessionId: string, clientId: string): void {
    this.sessions.get(sessionId)?.clientSockets.delete(clientId);
  }

  clientCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.clientSockets.size ?? 0;
  }

  appendUtterance(sessionId: string, utt: ServerSession['utterances'][0]): void {
    this.sessions.get(sessionId)?.utterances.push(utt);
  }

  end(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.endedAt = new Date();
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  setCurrentSpeaker(sessionId: string, clientId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.currentSpeakerClientId = clientId;
  }

  getCurrentSpeaker(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.currentSpeakerClientId ?? null;
  }
}