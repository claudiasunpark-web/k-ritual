// K-RITUAL 로컬 서버
// - public/ 정적 파일 서빙
// - POST /api/chat : Claude API 프록시 (ANTHROPIC_API_KEY 가 있을 때만 동작)
// 의존성 없음. Node 18+ 에서 `node server.js` 로 실행.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = Number(process.env.PORT || 5173);
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const MAX_BODY = 64 * 1024; // 64KB

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// 아주 단순한 IP 기준 레이트 리밋 (분당 30회)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const win = hits.get(ip)?.filter((t) => now - t < 60_000) || [];
  win.push(now);
  hits.set(ip, win);
  return win.length > 30;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleChat(req, res) {
  if (!API_KEY) return json(res, 503, { error: 'AI 비활성화: ANTHROPIC_API_KEY 가 설정되지 않았습니다.' });

  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) return json(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'JSON 파싱 실패' });
  }

  const system = String(payload.system || '').slice(0, 8000);
  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-16) : [];
  const clean = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (clean.length === 0) return json(res, 400, { error: '메시지가 비어 있습니다.' });

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        temperature: 0.9,
        system,
        messages: clean,
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('[anthropic]', upstream.status, detail.slice(0, 300));
      return json(res, 502, { error: 'AI 응답 실패' });
    }

    const data = await upstream.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return json(res, 200, { text });
  } catch (err) {
    console.error('[chat]', err);
    return json(res, 502, { error: 'AI 호출 중 오류' });
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);

  // 디렉터리 탈출 방지
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/api/health')) {
    return json(res, 200, { ai: !!API_KEY, model: API_KEY ? MODEL : null });
  }
  if (req.url?.startsWith('/api/chat')) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
    return handleChat(req, res);
  }
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  🔮 K-RITUAL  →  http://localhost:${PORT}`);
  console.log(`  AI 상담 모드: ${API_KEY ? `ON (${MODEL})` : 'OFF — 스토리 모드로 동작 (ANTHROPIC_API_KEY 설정 시 활성화)'}\n`);
});
