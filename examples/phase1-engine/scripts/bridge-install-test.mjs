// Installer checks (npm run test:install): runs the real CLI against throwaway settings files.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENTS, FORWARDER, PORTABLE_COMMAND, installedEvents, withBridge, withoutBridge } from "./bridge-install.mjs";
const ours = (h) => /forward-hook\.mjs"$/.test(h.command);

const cli = join(dirname(fileURLToPath(import.meta.url)), "bridge-install.mjs");
let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const run = (args, home) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } }); // USERPROFILE: homedir() on Windows

console.log("\nHook installer");

// Shaped like a real settings file that already has other tools' hooks and settings.
const existing = {
  env: { FOO: "1" },
  hooks: {
    PreToolUse: [{ matcher: "Grep|Glob", hooks: [{ type: "command", command: "$HOME/.claude/hooks/other-gate" }] }],
    SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "$HOME/.claude/hooks/other-reminder" }] }],
  },
  model: "opus",
  permissions: { allow: ["Bash(ls:*)"] },
};
const home = mkdtempSync(join(tmpdir(), "aaw-home-"));
const file = join(home, ".claude", "settings.json");
mkdirSync(dirname(file), { recursive: true });
const original = JSON.stringify(existing, null, 2) + "\n";
writeFileSync(file, original);

let r = run(["install"], home);
const once = JSON.parse(readFileSync(file, "utf8"));
check("install exits 0 and reports the other hooks as unchanged", r.status === 0 && r.stdout.includes("2 other hook(s) are unchanged"), r.stdout + r.stderr);
check(`install covers all ${EVENTS.length} events`, installedEvents(once).length === EVENTS.length);
check("other hooks keep their place and content", JSON.stringify(once.hooks.PreToolUse[0]) === JSON.stringify(existing.hooks.PreToolUse[0]) && JSON.stringify(once.hooks.SessionStart[0]) === JSON.stringify(existing.hooks.SessionStart[0]));
check("other settings are untouched", JSON.stringify([once.env, once.model, once.permissions]) === JSON.stringify([existing.env, existing.model, existing.permissions]));
const added = Object.values(once.hooks).flat().flatMap((g) => g.hooks).filter(ours);
check("every added handler is async and runs `node \"…/forward-hook.mjs\"`", added.length === EVENTS.length && added.every((h) => h.async === true && h.type === "command" && h.command.startsWith("node \"")), added[0]?.command);
check("a backup of the previous file is written", readdirSync(dirname(file)).some((f) => f.startsWith("settings.json.aaw-backup-")));

r = run(["install"], home);
const twice = JSON.parse(readFileSync(file, "utf8"));
check("installing twice changes nothing", r.stdout.includes("already up to date") && JSON.stringify(twice) === JSON.stringify(once), r.stdout);

r = run(["uninstall"], home);
check("uninstall restores the original file byte for byte", r.status === 0 && readFileSync(file, "utf8") === original);

// Fresh machine: no settings file yet.
const empty = mkdtempSync(join(tmpdir(), "aaw-home-"));
r = run(["install"], empty);
const created = JSON.parse(readFileSync(join(empty, ".claude", "settings.json"), "utf8"));
check("install creates the settings file when there is none", r.status === 0 && installedEvents(created).length === EVENTS.length);
run(["uninstall"], empty);
check("…and uninstall leaves it empty again", readFileSync(join(empty, ".claude", "settings.json"), "utf8") === "{}\n");

// Project scope and a broken file.
const project = mkdtempSync(join(tmpdir(), "aaw-proj-"));
r = run(["install", "--scope", "project", "--project", project], home);
check("project scope writes .claude/settings.local.json", r.status === 0 && installedEvents(JSON.parse(readFileSync(join(project, ".claude", "settings.local.json"), "utf8"))).length === EVENTS.length);
check("the hook command uses forward slashes (Git Bash runs it on Windows)", !FORWARDER.includes("\\"));
const onedrive = withBridge({}, "C:/Users/ACV/OneDrive - Airports Corporation of Vietnam - ACV/Desktop/van phong/bridge/forward-hook.mjs").hooks.Stop[0].hooks[0].command;
check("a path with spaces is double-quoted (same meaning in Git Bash, cmd and PowerShell)", onedrive === 'node "C:/Users/ACV/OneDrive - Airports Corporation of Vietnam - ACV/Desktop/van phong/bridge/forward-hook.mjs"', onedrive);
const odd = withBridge({}, "/Users/a b/it's $here/bridge/forward-hook.mjs").hooks.Stop[0].hooks[0].command;
check("a path a shell would expand falls back to single quotes", odd === "node '/Users/a b/it'\\''s $here/bridge/forward-hook.mjs'", odd);
check("a quoted install is recognised as ours", installedEvents(withBridge({}, "/Users/a b/bridge/forward-hook.mjs")).length === EVENTS.length);
const oldSh = { hooks: { Stop: [{ hooks: [{ type: "command", command: "'/x/bridge/forward-hook.sh'", async: true }] }] } };
check("an older forward-hook.sh install is recognised and replaced by the Node one", withBridge(oldSh).hooks.Stop.length === 1 && withBridge(oldSh).hooks.Stop[0].hooks[0].command.endsWith('forward-hook.mjs"'));
const winInstall = { hooks: { Stop: [{ hooks: [{ type: "command", command: "C:\\aaw\\bridge\\forward-hook.sh" }] }] } };
check("a backslash install from before is recognised and replaced", installedEvents(winInstall).length === 1 && withBridge(winInstall).hooks.Stop.length === 1 && !withoutBridge(winInstall).hooks);
const portable = withBridge({}, "portable");
check("the portable hook names no file and is recognised as ours", portable.hooks.Stop[0].hooks[0].command === PORTABLE_COMMAND && installedEvents(portable).length === EVENTS.length && !withoutBridge(portable).hooks);
const inner = PORTABLE_COMMAND.slice('node -e "'.length, -1);
check("the portable hook is safe in cmd, PowerShell and Git Bash (no $ ` % ! \\ or inner double quote)", PORTABLE_COMMAND.startsWith('node -e "') && !/["$`%!\\]/.test(inner));
check("switching from a path install to the portable one leaves one handler per event", withBridge(withBridge({}), "portable").hooks.Stop.length === 1);
writeFileSync(file, "{ not json");
r = run(["install"], home);
check("an unreadable settings file is reported and left alone", r.status === 1 && readFileSync(file, "utf8") === "{ not json");

console.log(failures === 0 ? "\nAll installer checks passed." : `\n${failures} installer check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
