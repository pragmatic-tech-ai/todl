#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runSyntaxCheck } from "./checker.js";

// Match the real entry file, not argv[1]'s basename: a global bin is a symlink
// whose path does not end in main.js.
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(realpathSync(invoked)).href)
{
  process.exit(runSyntaxCheck(process.argv.slice(2)));
}
