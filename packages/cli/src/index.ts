#!/usr/bin/env node
/**
 * lawlink CLI — agent-native entry shell.
 *
 * A thin adapter over @lawlink/core: parse args -> assemble Deps + AuthContext
 * -> call a core use case -> print structured JSON (default). See
 * docs/REARCHITECTURE-PLAN.md §4 for the CLI design (layered commands, Skills,
 * JSON-first output) and §4.5 for the larksuite/cli-inspired principles.
 *
 * P0 skeleton: one command (`intake create`) and a stub AuthContext from env.
 * Real auth (JWT/login) lands with the API in P1.
 */
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { createIntake, type AuthContext, type Deps, type Role } from "@lawlink/core";
import { createDb } from "@lawlink/db";

function buildDeps(): Deps {
  const url = process.env.LAWLINK_DB_URL ?? "file:./lawlink.db";
  return {
    db: createDb(url),
    ids: { newId: () => randomUUID() },
    clock: { now: () => new Date() },
  };
}

// Stub identity until real auth (P1). Agents/scripts pass it via env for now.
function stubAuth(): AuthContext {
  return {
    userId: process.env.LAWLINK_USER_ID ?? "cli-user",
    role: (process.env.LAWLINK_ROLE as Role) ?? "LAWYER",
  };
}

function emit(format: string, data: unknown): void {
  if (format === "json") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else {
    process.stdout.write(String(data) + "\n");
  }
}

const program = new Command();
program
  .name("lawlink")
  .description("LawLink CLI — case management for lawyers, built for humans and agents")
  .version("0.0.0");

const intake = program.command("intake").description("收案登记 / intake registration");

intake
  .command("create")
  .description("Register a new intake")
  .requiredOption("--client-name <name>", "委托方名称")
  .requiredOption(
    "--category <category>",
    "案件类别 (CIVIL_COMMERCIAL|CRIMINAL|ADMINISTRATIVE|NON_LITIGATION|LEGAL_COUNSEL|SPECIAL_PROJECT)",
  )
  .option("--title <title>", "标题（留空自动生成）")
  .option("--claim-amount <amount>", "标的额（最多两位小数）")
  .option("--format <format>", "output format: json|text", "json")
  .action(async (opts) => {
    try {
      const result = await createIntake(buildDeps(), stubAuth(), {
        title: opts.title,
        category: opts.category,
        clientName: opts.clientName,
        claimAmount: opts.claimAmount,
      });
      emit(opts.format, result);
    } catch (err) {
      emit("json", { error: err instanceof Error ? err.message : String(err) });
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
