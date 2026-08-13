import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectWorkspaceGit, WorkspaceProvisioner } from "../src/workspace-provisioner.js";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "workspace-provisioner-"));
  const ccConfigPath = path.join(root, "config.toml");
  const managedRoot = path.join(root, "managed");
  const searchRoot = path.join(root, "search");
  await mkdir(searchRoot);
  await writeFile(ccConfigPath, "[bridge]\nenabled = true\n", { mode: 0o600 });
  await chmod(ccConfigPath, 0o600);

  const provisioner = new WorkspaceProvisioner({
    ccConfigPath,
    managedRoot,
    searchRoots: [searchRoot],
    managementUrl: "http://127.0.0.1:9",
    managementToken: "test-token"
  });
  await provisioner.initialize();

  return {
    root,
    managedRoot,
    searchRoot,
    provisioner
  };
}

test("finds an existing exact-name workspace before creating one", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const existing = path.join(value.searchRoot, "team", "existing-service");
  await mkdir(existing, { recursive: true });

  const result = await value.provisioner.findOrCreate("existing-service");

  assert.equal(result.created, false);
  assert.equal(result.path, await realpath(existing));
});

test("creates a missing workspace only inside the dedicated managed root", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));

  const result = await value.provisioner.findOrCreate("new-service");
  const metadata = await stat(result.path);
  const managedMetadata = await stat(value.managedRoot);

  assert.equal(result.created, true);
  assert.equal(result.path, await realpath(path.join(value.managedRoot, "new-service")));
  assert.equal(metadata.isDirectory(), true);
  assert.equal(managedMetadata.mode & 0o077, 0);
});

test("rejects workspace names that could escape the managed root", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));

  await assert.rejects(() => value.provisioner.findOrCreate("../outside"), /invalid workspace name/);
  await assert.rejects(() => value.provisioner.findOrCreate("nested/service"), /invalid workspace name/);
});

test("rejects a filesystem or home directory as a search root", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const provisioner = new WorkspaceProvisioner({
    ccConfigPath: path.join(value.root, "config.toml"),
    managedRoot: value.managedRoot,
    searchRoots: [path.parse(value.root).root],
    managementUrl: "http://127.0.0.1:9",
    managementToken: "test-token"
  });

  await assert.rejects(provisioner.initialize(), /too broad/);
});

test("registers separate read and development projects without exposing credentials", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const workspace = await value.provisioner.findOrCreate("new-service");

  const registered = await value.provisioner.register({
    name: "new-service",
    aliases: ["new-service"],
    path: workspace.path
  });
  const config = await readFile(path.join(value.root, "config.toml"), "utf8");

  assert.equal(registered.readProject, "workspace-new-service-read");
  assert.equal(registered.devProject, "workspace-new-service-dev");
  assert.match(config, /mode = "suggest"/);
  assert.match(config, /backend = "app_server"/);
  assert.match(config, /mode = "suggest"/);
  assert.match(config, /禁止读取或回显 \.env/);
  assert.doesNotMatch(config, /test-token/);
});

test("distinguishes a git workspace from an ordinary directory", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const gitWorkspace = path.join(value.searchRoot, "git-workspace");
  const plainWorkspace = path.join(value.searchRoot, "plain-workspace");
  await mkdir(path.join(gitWorkspace, ".git"), { recursive: true });
  await mkdir(plainWorkspace, { recursive: true });
  await writeFile(path.join(gitWorkspace, ".git", "HEAD"), "ref: refs/heads/main\n");

  assert.deepEqual(await inspectWorkspaceGit(gitWorkspace), { isGit: true, branch: "main" });
  assert.deepEqual(await inspectWorkspaceGit(plainWorkspace), { isGit: false, branch: null });
});

test("an unreadable or unsafe git pointer never becomes a plain workspace", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const workspace = path.join(value.searchRoot, "linked-workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, ".git"), "gitdir: ../../outside/.git/worktrees/linked\n");

  assert.deepEqual(await inspectWorkspaceGit(workspace), { isGit: true, branch: null });
});
