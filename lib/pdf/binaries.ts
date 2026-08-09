import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

/**
 * Whether a native binary is on PATH.
 *
 * The PDF routes previously probed with `which <name>`, which does not exist on
 * Windows (cmd.exe has `where`), so on a Windows dev machine detection failed
 * even when the tool was installed. Pick the probe per platform.
 *
 * Note this only reports availability — it does not install anything. Serverless
 * runtimes generally ship none of these, so callers must degrade honestly rather
 * than pretending the work was done.
 */
export async function hasBinary(name: string): Promise<boolean> {
  const probe = process.platform === "win32" ? `where ${name}` : `which ${name}`
  try {
    await execAsync(probe)
    return true
  } catch {
    return false
  }
}
