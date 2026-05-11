#!/usr/bin/env tsx
import * as fs from "fs";
import {
  buildProjectRulesSection,
  detectedDomains,
  parseTodoMarkdown,
} from "./delegate-copilot-issue";

const todoPath = process.argv[2];
if (!todoPath) {
  console.error("Usage: print-project-rules <todo-path>");
  process.exit(2);
}

const todo = parseTodoMarkdown(fs.readFileSync(todoPath, "utf8"), todoPath);
const domains = detectedDomains(todo.referencedFiles, todo.labels);
process.stdout.write(buildProjectRulesSection(domains));
