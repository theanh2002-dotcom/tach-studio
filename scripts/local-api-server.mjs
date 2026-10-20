import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = path.resolve(import.meta.dirname, '..');
const apiRoot = path.join(projectRoot, 'api');
const port = Number(process.env.LOCAL_API_PORT || 3001);
const maxBodyBytes = 1_000_000;

loadEnv(path.join(projectRoot, '.env'));

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] ??= value;
  }
}

function createResponse(nodeResponse) {
  return {
    setHeader(name, value) {
      nodeResponse.setHeader(name, value);
      return this;
    },
    status(statusCode) {
      nodeResponse.statusCode = statusCode;
      return this;
    },
    json(data) {
      nodeResponse.setHeader('Content-Type', 'application/json; charset=utf-8');
      nodeResponse.end(JSON.stringify(data));
    },
    end(data) {
      nodeResponse.end(data);
    }
  };
}

async function readBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error('Request body is too large');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const route = url.pathname.match(/^\/api\/([a-z0-9-]+)$/i)?.[1];
  const filePath = route ? path.join(apiRoot, `${route}.js`) : '';

  if (!route || !fs.existsSync(filePath)) {
    response.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'API route not found' }));
    return;
  }

  try {
    request.query = Object.fromEntries(url.searchParams);
    request.body = request.method === 'GET' || request.method === 'HEAD' ? {} : await readBody(request);
    const module = await import(`${pathToFileURL(filePath).href}?t=${Date.now()}`);
    await module.default(request, createResponse(response));
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Local API error', message: error.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Local API server listening on http://127.0.0.1:${port}`);
});
