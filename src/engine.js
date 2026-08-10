// Shared response helpers used by the API and admin routes.
const DEFAULT_TIP = 'verify your target and method before retrying.';
const DEFAULT_AD = 'cheap game keys available from trusted marketplaces.';

function buildResponseMeta(payload = {}) {
  const tip = payload?.tips || payload?.tip || DEFAULT_TIP;
  const ad = payload?.ads || payload?.advert || DEFAULT_AD;
  return {
    tips: tip,
    ads: ad
  };
}

export function formatErrorDetails(error) {
  const stack = error?.stack || '';
  const match = stack.match(/(?:\(|\s)([^:\s]+\.js):(\d+):(\d+)/i) || stack.match(/(?:\(|\s)([^:\s]+):(\d+):(\d+)/i);
  return {
    name: error?.name || 'Error',
    message: error?.message || 'Unknown error',
    file: match?.[1] || null,
    line: match?.[2] ? Number(match[2]) : null,
    column: match?.[3] ? Number(match[3]) : null,
    stack: stack.split('\n').slice(0, 8).filter(Boolean)
  };
}

// Lightweight syntax checker for simple inline code snippets.
export function checkJavaScriptSyntax(source, fileName = 'inline.js') {
  const code = String(source || '');
  const opening = new Map([['(', ')'], ['[', ']'], ['{', '}']]);
  const closing = new Map([[')', '('], [']', '['], ['}', '{']]);
  const stack = [];
  let quote = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  let line = 1;
  let column = 1;

  const advance = (char) => {
    if (char === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  };

  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    const next = code[i + 1];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      advance(char);
      continue;
    }

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      advance(char);
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        advance(char);
        advance(next);
        i += 1;
      } else {
        advance(char);
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      advance(char);
      advance(next);
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      advance(char);
      advance(next);
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      advance(char);
      continue;
    }

    if (opening.has(char)) {
      stack.push({ char, line, column });
      advance(char);
      continue;
    }

    if (closing.has(char)) {
      const expected = stack[stack.length - 1];
      if (!expected || expected.char !== closing.get(char)) {
        return {
          valid: false,
          name: 'SyntaxError',
          message: `Unexpected closing token ${char}`,
          file: fileName,
          line,
          column,
          stack: []
        };
      }
      stack.pop();
      advance(char);
      continue;
    }

    advance(char);
  }

  if (quote) {
    return {
      valid: false,
      name: 'SyntaxError',
      message: `Unterminated string starting at line ${line}, column ${column}`,
      file: fileName,
      line,
      column,
      stack: []
    };
  }

  if (stack.length > 0) {
    const last = stack[stack.length - 1];
    return {
      valid: false,
      name: 'SyntaxError',
      message: `Unclosed token ${last.char}`,
      file: fileName,
      line: last.line,
      column: last.column,
      stack: []
    };
  }

  return { valid: true, name: 'OK', message: 'syntax ok', file: fileName, line: 1, column: 1 };
}

export function jsonResponse(payload, status = 200) {
  const normalizedPayload = payload && typeof payload === 'object' ? payload : { value: payload };
  const { footer, ...payloadWithoutFooter } = normalizedPayload;
  const meta = buildResponseMeta(payloadWithoutFooter);
  const responsePayload = {
    ...payloadWithoutFooter,
    tips: payloadWithoutFooter.tips || meta.tips,
    ads: payloadWithoutFooter.ads || meta.ads,
    timestamp: payloadWithoutFooter.timestamp || new Date().toISOString(),
    service: payloadWithoutFooter.service || 'CAPI',
    version: payloadWithoutFooter.version || '1.0.0'
  };

  const body = JSON.stringify(responsePayload, null, 2);
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    }
  });
}

export function structuredResponse({ error = false, message = null, data = null, status = 200, extra = {} }) {
  const payload = { error, ...(message !== null ? { message } : {}), ...(data !== null ? { data } : {}), ...extra };
  return jsonResponse(payload, status);
}

export function parseQuery(request) {
  const url = new URL(request.url);
  return Object.fromEntries(url.searchParams.entries());
}

export function routeNotFound() {
  return jsonResponse({ error: true, message: 'Endpoint not found. Use /api, /admin or /lookup.' }, 404);
}
