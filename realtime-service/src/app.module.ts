import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AudioModule } from './audio/audio.module';
import { LivekitModule } from './livekit/livekit.module'; 

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    AudioModule,
    LivekitModule, 
  ],
})
export class AppModule {}