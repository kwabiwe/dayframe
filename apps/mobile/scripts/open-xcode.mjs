import { existsSync, readdirSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import net from "node:net";
import { resolve } from "node:path";

const metroPort = Number(process.env.METRO_PORT ?? 8081);
const metroScreenName = process.env.DAYFRAME_METRO_SCREEN ?? "dayframe-metro";
const metroLogFile = process.env.DAYFRAME_METRO_LOG ?? "/tmp/dayframe-metro-screen.log";

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isPortOpen(port) {
  return new Promise((resolvePort) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.end();
      resolvePort(true);
    });
    socket.once("error", () => resolvePort(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolvePort(false);
    });
  });
}

async function ensureMetro() {
  if (await isPortOpen(metroPort)) {
    console.log(`Metro is already listening on port ${metroPort}.`);
    return;
  }

  const screenPath = spawnSync("zsh", ["-lc", "command -v screen"], {
    encoding: "utf8"
  }).stdout.trim();

  if (!screenPath) {
    console.log(`Metro is not running on port ${metroPort}. Run \`npm run start -- --dev-client --port ${metroPort}\` before launching from Xcode.`);
    return;
  }

  spawnSync(screenPath, ["-S", metroScreenName, "-X", "quit"], { stdio: "ignore" });

  const metroCommand = [
    `cd ${shellQuote(process.cwd())}`,
    `npm run start -- --dev-client --port ${metroPort} --clear 2>&1 | tee ${shellQuote(metroLogFile)}`
  ].join(" && ");

  const result = spawnSync(screenPath, ["-dmS", metroScreenName, "zsh", "-lc", metroCommand], {
    stdio: "ignore"
  });

  if (result.status !== 0) {
    console.log(`Could not start Metro automatically. Run \`npm run start -- --dev-client --port ${metroPort}\` before launching from Xcode.`);
    return;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isPortOpen(metroPort)) {
      console.log(`Started Metro on port ${metroPort} in screen session "${metroScreenName}".`);
      console.log(`Metro log: ${metroLogFile}`);
      return;
    }
    await sleep(500);
  }

  console.log(`Started Metro in screen session "${metroScreenName}", but port ${metroPort} is not accepting connections yet.`);
  console.log(`Metro log: ${metroLogFile}`);
}

const developerDir = execFileSync("xcode-select", ["-p"], { encoding: "utf8" }).trim();
console.log(`Using Xcode developer directory: ${developerDir}`);
console.log(execFileSync("xcodebuild", ["-version"], { encoding: "utf8" }).trim());
await ensureMetro();

const iosDir = resolve(process.cwd(), "ios");
if (!existsSync(iosDir)) {
  console.log("No ios directory yet. Run `npm run prebuild:ios -w @dayframe/mobile` first.");
  process.exit(0);
}

const workspace = readdirSync(iosDir).find((name) => name.endsWith(".xcworkspace"));
const project = readdirSync(iosDir).find((name) => name.endsWith(".xcodeproj"));
const target = workspace ?? project;

if (!target) {
  console.log("No Xcode workspace or project found in apps/mobile/ios.");
  process.exit(0);
}

spawnSync("open", [resolve(iosDir, target)], { stdio: "inherit" });
