import { parseCurl, shellSplit } from '../utils/parseCurl';

describe('parseCurl', () => {
  it('parses a typical copied-from-browser POST with continuations and quotes', () => {
    const r = parseCurl(`curl 'https://qa-api.example.com/v1/wallets?x=1' \\
  -H 'Content-Type: application/json' \\
  -H "Authorization: Bearer abc.def" \\
  --data-raw '{"owner":"o'\\''brien","n":1}' --compressed`);
    expect(r.request.method).toBe('POST');
    expect(r.request.url).toBe('https://qa-api.example.com/v1/wallets?x=1');
    expect(r.request.headers).toEqual([{ name: 'Content-Type', value: 'application/json' }, { name: 'Authorization', value: 'Bearer abc.def' }]);
    expect(r.request.body).toBe(`{"owner":"o'brien","n":1}`);
    expect(r.request.name).toBe('POST wallets');
    expect(r.warnings.join(' ')).toMatch(/Authorization.*literal secret/);
  });
  it('defaults to GET, honours -X and glued short flags, --json and --get', () => {
    expect(parseCurl('curl https://h/a').request.method).toBe('GET');
    expect(parseCurl("curl -XDELETE https://h/a/1").request.method).toBe('DELETE');
    const j = parseCurl(`curl --json '{"a":1}' https://h/a`);
    expect(j.request.method).toBe('POST');
    expect(j.request.headers.map((h) => h.name)).toEqual(['Content-Type', 'Accept']);
    expect(parseCurl(`curl -G -d a=1 -d b=2 https://h/s`).request.url).toBe('https://h/s?a=1&b=2');
  });
  it('converts -u to a Basic header and warns about unsupported options', () => {
    const r = parseCurl('curl -u user:pw -k -F f=@x https://h/a');
    expect(r.request.headers[0]).toEqual({ name: 'Authorization', value: 'Basic ' + btoa('user:pw') });
    expect(r.warnings.join(' ')).toMatch(/insecure/);
    expect(r.warnings.join(' ')).toMatch(/Multipart/);
  });
  it('keeps {{variables}} and rejects non-curl text', () => {
    expect(parseCurl(`curl -H 'Authorization: Bearer {{token}}' 'https://h/a/{{walletId}}'`).warnings).toEqual([]);
    expect(() => parseCurl('hello world')).toThrow(/curl/);
    expect(() => parseCurl('curl -X POST')).toThrow(/URL/);
  });
  it('splits ANSI-C quoted strings', () => {
    expect(shellSplit("a $'x\\ny' \"q \\\"z\\\"\"")).toEqual(['a', 'x\ny', 'q "z"']);
  });
});
