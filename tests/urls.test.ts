import test from 'node:test';
import assert from 'node:assert/strict';
import { isNavigableUrl, normalizeInput, displayTitle } from '../src/core/urls';

test('normal navigation accepts only HTTP(S) and the exact blank-page sentinel', () => {
  for (const allowed of ['https://example.com', 'http://localhost:3000', 'http://127.0.0.1:8080/', 'https://[::1]:8443/', 'about:blank']) assert.equal(isNavigableUrl(allowed), true, allowed);
  for (const rejected of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'tangent://shell/index.html', 'chrome://settings', 'devtools://x', 'mailto:user@example.com', 'about:config', 'about:blank#x', 'vbscript:alert(1)', 'ftp://example.com', '//example.com', '', null, {}, 42]) assert.equal(isNavigableUrl(rejected), false, String(rejected));
});

test('credentials in URLs are rejected and cannot hide the destination hostname', () => {
  for (const value of ['https://trusted.com@evil.example', 'https://user:password@example.com', 'http://user%40email.example@example.com']) {
    assert.equal(isNavigableUrl(value), false);
    assert.throws(() => normalizeInput(value));
  }
});

test('typed domains and local development addresses get usable scheme defaults', () => {
  assert.equal(normalizeInput('example.com/path?q=yes'), 'https://example.com/path?q=yes');
  assert.equal(normalizeInput('  HTTPS://Example.COM/path  '), 'https://example.com/path');
  assert.equal(normalizeInput('localhost:3000/health'), 'http://localhost:3000/health');
  assert.equal(normalizeInput('127.0.0.1:8080/'), 'http://127.0.0.1:8080/');
  assert.equal(normalizeInput('[::1]:3000/'), 'http://[::1]:3000/');
  assert.equal(normalizeInput('example.com:8443/path'), 'https://example.com:8443/path');
});

test('search queries are encoded as data, including punctuation and script-looking text', () => {
  const query = 'cats & dogs? <script>alert("x")</script>';
  assert.equal(normalizeInput(query), `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
  assert.equal(normalizeInput('why the sky is blue', 'google'), 'https://www.google.com/search?q=why%20the%20sky%20is%20blue');
});

test('explicit unsafe protocols are never returned as a navigation destination', () => {
  const unsafe = ['JaVaScRiPt:alert(1)', 'data:text/html,bad', 'file:///tmp/a', 'tangent://shell/', 'chrome://crash', 'intent://whatever', 'javascript:\nalert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)'];
  for (const input of unsafe) {
    let output: string;
    try { output = normalizeInput(input); }
    catch (error) { assert.ok(error instanceof Error); continue; }
    assert.equal(isNavigableUrl(output), true, `normalized result must be an allowed web/search URL for ${input}`);
    assert.ok(!['javascript:', 'data:', 'file:', 'tangent:', 'chrome:', 'intent:'].includes(new URL(output).protocol));
  }
});

test('oversized raw URLs and invalid hosts cannot enter persisted navigation state', () => {
  assert.equal(isNavigableUrl('https://example.com/' + 'x'.repeat(8192)), false);
  assert.equal(isNavigableUrl('http://'), false);
  assert.equal(isNavigableUrl('https://exa mple.com'), false);
  assert.equal(isNavigableUrl('https://example.com:999999/'), false);
});

test('blank input creates a new-tab sentinel and display titles never expose userinfo', () => {
  assert.equal(normalizeInput('  '), 'about:blank');
  assert.equal(displayTitle('about:blank'), 'New tab');
  assert.equal(displayTitle('https://www.example.com/path'), 'example.com');
  assert.equal(displayTitle('not a url'), 'New tab');
});

test('search operators remain search input while explicit executable schemes stay blocked', () => {
  const query = 'site:example.com browser security';
  assert.equal(normalizeInput(query), `https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
  const typeQuery = 'filetype:pdf chromium architecture';
  assert.equal(normalizeInput(typeQuery), `https://duckduckgo.com/?q=${encodeURIComponent(typeQuery)}`);
  assert.throws(() => normalizeInput('javascript:alert(1)'));
  assert.throws(() => normalizeInput('file:///etc/passwd'));
});

test('IPv6 host and port syntax is supported without opening arbitrary schemes', () => {
  assert.equal(normalizeInput('[2001:db8::1]:8443/path'), 'https://[2001:db8::1]:8443/path');
  assert.equal(normalizeInput('[::1]:8765/path'), 'http://[::1]:8765/path');
  assert.equal(isNavigableUrl('https://[::1]@example.com'), false);
});
