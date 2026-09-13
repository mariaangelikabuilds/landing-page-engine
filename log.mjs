import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Everything the engine prints is also kept, so a run directory carries its own terminal
// transcript. The hub's recorded walkthrough is authored from this file; the last one was
// typed back in from a screen and its source was never committed.
export function captureOutput() {
  const lines = [];
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream);
    stream.write = (chunk, ...rest) => {
      lines.push(String(chunk));
      return write(chunk, ...rest);
    };
  }
  return {
    flush(runDir) {
      if (!runDir) return;
      writeFileSync(join(runDir, "run.log"), lines.join(""));
    },
  };
}
