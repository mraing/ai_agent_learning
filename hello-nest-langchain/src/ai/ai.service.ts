/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-19 09:04:44
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-19 11:20:33
 * @FilePath: /ai agent learning/hello-nest-langchain/src/ai/ai.service.ts
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { Injectable, Inject } from '@nestjs/common';

import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import type { Runnable } from '@langchain/core/runnables';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class AiService {
  private readonly chain: Runnable;

  constructor(
    // @Inject(ConfigService) configService: ConfigService
    @Inject('CHAT_MODEL') model: ChatOpenAI,
  ) {
    const prompt = PromptTemplate.fromTemplate(
      '请回答以下问题：\n\n{query}',
    );
    // const model = new ChatOpenAI({
    //   temperature: 0.7,
    //   modelName: configService.get('MODEL_NAME'),
    //   apiKey: configService.get('DEEPSEEK_API'),
    //   configuration: {
    //     baseURL: configService.get('BASE_URL'),
    //   },
    // });
    this.chain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  async runChain(query: string): Promise<string> {
    return this.chain.invoke({ query });
  }

  async *streamChain(query: string): AsyncGenerator<string> {
    const stream = await this.chain.stream({ query });
    for await (const chunk of stream) {
      yield chunk;
    }
  }
}


// create(createAiDto: CreateAiDto) {
//   return 'This action adds a new ai';
// }

// findAll() {
//   return `This action returns all ai`;
// }

// findOne(id: number) {
//   return `This action returns a #${id} ai`;
// }

// update(id: number, updateAiDto: UpdateAiDto) {
//   return `This action updates a #${id} ai`;
// }

// remove(id: number) {
//   return `This action removes a #${id} ai`;
// }
// }
