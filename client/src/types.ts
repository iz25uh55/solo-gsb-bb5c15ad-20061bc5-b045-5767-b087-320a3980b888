export interface CommandNode {
  id: string;
  name: string;
  /** 口令执行持续时长（秒） */
  duration: number;
  x: number;
  y: number;
}

export interface CommandEdge {
  id: string;
  /** 前置口令 */
  from: string;
  /** 后继口令 */
  to: string;
  /** 前置完成后至少等待的秒数 */
  minDelay: number;
}

/** 开场截止设置（相对排程零点的秒数） */
export interface DeadlineSetting {
  enabled: boolean;
  seconds: number;
}

export interface Project {
  nodes: CommandNode[];
  edges: CommandEdge[];
  /** 开场截止设置；缺省表示未配置（兼容旧数据） */
  deadline?: DeadlineSetting;
}

export interface CycleInfo {
  /** 成环路径上的节点 id（按环顺序） */
  nodeIds: string[];
  /** 成环路径上的边 id（按环顺序） */
  edgeIds: string[];
}

/** 截止倒排结果：按全部后继约束反向计算的最晚开始与浮动 */
export interface BackwardInfo {
  /** 本次倒排使用的截止秒数 */
  deadline: number;
  /** 每个口令的最晚开始时间（秒） */
  latestStarts: Record<string, number>;
  /** 每个口令的浮动时间（最晚开始 - 最早开始；超期时为负） */
  floats: Record<string, number>;
  /** 关键链上的节点 id（浮动最小，正常排程下即浮动为 0） */
  criticalNodeIds: string[];
  /** 关键链上的约束边 id */
  criticalEdgeIds: string[];
  /** 截止时间早于最短工期时的超期秒数（未超期为 0） */
  overrun: number;
}

export interface ScheduleResult {
  ok: boolean;
  /** 每个口令的最早开始时间（秒，相对排程零点） */
  starts: Record<string, number>;
  /** 全部口令完成的总时长（秒） */
  makespan: number;
  cycle?: CycleInfo;
  /** 启用截止时间且图无环时的倒排结果 */
  backward?: BackwardInfo;
}

/** 增量预演的改动点：口令持续时长或约束等待秒数（仅允许不小于当前值） */
export interface RehearsalChange {
  kind: 'node' | 'edge';
  id: string;
  /** 试算采用的新值（秒） */
  value: number;
}

/** 试算中开始时刻实际推迟的一条口令 */
export interface RehearsalDelay {
  id: string;
  /** 开始时刻实际推迟的秒数 */
  delay: number;
  /** 从改动点沿紧约束传播到该口令的前驱路径（节点 id，含改动点与自身） */
  pathNodeIds: string[];
  /** 路径上的约束边 id（等长路径按边 id 稳定选出） */
  pathEdgeIds: string[];
}

/** 增量预演结果（纯内存试算，不触发保存） */
export interface RehearsalResult {
  ok: boolean;
  /** 试算图成环时给出成环路径（此时无法试算） */
  cycle?: CycleInfo;
  /** 试算得到的新排程（无环时可用） */
  schedule?: ScheduleResult;
  /** 开始时刻实际推迟的口令（按推迟秒数降序，等长按节点 id 稳定排序） */
  delays: RehearsalDelay[];
}

export type SimState = 'idle' | 'running' | 'paused' | 'finished';

export type NodeStatus = 'pending' | 'running' | 'done';

export interface NodeRuntime {
  status: NodeStatus;
  /** 实际开始时间（秒） */
  start?: number;
  /** 实际/预计结束时间（秒） */
  end?: number;
}
