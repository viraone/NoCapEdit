/**
 * Remembers which compute backend (WebGPU or WASM) an on-device ML task last
 * ran on, so panels can show it before and after a job. Stored per task in
 * localStorage; reads are guarded because storage may be unavailable.
 */
export type MlDevice = "webgpu" | "wasm";

const PREFIX = "reelflow.mlDevice.";

export function rememberMlDevice(task: string, device: MlDevice): void {
  try {
    localStorage.setItem(PREFIX + task, device);
  } catch {
    /* storage unavailable */
  }
}

export function lastMlDevice(task: string): MlDevice | null {
  try {
    const v = localStorage.getItem(PREFIX + task);
    return v === "webgpu" || v === "wasm" ? v : null;
  } catch {
    return null;
  }
}

export function mlDeviceLabel(device: MlDevice | null): string {
  return device === "webgpu" ? "WebGPU" : device === "wasm" ? "WASM (CPU)" : "WebGPU or WASM";
}
