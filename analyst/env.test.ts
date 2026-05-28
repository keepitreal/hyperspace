import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadDotEnv } from "./env.js";

function withTempEnvFile(contents: string, fn: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "hyperspace-env-"));
  const path = join(dir, ".env");
  writeFileSync(path, contents);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loadDotEnv: parses KEY=value pairs and sets them", () => {
  delete process.env["HSP_TEST_KEY_A"];
  withTempEnvFile("HSP_TEST_KEY_A=hello\n", (p) => {
    loadDotEnv(p);
    assert.equal(process.env["HSP_TEST_KEY_A"], "hello");
  });
  delete process.env["HSP_TEST_KEY_A"];
});

test("loadDotEnv: ignores comments and blank lines", () => {
  delete process.env["HSP_TEST_KEY_B"];
  withTempEnvFile("# a comment\n\nHSP_TEST_KEY_B=world\n  # indented\n", (p) => {
    loadDotEnv(p);
    assert.equal(process.env["HSP_TEST_KEY_B"], "world");
  });
  delete process.env["HSP_TEST_KEY_B"];
});

test("loadDotEnv: strips matching single/double quotes around values", () => {
  delete process.env["HSP_TEST_KEY_C"];
  delete process.env["HSP_TEST_KEY_D"];
  withTempEnvFile(`HSP_TEST_KEY_C="quoted value"\nHSP_TEST_KEY_D='single quoted'\n`, (p) => {
    loadDotEnv(p);
    assert.equal(process.env["HSP_TEST_KEY_C"], "quoted value");
    assert.equal(process.env["HSP_TEST_KEY_D"], "single quoted");
  });
  delete process.env["HSP_TEST_KEY_C"];
  delete process.env["HSP_TEST_KEY_D"];
});

test("loadDotEnv: does NOT overwrite existing env vars", () => {
  process.env["HSP_TEST_KEY_E"] = "from-shell";
  withTempEnvFile("HSP_TEST_KEY_E=from-file\n", (p) => {
    loadDotEnv(p);
    assert.equal(process.env["HSP_TEST_KEY_E"], "from-shell");
  });
  delete process.env["HSP_TEST_KEY_E"];
});

test("loadDotEnv: silent when file missing", () => {
  loadDotEnv("/tmp/definitely-does-not-exist-hyperspace-test.env");
  // no throw = pass
});
