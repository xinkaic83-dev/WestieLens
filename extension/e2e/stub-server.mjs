/* SPDX-License-Identifier: GPL-3.0-only
 * Copyright (c) 2026 ReadWise English Contributors
 */
/**
 * E2E 用的假 DeepSeek / 假词典服务（说明书 §12.2：端到端链路不依赖真实外部服务）。
 * 测试通过 browserContext.route 拦截两个官方域名的上游请求，
 * 生产代码一行都不用改，链路里的校验、编排、缓存、序列化全是真的。
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'article.html');

const ANALYSIS = {
  translation: '虽然当时正在下雨，我们还是决定出门。',
  mainSentence: 'we decided to go out',
  clauses: [
    {
      text: 'Although it was raining',
      type: 'adverbial_clause',
      label: '让步状语从句',
      explanation: '由 Although 引导，说明主句动作发生的让步背景。',
    },
  ],
  syntaxComponents: [
    { text: 'we', component: 'subject', label: '主语', explanation: '行为的发出者。' },
    { text: 'decided', component: 'predicate', label: '谓语', explanation: '过去时态动词。' },
    { text: 'to go out', component: 'object', label: '宾语', explanation: '不定式短语作宾语。' },
  ],
  grammarPoints: [
    { name: '过去进行时', text: 'was raining', explanation: '表示过去某时刻正在发生的动作。' },
  ],
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createUpstreamStub() {
  const scenario = { delayMs: 0, modelStatus: 200, modelCalls: 0, modelListCalls: 0, dictionaryStatus: 200, badStructure: false };
  async function handle(url, requestBody, authorization) {
    if (url.includes('api.deepseek.com')) {
      if (authorization !== 'Bearer e2e-test-key') return { status: 401, body: { error: 'invalid API key' } };
      if (url.endsWith('/models')) {
        scenario.modelListCalls++;
        return { status: 200, body: { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] } };
      }
      scenario.modelCalls++;
      if (scenario.delayMs) await new Promise((resolve) => setTimeout(resolve, scenario.delayMs));
      if (scenario.modelStatus !== 200) return { status: scenario.modelStatus, body: { error: 'test upstream failure' } };
      const request = JSON.parse(requestBody);
      const system = request.messages?.[0]?.content ?? '';
      let result = system.includes('meanings') ? { meanings: ['发展；开发'] }
        : system.includes('phoneticUk') ? { phoneticUk: '', phoneticUs: '', definitions: [{ pos: 'n.', meaning: '发展；开发' }] }
        : ANALYSIS;
      if (scenario.badStructure && result === ANALYSIS) result = { ...ANALYSIS, clauses: [{ ...ANALYSIS.clauses[0], text: 'invented text' }] };
      return { status: 200, body: { choices: [{ message: { role: 'assistant', content: JSON.stringify(result) } }] } };
    }
    if (scenario.dictionaryStatus !== 200) return { status: scenario.dictionaryStatus, body: {} };
    const word = decodeURIComponent(url.split('/').pop());
    return { status: 200, body: [{ word, phonetic: '/dɪˈveləpmənt/',
      phonetics: [{ text: '/dɪˈveləpmənt/', audio: `https://example.test/${word}-us.mp3` }],
      meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'the process of developing' }] }],
    }] };
  }
  return { scenario, handle };
}

export async function startStub(port) {
  const upstream = createUpstreamStub();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/') {
      const html = await readFile(FIXTURE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    } else json(res, 404, { error: 'not found' });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  server.scenario = upstream.scenario;
  server.handleUpstream = upstream.handle;
  return server;
}
