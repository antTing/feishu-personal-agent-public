import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

import { inspectWorkspaceGit, readCurrentBranch } from "./workspace-provisioner.js";

const PROJECT_LABEL = /(?:项目|仓库|工作区|project|repo(?:sitory)?|workspace)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9._-]{1,79})/i;
const WORKSPACE_APPROVAL = /^\s*(?:同意|允许|批准)工作区\s+(WR-[A-F0-9]{8})\s*$/i;
const BRANCH_CONFIRMATION = /^\s*(?:确认分支|使用分支)\s*(BR-[A-F0-9]{8})\s*[<＜]?([^\s<>＜＞]+)[>＞]?\s*$/i;
const BRANCH_CONFIRMATION_WITHOUT_ID = /^\s*(?:确认分支|使用分支)\s*[<＜]?([^\s<>＜＞]+)[>＞]?\s*$/i;
const WRITE_INTENT = /(?:修改|开发|实现|修复|重构|新增|写代码|代码生成|安装依赖|运行|执行|构建|打包|测试|build|compile|lint|test|install|生成产物|输出文件|创建文档|写入|保存|落盘|deploy|部署)/i;
const SAFE_WORKSPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;
const SAFE_BRANCH = /^(?!-)(?!.*(?:\.\.|\/\/|@\{|\.lock$))[A-Za-z0-9._/-]+$/;

function requestId(prefix) {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function normalizeWorkspace(workspace) {
  return {
    ...workspace,
    aliases: [...new Set([workspace.name, ...(workspace.aliases || [])])]
  };
}

async function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, filePath);
}

export function extractWorkspaceName(text) {
  return text.match(PROJECT_LABEL)?.[1] || null;
}

export function isDevelopmentTask(text) {
  return WRITE_INTENT.test(text);
}

export class WorkspaceCoordinator {
  constructor({ statePath, defaultProject, workspaces, ownerUserIds, provisioner, logger = console }) {
    this.statePath = statePath;
    this.defaultProject = defaultProject;
    this.seedWorkspaces = workspaces.map(normalizeWorkspace);
    this.ownerUserIds = new Set(ownerUserIds);
    this.ownerUserId = ownerUserIds[0] || null;
    this.provisioner = provisioner;
    this.logger = logger;
    this.state = { version: 1, workspaces: [], pending: [] };
    this.saveQueue = Promise.resolve();
    this.claimed = new Set();
  }

  async initialize() {
    try {
      const metadata = await stat(this.statePath);
      if ((metadata.mode & 0o077) !== 0) {
        throw new Error("workspace state must use mode 600");
      }
      this.state = JSON.parse(await readFile(this.statePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    this.state.workspaces ||= [];
    this.state.pending ||= [];
    for (const workspace of this.seedWorkspaces) {
      const canonical = await this.provisioner.validateWorkspacePath(workspace.path);
      workspace.path = canonical;
      const index = this.state.workspaces.findIndex((entry) => entry.name === workspace.name);
      if (index === -1) this.state.workspaces.push(workspace);
      else this.state.workspaces[index] = { ...this.state.workspaces[index], ...workspace };
    }
    for (const workspace of this.state.workspaces) {
      workspace.path = await this.provisioner.validateWorkspacePath(workspace.path);
    }
    await this.save();
  }

  async handle({ text, senderId, senderType, source }) {
    const workspaceApproval = text.match(WORKSPACE_APPROVAL);
    if (workspaceApproval) {
      return this.approveWorkspace(workspaceApproval[1].toUpperCase(), source, { senderId, senderType });
    }

    const branchConfirmation = text.match(BRANCH_CONFIRMATION);
    if (branchConfirmation) {
      return this.confirmBranch(
        branchConfirmation[1].toUpperCase(),
        branchConfirmation[2],
        source,
        { senderId, senderType }
      );
    }

    const branchWithoutId = text.match(BRANCH_CONFIRMATION_WITHOUT_ID);
    if (branchWithoutId) {
      const candidates = this.state.pending.filter((entry) =>
        entry.kind === "branch" && entry.source.chatId === source.chatId
      );
      if (candidates.length !== 1) {
        const ids = candidates.map((entry) => entry.id).join("、");
        const detail = candidates.length === 0
          ? "当前会话没有待确认的分支任务。"
          : `当前会话有多个待确认任务（${ids}），请使用：确认分支 BR-XXXXXXXX <分支名>。`;
        return { type: "reply", source, text: detail };
      }
      return this.confirmBranch(candidates[0].id, branchWithoutId[1], source, { senderId, senderType });
    }

    const explicitName = extractWorkspaceName(text);
    const workspace = this.resolveWorkspace(text, explicitName);
    if (!workspace && explicitName) {
      if (!SAFE_WORKSPACE_NAME.test(explicitName)) {
        return { type: "reply", source, text: "工作区名称格式无效，未授予任何权限。" };
      }
      return this.requestWorkspace(explicitName, source);
    }

    if (!workspace) {
      return { type: "dispatch", source, project: this.defaultProject };
    }
    return this.routeWorkspaceTask(workspace, source);
  }

  resolveWorkspace(text, explicitName = extractWorkspaceName(text)) {
    if (explicitName) {
      const normalized = explicitName.toLowerCase();
      return this.state.workspaces.find((workspace) =>
        workspace.aliases.some((alias) => alias.toLowerCase() === normalized)
      ) || null;
    }
    const lower = text.toLowerCase();
    return this.state.workspaces.find((workspace) =>
      workspace.aliases.some((alias) => lower.includes(alias.toLowerCase()))
    ) || null;
  }

  async routeWorkspaceTask(workspace, source) {
    if (!isDevelopmentTask(source.text)) {
      return { type: "dispatch", source, project: workspace.readProject, workspace };
    }

    const git = await inspectWorkspaceGit(workspace.path);
    if (!git.isGit) {
      return {
        type: "dispatch",
        source: {
          ...source,
          text: `[入口审批信息]\n工作区：${workspace.name}\n工作区根目录未检测到 Git 元数据，因此本任务不要求根目录分支确认。\n不得搜索工作区之外；若发现并需要操作嵌套 Git 仓库，先报告相对路径和当前分支并等待主人确认。\n此信息不授权任何 Git 命令。\n\n[原始任务]\n${source.text}`
        },
        project: workspace.devProject,
        workspace,
        notice: `工作区“${workspace.name}”是普通目录，已跳过 Git 分支确认并开始执行。`
      };
    }

    const currentBranch = git.branch;
    const id = requestId("BR");
    this.state.pending.push({ id, kind: "branch", workspaceName: workspace.name, source, currentBranch });
    await this.save();
    const current = currentBranch ? `当前检测到分支：${currentBranch}。` : "当前仓库处于 detached HEAD 或分支信息不可确认。";
    return {
      type: "reply",
      source,
      text: `${this.ownerMention()}此任务需要构建、测试或修改项目，开始前需要主人确认目标 Git 分支。${current}\n请回复：确认分支 ${id} <分支名>。同一群只有一个待确认任务时，也可简写为：确认分支 <分支名>。\n确认分支不等于批准任何 Git 命令；切换、创建、提交、合并和推送仍需逐条明确批准。`
    };
  }

  async requestWorkspace(name, source) {
    const id = requestId("WR");
    this.state.pending.push({ id, kind: "workspace", workspaceName: name, source });
    await this.save();
    return {
      type: "reply",
      source,
      text: `${this.ownerMention()}工作区“${name}”尚未授权，任务已暂停且没有进入 Codex。\n申请编号：${id}\n申请范围：在受控目录查找并登记该工作区；若不存在，则在专用目录创建空工作区。\n如同意，请由主人本人回复：同意工作区 ${id}\n此批准不包含 git clone、git init 或其他 Git 操作，这些动作仍会单独请求授权。`
    };
  }

  async approveWorkspace(id, approvalSource, actor) {
    const pending = this.takePending(id, "workspace", false);
    if (!pending) return { type: "reply", source: approvalSource, text: `没有找到待审批的工作区申请 ${id}。` };
    if (!this.canApprove(pending, approvalSource, actor)) {
      return { type: "reply", source: approvalSource, text: "该审批只能由主人本人在原任务会话中完成。" };
    }
    if (this.claimed.has(id)) {
      return { type: "reply", source: approvalSource, text: `工作区申请 ${id} 正在处理中，请勿重复提交。` };
    }
    this.claimed.add(id);

    try {
      const located = await this.provisioner.findOrCreate(pending.workspaceName);
      if (located.ambiguous) {
        return {
          type: "reply",
          source: pending.source,
          text: `找到 ${located.count} 个名为“${pending.workspaceName}”的工作区，为避免选错，任务继续暂停。请先由管理员在本机工作区配置中明确登记目标目录，再重新批准 ${id}。`
        };
      }
      const registered = await this.provisioner.register({
        name: pending.workspaceName,
        aliases: [pending.workspaceName],
        path: located.path
      });
      const workspace = normalizeWorkspace(registered);
      try {
        await this.provisioner.restartCcConnect();
      } catch {
        this.logger.warn("workspace=approval-retry-required");
        return {
          type: "reply",
          source: approvalSource,
          text: `工作区“${pending.workspaceName}”已登记，但 cc-connect 尚未成功重启，原任务仍未执行。请先重启服务后，再回复：同意工作区 ${id}`
        };
      }

      this.state.workspaces.push(workspace);
      this.takePending(id, "workspace", true);
      await this.save();

      const location = located.created ? "已在受控目录创建" : "已找到并登记";
      this.logger.info(`workspace=approved created=${located.created}`);

      if (located.created) {
        return {
          type: "reply",
          source: pending.source,
          text: `${location}工作区“${workspace.name}”，但当前目录为空，原任务没有进入 Codex。请先将项目内容放入该目录，或另行提供仓库来源并针对具体 Git 命令授权；完成后重新发送原任务。`
        };
      }

      const next = await this.routeWorkspaceTask(workspace, pending.source);
      if (next.type === "reply") {
        next.text = `${location}工作区“${workspace.name}”。\n${next.text}`;
        return next;
      }
      next.notice = `${location}工作区“${workspace.name}”，正在等待 cc-connect 重载后继续原任务。`;
      next.deferUntilProjectReady = true;
      return next;
    } finally {
      this.claimed.delete(id);
    }
  }

  async confirmBranch(id, branch, confirmationSource, actor) {
    if (!SAFE_BRANCH.test(branch)) {
      return { type: "reply", source: confirmationSource, text: "分支名格式无效，任务仍处于暂停状态。" };
    }
    const pending = this.takePending(id, "branch", false);
    if (!pending) return { type: "reply", source: confirmationSource, text: `没有找到待确认的分支申请 ${id}。` };
    if (!this.canApprove(pending, confirmationSource, actor)) {
      return { type: "reply", source: confirmationSource, text: "该分支只能由主人本人在原任务会话中确认。" };
    }
    if (this.claimed.has(id)) {
      return { type: "reply", source: confirmationSource, text: `分支申请 ${id} 正在处理中，请勿重复提交。` };
    }
    this.claimed.add(id);

    try {
      const workspace = this.state.workspaces.find((entry) => entry.name === pending.workspaceName);
      if (!workspace) return { type: "reply", source: confirmationSource, text: "工作区登记已失效，未启动任务。" };

      const currentBranch = await readCurrentBranch(workspace.path);
      if (!currentBranch) {
        return {
          type: "reply",
          source: confirmationSource,
          text: `工作区“${workspace.name}”当前不是可识别的 Git 分支，未启动开发任务。请先提供或初始化正确仓库；任何 Git 命令仍需单独批准。`
        };
      }
      if (currentBranch !== branch) {
        return {
          type: "reply",
          source: confirmationSource,
          text: `目标分支“${branch}”与当前分支“${currentBranch}”不一致，任务继续暂停。本系统不会把“确认分支”当作切换分支授权；请先切换，或另行批准完整具体的 Git 命令，然后重新回复：确认分支 ${id} ${branch}`
        };
      }

      this.takePending(id, "branch", true);
      await this.save();
      return {
        type: "dispatch",
        source: {
          ...pending.source,
          text: `[入口审批信息]\n工作区：${workspace.name}\n主人已确认目标分支：${branch}\n审批编号：${id}\n注意：该确认不授权任何 Git 命令。\n\n[原始任务]\n${pending.source.text}`
        },
        project: workspace.devProject,
        workspace,
        notice: `已确认工作区“${workspace.name}”和分支“${branch}”，开始执行原任务。`
      };
    } finally {
      this.claimed.delete(id);
    }
  }

  takePending(id, kind, remove) {
    const index = this.state.pending.findIndex((entry) => entry.id === id && entry.kind === kind);
    if (index === -1) return null;
    const [pending] = remove ? this.state.pending.splice(index, 1) : [this.state.pending[index]];
    return pending;
  }

  ownerMention() {
    return this.ownerUserId ? `<at user_id="${this.ownerUserId}"></at> ` : "";
  }

  canApprove(pending, approvalSource, { senderId, senderType }) {
    return Boolean(
      this.ownerUserId &&
      senderType === "user" &&
      senderId === this.ownerUserId &&
      approvalSource.chatId === pending.source.chatId
    );
  }

  async save() {
    this.saveQueue = this.saveQueue.then(() => atomicWriteJson(this.statePath, this.state));
    await this.saveQueue;
  }
}
