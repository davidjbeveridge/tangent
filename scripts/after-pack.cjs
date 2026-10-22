const { copyFile, chmod } = require('node:fs/promises');
const { join } = require('node:path');

/**
 * electron-builder 26.15.3 copies appOutDir into its AppImage staging directory
 * after creating AppRun. Supplying our launcher here replaces its automatic
 * --no-sandbox fallback. The packaged smoke test checks the delivered AppRun,
 * so a future builder copy-order change fails the release gate.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  if (context.packager.executableName !== 'tangent-browser') {
    throw new Error('The AppImage launcher requires the tangent-browser executable.');
  }
  const destination = join(context.appOutDir, 'AppRun');
  await copyFile(join(__dirname, '..', 'build', 'AppRun'), destination);
  await chmod(destination, 0o755);
};
