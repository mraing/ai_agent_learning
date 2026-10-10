import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import  {ConfigModule, ConfigService} from '@nestjs/config'
import { MailerModule } from '@nestjs-modules/mailer';
import { AiModule } from './ai/ai.module.js';
@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: '.env',
  }),
  MailerModule.forRootAsync({
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (configService: ConfigService) => ({
      transport: {
        host: configService.get<string>('MAIL_HOST'),
        port: configService.get<number>('MAIL_PORT'),
        secure: configService.get('MAIL_SECURE') === 'true',
        auth: {
          user: configService.get<string>('MAIL_USER'),
          pass: configService.get<string>('MAIL_PASS'),
        },
      },
      defaults: {
        from: configService.get<string>('MAIL_FROM'),
      },
    }),
  }),
  AiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
