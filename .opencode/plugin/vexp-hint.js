// vexp-hint: per-prompt orientation + idle verification (fail-open). Managed by vexp.
const VEXP_BIN = "/Users/m.trevisani/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/vexp-cli/node_modules/@vexp/core-darwin-arm64/bin/vexp-core";
export const VexpHint = async ({ directory, client }) => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const taskFileFor = (sid) =>
    path.join(directory, ".vexp", "task-" + String(sid || "unknown") + ".txt");
  const gateMarker = (sid) =>
    path.join(directory, ".vexp", "idle-gate-" + String(sid || "unknown") + ".done");
  // Never block the host: execFileSync freezes the editor's event loop for
  // as long as the child runs, so a busy daemon turned into an unresponsive
  // UI (Kilo field report, 2026-08 - the user had to kill the process). Same
  // budget, same fail-open contract, asynchronous.
  const runVexp = (args, opts) =>
    new Promise((resolve) => {
      import("node:child_process").then(({ execFile }) => {
        const child = execFile(VEXP_BIN, args, { ...opts, encoding: "utf8" }, (err, stdout) =>
          resolve(err ? "" : String(stdout || ""))
        );
        if (opts && opts.input) {
          try { child.stdin.end(opts.input); } catch (e) { resolve(""); }
        }
      }).catch(() => resolve(""));
    });
  return {
    // v5: the coupling on the edit, for opencode and Kilo.
    //
    // Their guard plugin uses "tool.execute.before" (verified in our own
    // tests), so ".after" follows the pattern. If that event does not exist
    // the handler is simply never called — inert, never harmful, which is the
    // same fail-open contract as every other surface here.
    "tool.execute.after": async (input, output) => {
      try {
        const tool = String((input && input.tool) || "");
        if (!/^(edit|write|patch|multiedit)$/i.test(tool)) return;
        const args = (input && input.args) || {};
        const file =
          args.filePath || args.file_path || args.path || (output && output.filePath);
        if (!file) return;
        const payload = JSON.stringify({
          tool_name: "Edit",
          session_id: (input && input.sessionID) || "",
          tool_input: { file_path: String(file) },
        });
        const raw = await runVexp(["edit-hint"], { cwd: directory, input: payload, timeout: 5000 });
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const text = parsed?.hookSpecificOutput?.additionalContext;
        if (!text) return;
        if (output && Array.isArray(output.parts)) {
          output.parts.push({ type: "text", text: String(text) });
        }
      } catch (e) {
        /* fail open */
      }
    },
    "chat.message": async (input, output) => {
      try {
        const text = (output.parts || [])
          .filter((p) => p && p.type === "text" && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n");
        if (!text || text.length < 40) return;
        // First prompt of the session = the task spec for the idle gate.
        const sid = (input && input.sessionID) || null;
        try {
          const tf = taskFileFor(sid);
          if (!fs.existsSync(tf)) {
            fs.mkdirSync(path.dirname(tf), { recursive: true });
            fs.writeFileSync(tf, text);
          }
        } catch (e) { /* fail open */ }
        const out = await runVexp(["prompt-hint"], {
          input: JSON.stringify({ prompt: text, session_id: sid }),
          timeout: 4000,
          env: { ...process.env, CLAUDE_PROJECT_DIR: directory },
        });
        if (!out || !out.trim()) return;
        const hint = JSON.parse(out).hookSpecificOutput?.additionalContext;
        // Never push a bare {type,text} part: Kilo 7.4.x validates every part
        // against a schema requiring id/sessionID/messageID before save, so an
        // injected bare part poisons the whole user message (43/43
        // InvalidDurableEvent, prompt dies in both the extension and the CLI -
        // Kilo field report, 2026-08). Appending onto the user's own text part
        // rides its already-valid identity on every opencode/Kilo version.
        if (hint) {
          const texts = (output.parts || []).filter(
            (p) => p && p.type === "text" && typeof p.text === "string"
          );
          const target = texts[texts.length - 1];
          if (target) target.text = target.text + "\n\n" + hint;
        }
      } catch (e) { /* fail open */ }
    },
    event: async ({ event }) => {
      // Idle gate: the opencode twin of the Claude Stop hook. Runs the
      // mechanical completion check once per session; on gaps, sends ONE
      // follow-up prompt with the exact list (best effort - any failure
      // is silent and the session simply stays stopped).
      try {
        if (!event || event.type !== "session.idle") return;
        const sid = event.properties && event.properties.sessionID;
        if (!sid) return;
        const marker = gateMarker(sid);
        if (fs.existsSync(marker)) return;
        const tf = taskFileFor(sid);
        if (!fs.existsSync(tf)) return;
        const out = await runVexp(["verify", "--json", "--task-file", tf], {
          timeout: 15000,
          cwd: directory,
        });
        if (!out || !out.trim()) return;
        const rep = JSON.parse(out);
        const items = [];
        for (const f of (rep.spec && rep.spec.forbidden_touched) || [])
          items.push("- the task says NOT to modify `" + f + "` but it was changed - revert or justify");
        for (const a of (rep.spec && rep.spec.artifacts_missing) || [])
          items.push("- the task asks for `" + a + "` and it does not exist yet");
        for (const b of (rep.broken_imports || []).slice(0, 8))
          items.push("- " + b.file + ":" + b.line + " imports `" + b.imports + "` which no longer exists in " + b.from_changed_file);
        // Impacted tests (2.5.4): the run-or-update mandate, same split as
        // the Claude Stop gate. Helpers get UPDATE, real suites get RUN.
        for (const t of (rep.impacted_tests || []).filter((t) => !t.touched).slice(0, 6)) {
          if (t.runnable === false) {
            items.push("- `" + t.file + "` is a shared test helper tied to changed code" +
              (t.references && t.references.length ? " (references " + t.references.join(", ") + ")" : "") +
              ": UPDATE it to match the changes");
          } else {
            items.push("- `" + t.file + "` tests changed code" +
              (t.references && t.references.length ? " (references " + t.references.join(", ") + ")" : "") +
              ": RUN it and fix any failure before finishing");
          }
        }
        if (!items.length) return;
        fs.writeFileSync(marker, "1");
        await client.session.prompt({
          path: { id: sid },
          body: {
            parts: [{ type: "text", text:
              "vexp verify found mechanically checkable gaps between the session's work and the task:\n" +
              items.join("\n") + "\nFix each item above. This check will not repeat." }],
          },
        });
      } catch (e) { /* fail open */ }
    },
  };
};
