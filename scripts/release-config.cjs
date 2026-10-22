'use strict';

const { mkdir, writeFile } = require('node:fs/promises');
const { basename, isAbsolute, join } = require('node:path');

const FEED = Object.freeze({ provider: 'github', owner: 'davidjbeveridge', repo: 'tangent', channel: 'latest', releaseType: 'draft' });
const required = (env, name) => {
  if (typeof env[name] !== 'string' || !env[name].trim()) throw new Error(`Signed releases require ${name}.`);
  return env[name];
};
const fullPublisher = value => value === value.trim() && !/[\r\n\0]/.test(value) && value.length <= 1024
  && /(?:^|,)\s*CN\s*=\s*[^,]+/i.test(value)
  && /(?:^|,)\s*(?:O|OU|C|L|S|ST|SERIALNUMBER)\s*=\s*[^,]+/i.test(value);

/** Build settings only; certificates and passwords remain in the signing tools' environment. */
function createReleaseConfig(base, { env = process.env, platform = process.platform } = {}) {
  if (env.TANGENT_RELEASE_BUILD !== '1') throw new Error('Signed releases require TANGENT_RELEASE_BUILD=1. Use ordinary packaging for manual updates.');
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Signed release configuration supports macOS and Windows only. Linux releases use manual updates.');

  const policy = { schemaVersion: 1, enabled: true, provider: FEED.provider, owner: FEED.owner, repo: FEED.repo, channel: FEED.channel, platform };
  let platformOptions;
  if (platform === 'darwin') {
    for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD']) required(env, name);
    const team = required(env, 'APPLE_TEAM_ID');
    const identity = required(env, 'TANGENT_MAC_IDENTITY');
    if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('APPLE_TEAM_ID must be the ten-character Developer ID team identifier.');
    if (!identity.startsWith('Developer ID Application: ') || !identity.endsWith(` (${team})`) || /[\r\n\0]/.test(identity)) {
      throw new Error('TANGENT_MAC_IDENTITY must be a full Developer ID Application identity for APPLE_TEAM_ID.');
    }
    policy.macTeamId = team;
    platformOptions = { mac: { ...base.mac, identity, hardenedRuntime: true, notarize: true, target: ['dmg', 'zip'], publish: { ...FEED } } };
  } else {
    for (const name of ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) required(env, name);
    const publisher = required(env, 'TANGENT_WINDOWS_PUBLISHER');
    if (!fullPublisher(publisher)) throw new Error('TANGENT_WINDOWS_PUBLISHER must contain the complete certificate subject Distinguished Name, including CN and other subject fields.');
    policy.publisherName = [publisher];
    platformOptions = { win: { ...base.win, target: ['nsis'], verifyUpdateCodeSignature: true, signtoolOptions: { publisherName: [publisher], signingHashAlgorithms: ['sha256'] }, publish: { ...FEED } } };
  }

  return {
    ...base,
    ...platformOptions,
    forceCodeSigning: true,
    publish: { ...FEED },
    // Electron-builder 26 calls afterPack before code signing, including the final
    // merged universal macOS bundle. The marker is therefore covered by that signature.
    afterPack: async context => {
      if (context.electronPlatformName !== platform || !isAbsolute(context.appOutDir)) throw new Error('Signed release platform or output directory differs from the validated configuration.');
      let resources;
      if (platform === 'darwin') {
        const product = context.packager?.appInfo?.productFilename;
        if (typeof product !== 'string' || !product || basename(product) !== product || product === '.' || product === '..') throw new Error('Invalid macOS product filename.');
        resources = join(context.appOutDir, `${product}.app`, 'Contents', 'Resources');
      } else resources = join(context.appOutDir, 'resources');
      await mkdir(resources, { recursive: true });
      await writeFile(join(resources, 'update-policy.json'), `${JSON.stringify(policy, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
    },
  };
}

module.exports = { createReleaseConfig };
