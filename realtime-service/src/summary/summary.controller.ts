import { Body, Controller, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import WebSocket from 'ws';

@Controller('summary')
export class SummaryController {
  constructor(private readonly configService: ConfigService) {}

  @Post('stream')
  async streamSummary(
    @Body() body: { title?: string; turns?: unknown[]; notes?: unknown[] },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const aiWsUrl =
      this.configService.get<string>('AI_WS_URL') ||
      'ws://localhost:8765/ws/session';
    const wsUrl = `${aiWsUrl}?sessionId=summary-${Date.now()}&clientId=summary-http`;

    const ws = new WebSocket(wsUrl);

    let inactivityTimeout: NodeJS.Timeout;
    const resetTimeout = () => {
      clearTimeout(inactivityTimeout);
      inactivityTimeout = setTimeout(() => {
        if (!res.writableEnded) {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              code: 'SUMMARY_TIMEOUT',
              message: 'Quá trình tóm tắt mất nhiều thời gian hơn dự kiến hoặc không phản hồi. Vui lòng thử lại.',
            })}\n\n`,
          );
          cleanup();
          res.end();
        }
      }, 60000);
    };

    const cleanup = () => {
      clearTimeout(inactivityTimeout);
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };

    resetTimeout();

    res.on('close', cleanup);
    res.on('error', cleanup);

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'session.summarize',
          title: body?.title || 'Cuộc họp',
          turns: Array.isArray(body?.turns) ? body.turns : [],
          notes: Array.isArray(body?.notes) ? body.notes : [],
        }),
      );
    });

    ws.on('message', (data) => {
      try {
        const text = data.toString('utf8');
        const parsed = JSON.parse(text);
        if (
          parsed.type === 'summary.partial' ||
          parsed.type === 'summary.done' ||
          parsed.type === 'error'
        ) {
          if (parsed.type === 'summary.partial') {
            resetTimeout();
          }
          res.write(`data: ${JSON.stringify(parsed)}\n\n`);
          if (parsed.type === 'summary.done' || parsed.type === 'error') {
            cleanup();
            res.end();
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('error', (err) => {
      clearTimeout(inactivityTimeout);
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          code: 'SUMMARY_WS_ERROR',
          message: err.message,
        })}\n\n`,
      );
      cleanup();
      res.end();
    });
  }
}
