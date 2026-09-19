import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class LlmService {
  constructor(private readonly configService: ConfigService) {}

  getModel() {
    return new ChatOpenAI({
      apiKey: this.configService.get('DEEPSEEK_API'),
      modelName: this.configService.get('MODEL_NAME'),
      configuration: {
        baseURL: this.configService.get('BASE_URL'),
      },
    });
  }
}
