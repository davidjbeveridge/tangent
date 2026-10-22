interface SandboxApplication {
  isPackaged: boolean;
  commandLine: { hasSwitch(name: string): boolean };
  enableSandbox(): void;
}

/** Run before app.ready and before creating any web contents. */
export function enforcePackagedSandbox(application: SandboxApplication): void {
  if (!application.isPackaged) return;
  if (['no-sandbox', 'disable-gpu-sandbox', 'disable-setuid-sandbox', 'disable-seccomp-filter-sandbox'].some(name => application.commandLine.hasSwitch(name))) {
    throw new Error("Tangent cannot start with Chromium's sandbox disabled. Remove sandbox-disabling flags from the launcher. On Linux, run Tangent as a regular user on a system that permits Chromium's user-namespace sandbox.");
  }
  application.enableSandbox();
}
