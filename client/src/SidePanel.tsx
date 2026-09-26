import { Project, ScheduleResult } from './types';
import { Selection } from './GraphCanvas';

interface SidePanelProps {
  project: Project;
  schedule: ScheduleResult | null;
  selection: Selection | null;
  onUpdateNode: (id: string, patch: { name?: string; duration?: number }) => void;
  onUpdateEdge: (id: string, patch: { minDelay?: number }) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}

export function SidePanel(props: SidePanelProps) {
  const { project, schedule, selection } = props;

  if (selection?.type === 'node') {
    const node = project.nodes.find((n) => n.id === selection.id);
    if (!node) return null;
    const startAt = schedule?.starts[node.id];
    const backward = schedule?.backward;
    const latestAt = backward?.latestStarts[node.id];
    const floatAt = backward?.floats[node.id];
    const isCritical = backward?.criticalNodeIds.includes(node.id) ?? false;
    return (
      <div className="side-panel">
        <h3>口令属性</h3>
        <label>
          名称
          <input
            value={node.name}
            onChange={(e) => props.onUpdateNode(node.id, { name: e.target.value })}
          />
        </label>
        <label>
          持续时长（秒）
          <input
            type="number"
            min={0}
            step={0.5}
            value={node.duration}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) props.onUpdateNode(node.id, { duration: v });
            }}
          />
        </label>
        <p className="hint">
          最早开始：{startAt !== undefined ? `${round1(startAt)}s` : '—'}
          {startAt !== undefined && `，最早完成：${round1(startAt + node.duration)}s`}
        </p>
        {backward && latestAt !== undefined && floatAt !== undefined && (
          <p className={`hint ${isCritical ? 'critical-hint' : ''}`}>
            最晚开始：{round1(latestAt)}s，浮动：{round1(floatAt)}s
            {isCritical && '（关键链）'}
          </p>
        )}
        <button className="danger" onClick={() => props.onDeleteNode(node.id)}>
          删除口令
        </button>
      </div>
    );
  }

  if (selection?.type === 'edge') {
    const edge = project.edges.find((e) => e.id === selection.id);
    if (!edge) return null;
    const from = project.nodes.find((n) => n.id === edge.from);
    const to = project.nodes.find((n) => n.id === edge.to);
    return (
      <div className="side-panel">
        <h3>前置约束</h3>
        <p className="hint">
          {from?.name ?? '?'} → {to?.name ?? '?'}
        </p>
        <label>
          前置完成后至少等待（秒）
          <input
            type="number"
            min={0}
            step={0.5}
            value={edge.minDelay}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) props.onUpdateEdge(edge.id, { minDelay: v });
            }}
          />
        </label>
        <button className="danger" onClick={() => props.onDeleteEdge(edge.id)}>
          删除约束
        </button>
        {schedule?.backward?.criticalEdgeIds.includes(edge.id) && (
          <p className="hint critical-hint">该约束位于关键链上</p>
        )}
      </div>
    );
  }

  return (
    <div className="side-panel">
      <h3>操作说明</h3>
      <ul className="help">
        <li>点击工具栏「添加口令」新建口令节点</li>
        <li>拖动脉口令右侧圆点到另一口令，建立前置约束</li>
        <li>点击口令或约束线进行选中与编辑</li>
        <li>拖动空白处平移，滚轮缩放</li>
        <li>每次修改都会实时重算最早执行时间</li>
        <li>工具栏勾选「开场截止」后按截止秒数倒排，浮动最小的链路即关键链</li>
      </ul>
      {schedule && (
        <p className="hint">
          当前排程总时长：{round1(schedule.makespan)}s，共 {project.nodes.length} 条口令、
          {project.edges.length} 条约束。
        </p>
      )}
      {schedule?.backward && (
        <p className={`hint ${schedule.backward.overrun > 0 ? 'overrun-hint' : ''}`}>
          开场截止：{round1(schedule.backward.deadline)}s，
          {schedule.backward.overrun > 0
            ? `超期 ${round1(schedule.backward.overrun)}s`
            : `余量 ${round1(schedule.backward.deadline - schedule.makespan)}s`}
          ，关键链 {schedule.backward.criticalNodeIds.length} 条口令。
        </p>
      )}
    </div>
  );
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}
