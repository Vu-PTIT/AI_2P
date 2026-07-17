import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';

@Injectable()
export class AiBridgeService {
  private readonly logger = new Logger(AiBridgeService.name);
  private sockets = new Map<string, WebSocket>(); // sessionId -> ws sang FastAPI

  constructor(
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
  ) {}

  async openSession(
    sessionId: string,
    config: { domain: string; languagePair: string },
  ): Promise<void> {
    if (this.sockets.has(sessionId)) return;

    const aiWsUrl = this.configService.get<string>('AI_WS_URL');
    const aiWs = new WebSocket(`${aiWsUrl}?sessionId=${sessionId}`);

    // Đợi WS OPEN xong mới return
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('AI worker connect timeout after 5s'));
      }, 5000);

      aiWs.once('open', () => {
        clearTimeout(timeout);
        this.logger.log(`AI ws opened for session ${sessionId}`);
        aiWs.send(JSON.stringify({ type: 'session.init', config }));
        resolve();
      });

      aiWs.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    aiWs.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());
        this.eventEmitter.emit('ai.event', { sessionId, ...event });
      } catch (e) {
        this.logger.error(`Parse event lỗi session ${sessionId}: ${e}`);
      }
    });

    aiWs.on('close', () => {
      this.logger.log(`AI ws closed for session ${sessionId}`);
      this.sockets.delete(sessionId);
    });

    aiWs.on('error', (err) => {
      this.logger.error(`AI ws error session ${sessionId}: ${err.message}`);
      this.eventEmitter.emit('ai.event', {
        sessionId,
        type: 'error',
        code: 'AI_CONN_ERROR',
        message: 'Mất kết nối AI worker',
      });
    });

    this.sockets.set(sessionId, aiWs);
  }

  forwardAudio(sessionId: string, chunk: ArrayBuffer | Buffer): void {
    const ws = this.sockets.get(sessionId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(chunk as any);
    }
  }

  sendControl(sessionId: string, msg: Record<string, any>): void {
    const ws = this.sockets.get(sessionId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  closeSession(sessionId: string): void {
    const ws = this.sockets.get(sessionId);
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'session.close' }));
      }
      ws.close();
      this.sockets.delete(sessionId);
    }
  }
}