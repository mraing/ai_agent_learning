/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-16 21:49:23
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-16 22:05:55
 * @FilePath: /ai agent learning/2. rag-test/src/loader-and-splitter.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import "dotenv/config";

import"cheerio";

import { CheerioWebBaseLoader } from"@langchain/community/document_loaders/web/cheerio";

import { RecursiveCharacterTextSplitter } from"@langchain/textsplitters";

const cheerioLoader = new CheerioWebBaseLoader(
"https://juejin.cn/post/7233327509919547452",
  {
    selector: '.main-area p'
  }
);

const documents = await cheerioLoader.load();

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 400,
  chunkOverlap: 50,
  separators: ['。', '！', '？'],
});

const splitDocuments = await textSplitter.splitDocuments(documents);

console.log(splitDocuments);