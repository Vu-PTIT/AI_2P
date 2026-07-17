import { Module } from '@nestjs/common';
import { AudioGateway } from './audio.gateway';
import { AiBridgeService } from './ai-bridge.service';
import { SessionStore } from './session.store';

@Module({
  providers: [AudioGateway, AiBridgeService, SessionStore],
})
export class AudioModule {}