import { Body, Controller, Post } from '@nestjs/common';
import { LivekitService } from './livekit.service';

@Controller('livekit')
export class LivekitController {
  constructor(private readonly livekitService: LivekitService) {}

  @Post('token')
  async getToken(
    @Body() body: { roomName: string; participantName: string },
  ): Promise<{ token: string; url: string }> {
    const token = await this.livekitService.generateToken(
      body.roomName,
      body.participantName,
    );

    return {
      token,
      url: process.env.LIVEKIT_URL, // client dùng cái này để connect thẳng LiveKit, NestJS chỉ trả về cho tiện
    };
  }
}