/*
 * @Author: 绪锋 910408228@qq.com
 * @Date: 2026-09-16 22:34:34
 * @LastEditors: 绪锋 910408228@qq.com
 * @LastEditTime: 2026-09-16 22:36:46
 * @FilePath: /ai agent learning/2. rag-test/src/tiktoken-test.mjs
 * @Description: 这是默认设置,请设置`customMade`, 打开koroFileHeader查看配置 进行设置: https://github.com/OBKoro1/koro1FileHeader/wiki/%E9%85%8D%E7%BD%AE
 */
import { getEncoding, getEncodingNameForModel } from "js-tiktoken"; 

const modelName = "gpt-4"; 
const encodingName = getEncodingNameForModel(modelName);
console.log(encodingName);

const enc = getEncoding("cl100k_base");
console.log('apple', enc.encode("apple").length);
console.log('pineapple', enc.encode("pineapple").length);
console.log('苹果', enc.encode("苹果").length);
console.log('吃饭', enc.encode("吃饭").length);
console.log('一二三', enc.encode("一二三").length);