import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AudioModule } from './audio/audio.module';
import { LivekitModule } from './livekit/livekit.module'; 
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    AudioModule,
    LivekitModule, 
  ],
  controllers: [AppController],
})
export class AppModule {}