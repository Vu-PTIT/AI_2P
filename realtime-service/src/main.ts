import * as dotenv from 'dotenv';
dotenv.config();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' }); // hackathon, siết lại sau khi có domain FE thật
  await app.listen(process.env.PORT ?? 3001);
  console.log(`Gateway running on port ${process.env.PORT ?? 3001}`);
}
bootstrap();