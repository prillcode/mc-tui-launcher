/**
 * Loads `.env` from the app directory.
 *
 * Bun's automatic .env loading is cwd-relative, but the global `mctui`
 * command may be invoked from any directory — so we load the file
 * relative to the app source instead. Existing process.env values are
 * never overwritten (real environment wins over .env).
 */
export async function loadAppEnv(): Promise<void> {
  const envPath = new URL("../../.env", import.meta.url)
  const envFile = Bun.file(envPath)
  if (!(await envFile.exists())) return

  for (const line of (await envFile.text()).split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (match && !(match[1]! in process.env)) {
      process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "")
    }
  }
}
