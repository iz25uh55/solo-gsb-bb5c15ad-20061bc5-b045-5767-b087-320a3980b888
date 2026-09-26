import { BackwardInfo, CycleInfo, Project, ScheduleResult } from './types';

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
