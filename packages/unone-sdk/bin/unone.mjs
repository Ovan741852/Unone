#!/usr/bin/env node
import { createGame, openGame } from "../src/index.mjs";

const [command = "help", first, ...rest] = process.argv.slice(2);
const projectDir = first && !first.startsWith("--") ? first : process.cwd();
const flags = new Map();
for (let index = 0; index < rest.length; index += 1) {
  if (rest[index]?.startsWith("--")) flags.set(rest[index].slice(2), rest[index + 1] ?? true);
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  if (command === "init") {
    const name = flags.get("name") === true ? first : flags.get("name") || first;
    print(await createGame({ dir: projectDir, name: name || "Unone Game" }));
  } else {
    const game = openGame({ projectDir });
    if (command === "verify") print(await game.verify());
    else if (command === "test") print(await game.test());
    else if (command === "run" || command === "dev") {
      print(await game.run({ frames: Number(flags.get("frames") || 60), action: flags.get("action") }));
    } else if (command === "pack") print(await game.pack());
    else {
      process.stdout.write("Usage: unone init <dir> --name <name> | verify | run | test | pack\n");
      process.exitCode = 1;
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
