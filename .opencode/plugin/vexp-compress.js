import { spawn } from "child_process";

const BIN = "/Users/m.trevisani/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/vexp-cli/node_modules/@vexp/core-darwin-arm64/bin/vexp-core";

function ask(sub, payload) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(BIN, [sub], { stdio: ["pipe", "pipe", "ignore"] });
    } catch { return finish(null); }
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish(null); }, 8000);
    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", () => {
      clearTimeout(timer);
      try { finish(JSON.parse(out.trim() || "null")); } catch { finish(null); }
    });
    try { child.stdin.end(JSON.stringify(payload)); } catch { clearTimeout(timer); finish(null); }
  });
}

function patchOf(r) {
  return (r && r.hookSpecificOutput && r.hookSpecificOutput.updatedInput) || null;
}

export const VexpCompress = async () => ({
  "tool.execute.before": async (input, output) => {
    const args = output && output.args;
    if (!args) return;
    try {
      const tool = String(input.tool || "").toLowerCase();
      if (tool === "bash" && typeof args.command === "string") {
        const p = patchOf(await ask("bash-cap", {
          tool_name: "Bash",
          tool_input: { command: args.command },
          session_id: input.sessionID || "",
        }));
        if (p && typeof p.command === "string") args.command = p.command;
        return;
      }
      if (tool === "read") {
        const key = args.filePath !== undefined ? "filePath"
          : args.file_path !== undefined ? "file_path"
          : args.path !== undefined ? "path" : null;
        if (!key || typeof args[key] !== "string") return;
        // An agent that already asked for a range knows what it wants.
        if (args.offset !== undefined || args.limit !== undefined) return;
        const p = patchOf(await ask("read-hint", {
          tool_name: "Read",
          tool_input: { file_path: args[key] },
          session_id: input.sessionID || "",
        }));
        if (p && typeof p.file_path === "string") args[key] = p.file_path;
      }
    } catch {
      // Never let compression break a tool call.
    }
  },
});
