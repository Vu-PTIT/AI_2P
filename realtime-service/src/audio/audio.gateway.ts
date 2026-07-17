import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { SessionStore } from './session.store';
import { AiBridgeService } from './ai-bridge.service';
import type { AiEventPayload } from '../common/types/events.type';

@WebSocketGateway({
  namespace: '/audio',
  cors: { origin: '*' },
  transports: ['websocket'],
  maxHttpBufferSize: 1e7,
  pingTimeout: 10000,
  pingInterval: 5000,
})
export class AudioGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AudioGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly aiBridge: AiBridgeService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const sessionId = client.handshake.query?.sessionId as string;
      const clientId = client.handshake.query?.clientId as string;

      if (!sessionId || !clientId) {
        this.logger.warn('Connect thiếu sessionId hoặc clientId, disconnect');
        client.disconnect(true);
        return;
      }

      const domain = (client.handshake.query?.domain as string) ?? 'business';
      const languagePair = (client.handshake.query?.languagePair as string) ?? 'vi-en';

      client.data.sessionId = sessionId;
      client.data.clientId = clientId;

      this.sessionStore.getOrCreate(sessionId, domain, languagePair);
      this.sessionStore.addClient(sessionId, clientId, client);

      client.join(sessionId);

      this.aiBridge.openSession(sessionId, { domain, languagePair });

      client.emit('session.ready', { clientId, sessionId });
      this.logger.log(`Client ${clientId} joined session ${sessionId}`);
    } catch (e) {
      this.logger.error(`handleConnection error: ${e}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const sessionId = client.data.sessionId;
    const clientId = client.data.clientId;
    if (!sessionId || !clientId) return;

    this.sessionStore.removeClient(sessionId, clientId);
    this.logger.log(`Client ${clientId} left session ${sessionId}`);

    if (this.sessionStore.clientCount(sessionId) === 0) {
      this.aiBridge.closeSession(sessionId);
    }
  }

  @SubscribeMessage('audio.chunk')
  onAudio(@ConnectedSocket() client: Socket, @MessageBody() chunk: ArrayBuffer) {
    const sessionId = client.data.sessionId;
    if (!sessionId) return;
    this.aiBridge.forwardAudio(sessionId, chunk as any);
  }

  @SubscribeMessage('speaker.switch')
  onSpeakerSwitch(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { speaker: 'vi' | 'en' },
  ) {
    const sessionId = client.data.sessionId;
    if (!sessionId) return;
    this.aiBridge.sendControl(sessionId, { type: 'speaker.switch', ...body });
  }

  @SubscribeMessage('session.end')
  onSessionEnd(@ConnectedSocket() client: Socket) {
    const sessionId = client.data.sessionId;
    if (!sessionId) return;
    this.sessionStore.end(sessionId);
    this.server.to(sessionId).emit('session.ended');
    this.aiBridge.closeSession(sessionId);
  }

  @OnEvent('ai.event')
  handleAiEvent(payload: AiEventPayload) {
    const { sessionId, ...event } = payload;

    this.server.to(sessionId).emit(event.type, event);

    if (event.type === 'translate.done') {
      this.sessionStore.appendUtterance(sessionId, {
        id: event.utteranceId,
        speaker: event.speaker,
        sourceText: event.sourceText,
        translatedText: event.fullText,
        timestamp: Date.now(),
      });
    }
  }
}