import type { ApiRequestDef } from '../types';

export interface CurlImport { request: ApiRequestDef; warnings: string[] }

/** Splits a shell command line into words (bash quoting: '…', "…", $'…', backslash escapes, line continuations). */
export function shellSplit(input: string): string[] {
  const s = input.replace(/\\\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) throw new Error('Unterminated single quote');
      cur += s.slice(i + 1, j); has = true; i = j;
    } else if (c === '$' && s[i + 1] === "'") {
      let j = i + 2; let v = '';
      while (j < s.length && s[j] !== "'") {
        if (s[j] === '\\' && j + 1 < s.length) {
          const n = s[j + 1];
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' };
          if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(j + 2, j + 6))) { v += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16)); j += 6; continue; }
          if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(j + 2, j + 4))) { v += String.fromCharCode(parseInt(s.slice(j + 2, j + 4), 16)); j += 4; continue; }
          v += map[n] ?? n; j += 2;
        } else { v += s[j]; j++; }
      }
      if (j >= s.length) throw new Error('Unterminated quote');
      cur += v; has = true; i = j;
    } else if (c === '"') {
      let j = i + 1; let v = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) { v += s[j + 1]; j += 2; } else { v += s[j]; j++; }
      }
      if (j >= s.length) throw new Error('Unterminated double quote');
      cur += v; has = true; i = j;
    } else if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1]; has = true; i++;
    } else if (/\s/.test(c)) {
      if (has) { out.push(cur); cur = ''; has = false; }
    } else { cur += c; has = true; }
  }
  if (has) out.push(cur);
  return out;
}

const WITH_VALUE = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii',
  '--data-urlencode', '--json', '-u', '--user', '-b', '--cookie', '-A', '--user-agent', '--url', '-F', '--form', '-e', '--referer',
  '-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '--cacert', '--cert', '--key', '-w', '--write-out']);

export function parseCurl(text: string): CurlImport {
  const warnings: string[] = [];
  let tokens = shellSplit(text.trim());
  if (tokens[0] === 'curl') tokens = tokens.slice(1);
  else if (!tokens.some((t) => t === 'curl')) throw new Error('This does not look like a curl command (it should start with "curl").');
  else tokens = tokens.slice(tokens.indexOf('curl') + 1);

  let method: string | null = null;
  let url = '';
  const headers: { name: string; value: string }[] = [];
  const data: string[] = [];
  let jsonMode = false;
  let getMode = false;
  const setHeader = (name: string, value: string) => {
    const i = headers.findIndex((h) => h.name.toLowerCase() === name.toLowerCase());
    if (i >= 0) headers[i] = { name, value }; else headers.push({ name, value });
  };

  for (let i = 0; i < tokens.length; i++) {
    let t = tokens[i];
    let inline: string | undefined;
    if (t.startsWith('--') && t.includes('=')) { inline = t.slice(t.indexOf('=') + 1); t = t.slice(0, t.indexOf('=')); }
    if (!t.startsWith('-') || t === '-') {
      if (!url && /^https?:\/\//i.test(t)) url = t;
      else if (!url && !t.startsWith('-')) url = t;
      continue;
    }
    // short flag glued to its value, e.g. -XPOST or -H'A: b'
    let val: string | undefined = inline;
    if (!t.startsWith('--') && t.length > 2 && WITH_VALUE.has(t.slice(0, 2))) { val = t.slice(2); t = t.slice(0, 2); }
    if (WITH_VALUE.has(t) && val === undefined) val = tokens[++i];
    switch (t) {
      case '-X': case '--request': method = (val ?? '').toUpperCase(); break;
      case '-H': case '--header': {
        const k = (val ?? '').indexOf(':');
        if (k > 0) setHeader((val as string).slice(0, k).trim(), (val as string).slice(k + 1).trim());
        break;
      }
      case '-d': case '--data': case '--data-raw': case '--data-binary': case '--data-ascii': data.push(val ?? ''); break;
      case '--data-urlencode': data.push(val ?? ''); warnings.push('--data-urlencode values are sent as written (not URL-encoded). Check the body.'); break;
      case '--json': data.push(val ?? ''); jsonMode = true; break;
      case '-u': case '--user': setHeader('Authorization', 'Basic ' + btoa(val ?? '')); warnings.push('Basic-auth credentials were converted into an Authorization header. Replace them with a secret variable such as {{authHeader}} before saving.'); break;
      case '-b': case '--cookie': setHeader('Cookie', val ?? ''); break;
      case '-A': case '--user-agent': setHeader('User-Agent', val ?? ''); break;
      case '-e': case '--referer': setHeader('Referer', val ?? ''); break;
      case '--url': url = val ?? ''; break;
      case '-G': case '--get': getMode = true; break;
      case '-I': case '--head': warnings.push('HEAD requests are not supported; imported as GET.'); break;
      case '-F': case '--form': warnings.push('Multipart form uploads (-F) are not supported; the form fields were skipped.'); break;
      case '-k': case '--insecure': warnings.push('-k/--insecure is ignored: the tool always verifies TLS certificates.'); break;
      case '-x': case '--proxy': warnings.push('Proxy settings are ignored.'); break;
      default: break; // -s -i -v -L --compressed etc. have no effect here
    }
  }
  if (!url) throw new Error('No URL found in the curl command.');
  if (jsonMode) {
    if (!headers.some((h) => h.name.toLowerCase() === 'content-type')) headers.push({ name: 'Content-Type', value: 'application/json' });
    if (!headers.some((h) => h.name.toLowerCase() === 'accept')) headers.push({ name: 'Accept', value: 'application/json' });
  }
  let body = data.join('&');
  if (getMode && body) { url += (url.includes('?') ? '&' : '?') + body; body = ''; }
  let m = method ?? (body ? 'POST' : 'GET');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) { warnings.push(`Method ${m} is not supported; imported as ${body ? 'POST' : 'GET'}.`); m = body ? 'POST' : 'GET'; }
  if (body.startsWith('@')) { warnings.push('The body refers to a file (@file). Paste the content into the Body box.'); body = ''; }
  if (body && !headers.some((h) => h.name.toLowerCase() === 'content-type')) {
    const t = body.trim();
    headers.push({ name: 'Content-Type', value: t.startsWith('{') || t.startsWith('[') ? 'application/json' : 'application/x-www-form-urlencoded' });
  }
  for (const h of headers) {
    if (/^(authorization|x-api-key|api-key|x-auth-token|cookie)$/i.test(h.name) && h.value && !h.value.includes('{{')) {
      warnings.push(`Header "${h.name}" contains a literal secret. Consider saving it as a secret variable and using {{name}} here, so it is not stored in plain text.`);
    }
  }
  let path = '';
  try { const u = new URL(url.replace(/\{\{[^}]*}}/g, 'x')); path = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname; } catch { path = 'request'; }
  return {
    warnings,
    request: { name: `${m} ${path}`, method: m, url, headers, body: body || '', extractions: [], expectedStatus: null },
  };
}
