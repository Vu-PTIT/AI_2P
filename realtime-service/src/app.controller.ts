import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      ts: Date.now(),
      uptime: process.uptime(),
    };
  }
}