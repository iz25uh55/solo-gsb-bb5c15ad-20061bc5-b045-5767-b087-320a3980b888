import {
  BackwardInfo,
  CommandEdge,
  CycleInfo,
  Project,
  RehearsalChange,
  RehearsalDelay,
  RehearsalResult,
  ScheduleResult,
} from './types';

const EPS = 1e-9;

/**
 * 计算每个口令的最早开始时间（Kahn 拓扑排序，O(V+E)）。
 * 规则：start(to) >= start(from) + duration(from) + minDelay(edge)。
 * 若图中存在环依赖，返回 ok=false 并给出一条具体的成环路径用于高亮。
 */
export function computeSchedule(project: Project): ScheduleResult {
  const { nodes, edges } = project;
  const starts: Record<string, number> = {};
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, { to: string; minDelay: number }[]>();

  for (const n of nodes) {
    indegree.set(n.id, 0);
    outgoing.set(n.id, []);
    starts[n.id] = 0;
  }
  for (const e of edges) {
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    outgoing.get(e.from)!.push({ to: e.to, minDelay: e.minDelay });
  }

  const durationOf = new Map(nodes.map((n) => [n.id, n.duration]));
  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    processed++;
    const finishAt = starts[id] + (durationOf.get(id) ?? 0);
    for (const { to, minDelay } of outgoing.get(id) ?? []) {
      const candidate = finishAt + minDelay;
      if (candidate > starts[to]) starts[to] = candidate;
      const deg = indegree.get(to)! - 1;
      indegree.set(to, deg);
      if (deg === 0) queue.push(to);
    }
  }

  if (processed === nodes.length) {
    let makespan = 0;
    for (const n of nodes) {
      makespan = Math.max(makespan, starts[n.id] + n.duration);
    }
    const dl = project.deadline;
    const backward =
      dl?.enabled && Number.isFinite(dl.seconds) && dl.seconds >= 0
        ? computeBackward(project, starts, makespan, dl.seconds)
        : undefined;
    return { ok: true, starts, makespan, backward };
  }

  return { ok: false, starts, makespan: 0, cycle: findCycle(project, indegree) };
}

/**
 * 截止倒排（CPM 反向 pass，O(V+E)，仅在无环图上调用）。
 * 规则：latestStart(from) <= latestStart(to) - minDelay(edge) - duration(from)，
 * 无后继口令的最晚完成时间锚定在截止时刻。
 * 浮动 = 最晚开始 - 最早开始；截止早于最短工期时浮动为负，如实保留。
 * 关键链取浮动最小的节点（截止恰好等于最短工期时即浮动为 0），
 * 以及两端皆关键、且前向约束被拉紧的边。
 */
function computeBackward(
  project: Project,
  starts: Record<string, number>,
  makespan: number,
  deadline: number,
): BackwardInfo {
  const { nodes, edges } = project;
  const durationOf = new Map(nodes.map((n) => [n.id, n.duration]));
  const outdegree = new Map<string, number>();
  const incoming = new Map<string, { from: string; minDelay: number }[]>();
  for (const n of nodes) {
    outdegree.set(n.id, 0);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    if (!outdegree.has(e.from) || !outdegree.has(e.to)) continue;
    outdegree.set(e.from, (outdegree.get(e.from) ?? 0) + 1);
    incoming.get(e.to)!.push({ from: e.from, minDelay: e.minDelay });
  }

  // 逆 Kahn：节点出队时其全部后继已处理，最晚完成时间随之确定
  const latestStarts: Record<string, number> = {};
  const bestFinish = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of outdegree) {
    if (deg === 0) queue.push(id);
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const finish = bestFinish.get(id) ?? deadline; // 无后继 → 锚定截止时刻
    const latestStart = finish - (durationOf.get(id) ?? 0);
    latestStarts[id] = latestStart;
    for (const pred of incoming.get(id) ?? []) {
      const cand = latestStart - pred.minDelay;
      const prev = bestFinish.get(pred.from);
      if (prev === undefined || cand < prev) bestFinish.set(pred.from, cand);
      const deg = outdegree.get(pred.from)! - 1;
      outdegree.set(pred.from, deg);
      if (deg === 0) queue.push(pred.from);
    }
  }

  const floats: Record<string, number> = {};
  let minFloat = Infinity;
  for (const n of nodes) {
    const f = (latestStarts[n.id] ?? 0) - (starts[n.id] ?? 0);
    floats[n.id] = f;
    if (f < minFloat) minFloat = f;
  }
  if (!Number.isFinite(minFloat)) minFloat = 0;

  const criticalNodeIds = nodes
    .filter((n) => Math.abs(floats[n.id] - minFloat) < EPS)
    .map((n) => n.id);
  const criticalSet = new Set(criticalNodeIds);
  const criticalEdgeIds: string[] = [];
  for (const e of edges) {
    if (!criticalSet.has(e.from) || !criticalSet.has(e.to)) continue;
    const tight = (starts[e.from] ?? 0) + (durationOf.get(e.from) ?? 0) + e.minDelay;
    if (Math.abs((starts[e.to] ?? 0) - tight) < EPS) criticalEdgeIds.push(e.id);
  }

  return {
    deadline,
    latestStarts,
    floats,
    criticalNodeIds,
    criticalEdgeIds,
    overrun: Math.max(0, makespan - deadline),
  };
}

/**
 * 在未被拓扑处理的剩余节点中找出一条具体的环路径。
 * 剩余子图中每个节点都至少有一条来自剩余节点的入边，
 * 因此沿“剩余前置”不断回溯必然重复，重复段即为一个环。
 */
function findCycle(project: Project, indegree: Map<string, number>): CycleInfo | undefined {
  const remaining = new Set<string>();
  for (const [id, deg] of indegree) {
    if (deg > 0) remaining.add(id);
  }
  if (remaining.size === 0) return undefined;

  // 剩余节点 -> 来自剩余节点的入边
  const incoming = new Map<string, { from: string; edgeId: string }[]>();
  for (const id of remaining) incoming.set(id, []);
  for (const e of project.edges) {
    if (remaining.has(e.from) && remaining.has(e.to)) {
      incoming.get(e.to)!.push({ from: e.from, edgeId: e.id });
    }
  }

  const start = remaining.values().next().value as string;
  const visitIndex = new Map<string, number>();
  const pathNodes: string[] = [];
  const pathEdges: string[] = [];
  let cur = start;

  while (!visitIndex.has(cur)) {
    visitIndex.set(cur, pathNodes.length);
    pathNodes.push(cur);
    const inc = incoming.get(cur);
    if (!inc || inc.length === 0) return undefined; // 理论上不会发生
    const next = inc[0];
    pathEdges.push(next.edgeId);
    cur = next.from;
  }

  const cycleStart = visitIndex.get(cur)!;
  return {
    nodeIds: pathNodes.slice(cycleStart),
    edgeIds: pathEdges.slice(cycleStart),
  };
}

/**
 * 增量预演：在内存克隆的口令图上应用一处改动（口令持续时长或约束等待秒数，
 * 仅允许不小于当前值），重算排程并与现行排程对比。
 * 不修改入参、不触发保存；调用方据此并排展示现行与试算结果。
 *
 * 返回每个开始时刻实际推迟的口令及其推迟秒数，并给出从改动点沿
 * 紧约束（试算排程中被拉等的前置约束）传播到该口令的前驱路径；
 * 同一节点存在多条等长紧约束入边时按边 id 字典序稳定选一路。
 */
export function simulateRehearsal(
  project: Project,
  change: RehearsalChange,
  base: ScheduleResult,
): RehearsalResult {
  // 内存克隆，原图与现行排程保持不变
  const cloned: Project = {
    ...project,
    nodes: project.nodes.map((n) => ({ ...n })),
    edges: project.edges.map((e) => ({ ...e })),
    deadline: project.deadline ? { ...project.deadline } : undefined,
  };
  if (change.kind === 'node') {
    const node = cloned.nodes.find((n) => n.id === change.id);
    if (!node || !(change.value >= node.duration)) return { ok: false, delays: [] };
    node.duration = change.value;
  } else {
    const edge = cloned.edges.find((e) => e.id === change.id);
    if (!edge || !(change.value >= edge.minDelay)) return { ok: false, delays: [] };
    edge.minDelay = change.value;
  }

  const trial = computeSchedule(cloned);
  if (!trial.ok) return { ok: false, cycle: trial.cycle, delays: [] };

  const delays: RehearsalDelay[] = [];
  for (const n of cloned.nodes) {
    const before = base.starts[n.id];
    const after = trial.starts[n.id];
    if (before === undefined || after === undefined) continue;
    if (after > before + EPS) {
      delays.push({
        id: n.id,
        delay: after - before,
        ...traceTightPath(cloned, change, trial.starts, n.id),
      });
    }
  }
  // 推迟秒数降序；等长按节点 id 稳定排序，保证展示确定
  delays.sort((a, b) => b.delay - a.delay || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ok: true, schedule: trial, delays };
}

/**
 * 在试算排程中从被推迟口令沿紧约束入边回溯到改动点，得到前驱传播路径。
 * 推迟只可能源于本次唯一改动：若紧约束入边的前驱本身未推迟，
 * 则该边（或其前驱）必为改动点，回溯在此终止。
 * 同一节点有多条等长紧约束入边时按边 id 字典序取最小，保证路径稳定。
 */
function traceTightPath(
  trial: Project,
  change: RehearsalChange,
  trialStarts: Record<string, number>,
  targetId: string,
): { pathNodeIds: string[]; pathEdgeIds: string[] } {
  const durationOf = new Map(trial.nodes.map((n) => [n.id, n.duration]));
  const incoming = new Map<string, CommandEdge[]>();
  for (const e of trial.edges) {
    const list = incoming.get(e.to);
    if (list) list.push(e);
    else incoming.set(e.to, [e]);
  }

  const nodeIds = [targetId];
  const edgeIds: string[] = [];
  const visited = new Set<string>([targetId]);
  let cur = targetId;

  for (;;) {
    if (change.kind === 'node' && cur === change.id) break; // 回溯到达改动口令
    const tight = (incoming.get(cur) ?? []).filter(
      (e) =>
        Math.abs(
          (trialStarts[e.from] ?? 0) + (durationOf.get(e.from) ?? 0) + e.minDelay -
            (trialStarts[cur] ?? 0),
        ) < EPS,
    );
    if (tight.length === 0) break; // 无环图中被推迟口令必有紧约束入边，此处仅作防御
    tight.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const chosen = tight[0];
    edgeIds.push(chosen.id);
    nodeIds.push(chosen.from);
    cur = chosen.from;
    if (change.kind === 'edge' && chosen.id === change.id) break; // 经改动约束传播，源头即其前驱
    if (visited.has(cur)) break; // 理论不可达（无环），防御死循环
    visited.add(cur);
  }

  nodeIds.reverse();
  edgeIds.reverse();
  return { pathNodeIds: nodeIds, pathEdgeIds: edgeIds };
}
