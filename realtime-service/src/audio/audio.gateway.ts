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

  async handleConnection(client: Socket) {
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

      // ⚠️ AWAIT ở đây — đợi WS sang FastAPI OPEN xong
      try {
        await this.aiBridge.openSession(sessionId, { domain, languagePair });
      } catch (err: any) {
        this.logger.error(`AI bridge open failed for ${sessionId}: ${err.message}`);
        client.emit('error', {
          code: 'AI_UNAVAILABLE',
          message: 'AI worker không phản hồi',
        });
        client.disconnect(true);
        return;
      }

      // Chỉ emit session.ready SAU khi AI ready
      client.emit('session.ready', { clientId, sessionId });
      this.logger.log(`Client ${clientId} joined session ${sessionId} (AI ready)`);
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
    const clientId = client.data.clientId;
    if (!sessionId || !clientId) return;

    // Đánh dấu client này là speaker hiện tại
    // Mỗi chunk audio đến → cập nhật, đảm bảo speaker luôn là người mới nhất đang nói
    this.sessionStore.setCurrentSpeaker(sessionId, clientId);

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

    // Lấy speaker hiện tại của session
    const currentSpeakerClientId = this.sessionStore.getCurrentSpeaker(sessionId);

    // Chèn clientId vào mọi event trước khi broadcast
    const enrichedEvent = {
      ...event,
      clientId: currentSpeakerClientId,
    };

    this.server.to(sessionId).emit(event.type, enrichedEvent);

    if (event.type === 'translate.done') {
      this.sessionStore.appendUtterance(sessionId, {
        id: event.utteranceId,
        speaker: event.speaker,
        clientId: currentSpeakerClientId,          // ← THÊM (lưu vào history)
        sourceText: event.sourceText,
        translatedText: event.fullText,
        timestamp: Date.now(),
      });
    }
  }
}