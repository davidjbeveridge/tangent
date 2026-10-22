import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as httpServer, request, type RequestListener } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createRequire } from 'node:module';
import { connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TLSSocket } from 'node:tls';

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const builderPackage = require.resolve('app-builder-lib/package.json');
const certificate = fileURLToPath(new URL('./fixtures/download-localhost-cert.pem', import.meta.url));
const privateKey = fileURLToPath(new URL('./fixtures/download-localhost-key.pem', import.meta.url));
// These committed credentials are public test fixtures, trusted only by one
// disposable child process. They are never used by Tangent or a real server.
const payload = Buffer.from('Tangent download proxy fixture\n\x00\x01\xff', 'latin1');
const digest = createHash('sha256').update(payload).digest('hex');
const filename = 'electron-v45.0.0-linux-x64.zip';
const diagnosticContext = '%s %j %d %(constructor)s';

// Keep global-agent's monkey patches out of the test runner and other tests.
// Resolve through the exact dependency that electron-builder actually imports.
const child = String.raw`
  const { createRequire } = require('node:module');
  const { readFile } = require('node:fs/promises');
  const { createHash } = require('node:crypto');
  const path = require('node:path');
  const options = JSON.parse(process.argv[1]);
  const builderRequire = createRequire(options.builderPackage);
  const getRequire = createRequire(builderRequire.resolve('@electron/get/package.json'));
  const proxyRequire = createRequire(getRequire.resolve('global-agent/package.json'));
  const { initializeProxy, downloadArtifact, ElectronDownloadCacheMode } = builderRequire('@electron/get');
  const versions = {
    downloaderVersion: getRequire('./package.json').version,
    proxyVersion: getRequire('global-agent/package.json').version,
    loggerVersion: proxyRequire('roarr/package.json').version,
  };
  initializeProxy();
  (async () => {
    try {
      const file = await downloadArtifact({
        version: '45.0.0', artifactName: 'electron', platform: 'linux', arch: 'x64',
        cacheMode: ElectronDownloadCacheMode.Bypass,
        cacheRoot: path.join(options.directory, 'cache'), tempDirectory: options.directory,
        mirrorOptions: { resolveAssetURL: async () => options.url },
        checksums: { [options.filename]: options.digest },
        downloadOptions: {
          quiet: true, retry: { limit: 0 }, timeout: { request: 5000 },
          // Even a broken proxy bootstrap must never resolve external names.
          lookup: (hostname, lookupOptions, callback) => {
            if (!['127.0.0.1', 'download.tangent.test', 'wrong.tangent.test'].includes(hostname)) {
              return callback(new Error('Non-fixture hostname was blocked'));
            }
            callback(null, lookupOptions?.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1', 4);
          },
        },
      });
      const bytes = await readFile(file);
      console.log(JSON.stringify({ tangentDownloadResult: true, ok: true, ...versions, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.toString('base64') }));
    } catch (error) {
      console.log(JSON.stringify({ tangentDownloadResult: true, ok: false, ...versions, name: error.name, code: error.code, message: error.message }));
    }
  })();
`;

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  return address.port;
}

async function fixture(tls = false, fixtureOptions: { proxyAuth?: boolean; hostname?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tangent-build-download-'));
  const seen = { origin: [] as string[], proxy: [] as string[], connect: [] as string[], authorizations: [] as string[], sni: [] as string[] };
  const sockets = new Set<Socket>();
  const serve: RequestListener = (req, res) => {
    seen.origin.push(String(req.headers['x-tangent-test-proxy'] ?? 'direct'));
    if (req.url !== `/${filename}`) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': payload.length, 'x-tangent-format': diagnosticContext });
    res.end(payload);
  };
  const origin = tls ? httpsServer({ key: await readFile(privateKey), cert: await readFile(certificate) }, serve) : httpServer(serve);
  // A rejected client certificate chain produces a normal fixture handshake error.
  origin.on('tlsClientError', () => {});
  origin.on('secureConnection', (socket: TLSSocket) => seen.sni.push(socket.servername || ''));
  const originPort = await listen(origin);
  const authority = `${tls ? fixtureOptions.hostname ?? 'download.tangent.test' : '127.0.0.1'}:${originPort}`;
  const proxy = httpServer((req, res) => {
    seen.proxy.push(req.url ?? '');
    seen.authorizations.push(String(req.headers['proxy-authorization'] ?? ''));
    if (fixtureOptions.proxyAuth && req.headers['proxy-authorization'] !== `Basic ${Buffer.from('user:p@ss').toString('base64')}`) {
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="Tangent test"' }); res.end(); return;
    }
    let target: URL;
    try { target = new URL(req.url ?? ''); } catch { res.writeHead(400); res.end(); return; }
    // This fixture can forward only to its own loopback origin, never elsewhere.
    if (tls || target.protocol !== 'http:' || target.host !== authority) { res.writeHead(403); res.end(); return; }
    const upstream = request(target, { headers: { ...req.headers, 'x-tangent-test-proxy': 'yes' }, agent: false }, upstreamResponse => {
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers); upstreamResponse.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  proxy.on('connect', (req, socket, head) => {
    seen.connect.push(req.url ?? '');
    if (!tls || req.url !== authority) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = connect(originPort, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
    sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
  });
  for (const server of [origin, proxy]) server.on('connection', socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
  });
  const proxyPort = await listen(proxy);
  const url = `${tls ? 'https' : 'http'}://${authority}/${filename}`;
  return {
    seen, url,
    async download(options: { bypass?: boolean; wrongChecksum?: boolean; trustFixtureCA?: boolean; logging?: boolean } = {}) {
      // Deliberately do not inherit CI secrets, npm mirrors, external proxies,
      // NODE_OPTIONS, or any TLS-verification-disabling environment setting.
      const env: NodeJS.ProcessEnv = {
        SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        HTTP_PROXY: `http://${fixtureOptions.proxyAuth ? 'user:p%40ss@' : ''}127.0.0.1:${proxyPort}`, HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
        NO_PROXY: options.bypass ? '127.0.0.1' : '', ELECTRON_GET_NO_PROGRESS: '1',
      };
      if (options.trustFixtureCA) env.NODE_EXTRA_CA_CERTS = certificate;
      if (options.logging) env.ROARR_LOG = 'true';
      const { stdout, stderr } = await exec(process.execPath, ['-e', child, JSON.stringify({ builderPackage, directory, url, filename, digest: options.wrongChecksum ? '0'.repeat(64) : digest })], {
        env, timeout: 15_000, maxBuffer: 64 * 1024, windowsHide: true,
      });
      assert(!/NODE_TLS_REJECT_UNAUTHORIZED/.test(stderr), 'TLS validation must remain enabled');
      const records = stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
      const results = records.filter(record => record.tangentDownloadResult === true);
      assert.equal(results.length, 1, 'The isolated downloader must return one result');
      const result = results[0];
      assert.equal(result.downloaderVersion, '3.1.0', 'Exercise the builder-selected downloader');
      assert.equal(result.proxyVersion, '3.0.0', 'Preserve the working proxy implementation');
      assert.equal(result.loggerVersion, '3.3.0', 'Exercise the scoped logger override');
      return { ...result, logs: records.filter(record => record.tangentDownloadResult !== true) };
    },
    async cleanup() {
      for (const socket of sockets) socket.destroy();
      await Promise.all([origin, proxy].map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('builder downloader uses the reviewed logger override and verifies actual downloaded bytes', { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    const result = await f.download();
    assert.equal(result.ok, true, result.message); assert.equal(result.sha256, digest);
    assert.deepEqual(Buffer.from(result.bytes, 'base64'), payload);
    assert.deepEqual(f.seen.proxy, [f.url]); assert.deepEqual(f.seen.origin, ['yes']);
  } finally { await f.cleanup(); }
});

test('builder downloader honors NO_PROXY without changing verified bytes', { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    const result = await f.download({ bypass: true });
    assert.equal(result.ok, true, result.message); assert.equal(result.sha256, digest);
    assert.deepEqual(f.seen.proxy, []); assert.deepEqual(f.seen.origin, ['direct']);
  } finally { await f.cleanup(); }
});

test('builder downloader preserves structured proxy diagnostics with logging enabled', { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    const result = await f.download({ logging: true });
    assert.equal(result.ok, true, result.message); assert.equal(result.sha256, digest);
    assert.deepEqual(f.seen.proxy, [f.url]); assert.deepEqual(f.seen.origin, ['yes']);
    // Exercise the logger's default export, child context, trace/info methods,
    // and nested-object serialization through a real successful HTTP transfer.
    const records = result.logs as Array<{ message: string; context: Record<string, unknown> }>;
    assert(records.length > 0, 'ROARR_LOG must produce structured diagnostics');
    assert(records.every(record => typeof record.message === 'string' && record.context?.package === 'global-agent'));
    const sent = records.find(record => record.context.namespace === 'Agent' && record.context.destination === f.url);
    assert(sent, 'Download diagnostics must retain the target URL and child logger context');
    assert(Number.isInteger(sent.context.requestId));
    const received = records.find(record => record.context.namespace === 'Agent' && record.context.statusCode === 200);
    assert(received, 'The successful response must produce structured diagnostics');
    assert.equal(received.context.requestId, sent.context.requestId);
    assert.equal((received.context.headers as Record<string, unknown>)['content-type'], 'application/octet-stream');
    assert.equal((received.context.headers as Record<string, unknown>)['x-tangent-format'], diagnosticContext, 'Response context must remain data, even when it resembles a format string');
  } finally { await f.cleanup(); }
});

test('builder proxy decodes percent-encoded credentials before Basic authentication', { timeout: 20_000 }, async () => {
  const f = await fixture(false, { proxyAuth: true });
  try {
    const result = await f.download();
    assert.deepEqual(f.seen.authorizations, [`Basic ${Buffer.from('user:p@ss').toString('base64')}`]);
    assert.equal(result.ok, true, result.message); assert.equal(result.sha256, digest);
    assert.deepEqual(f.seen.proxy, [f.url]); assert.deepEqual(f.seen.origin, ['yes']);
  } finally { await f.cleanup(); }
});

test('builder downloader rejects a wrong supplied checksum after a proxied download', { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    const result = await f.download({ wrongChecksum: true });
    assert.equal(result.ok, false); assert.match(result.message, /did not match expected checksum/i);
    assert.deepEqual(f.seen.proxy, [f.url]); assert.deepEqual(f.seen.origin, ['yes']);
  } finally { await f.cleanup(); }
});

test('builder HTTPS proxy uses CONNECT and preserves certificate verification', { timeout: 35_000 }, async () => {
  const f = await fixture(true);
  try {
    const rejected = await f.download();
    assert.equal(rejected.ok, false); assert.match(rejected.code ?? rejected.message, /SELF_SIGNED|CERT|certificate/i);
    assert.equal(f.seen.connect.length, 1); assert.deepEqual(f.seen.origin, []);
    const accepted = await f.download({ trustFixtureCA: true });
    assert.equal(accepted.ok, true, accepted.message); assert.equal(accepted.sha256, digest);
    assert.equal(f.seen.connect.length, 2); assert.deepEqual(f.seen.proxy, []); assert.deepEqual(f.seen.origin, ['direct']);
    assert(f.seen.sni.includes('download.tangent.test'), 'The TLS SNI must identify the download host, not localhost');
  } finally { await f.cleanup(); }
});

test('builder HTTPS proxy rejects a trusted certificate for the wrong download hostname', { timeout: 20_000 }, async () => {
  const f = await fixture(true, { hostname: 'wrong.tangent.test' });
  try {
    const result = await f.download({ trustFixtureCA: true });
    assert.equal(result.ok, false); assert.match(result.code ?? result.message, /ERR_TLS_CERT_ALTNAME_INVALID|Hostname\/IP does not match/i);
    assert.equal(f.seen.connect.length, 1); assert.deepEqual(f.seen.origin, []);
  } finally { await f.cleanup(); }
});
