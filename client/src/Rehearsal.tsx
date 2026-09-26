import { useMemo, useState } from 'react';
import { simulateRehearsal } from './schedule';
import { CycleInfo, Project, RehearsalChange, ScheduleResult } from './types';

interface RehearsalProps {
  project: Project;
  /** 现行有效排程（环回退后的结果），作为试算对比基准 */
  schedule: ScheduleResult | null;
  /** 当前图的成环信息（有环时无法试算，仅展示环路径） */
  cycle?: CycleInfo;
  /** 改动点：选中的口令或前置约束及其当前值 */
  target: { kind: 'node' | 'edge'; id: string; current: number };
  /** 点「应用」才沿现有编辑与保存链写入 */
  onApply: (change: RehearsalChange) => void;
}

/**
 * 增量预演：输入不小于当前值的持续时长 / 等待秒数，在内存克隆口令图试算，
 * 不触发保存；并排对比现行与试算的总工期与截止超期量，列出实际推迟的
 * 口令及从改动点沿紧约束传播的前驱路径。取消即丢弃。
 */
export function Rehearsal(props: RehearsalProps) {
  const { project, schedule, cycle, target } = props;
  const [input, setInput] = useState('');

  const value = input.trim() === '' ? null : Number(input);
  const valid = value !== null && Number.isFinite(value) && value >= target.current;
  const changed = valid && value > target.current;

  // 纯内存试算：输入合法且确有增大时即时演算，不写入口令图
  const rehearsal = useMemo(
    () =>
      changed && schedule && !cycle
        ? simulateRehearsal(project, { kind: target.kind, id: target.id, value }, schedule)
        : null,
    [changed, schedule, cycle, project, target.kind, target.id, value],
  );

  const nameOf = (id: string) => project.nodes.find((n) => n.id === id)?.name ?? '?';
  const reset = () => setInput('');

  const label = target.kind === 'node' ? '预演持续时长（秒）' : '预演等待秒数（秒）';
  const trialSchedule = rehearsal?.ok ? rehearsal.schedule : undefined;
  const baseBackward = schedule?.backward;
  const trialBackward = trialSchedule?.backward;

  return (
    <div className="rehearsal">
      <h4>增量预演</h4>
      <label>
        {label}
        <input
          type="number"
          min={target.current}
          step={0.5}
          value={input}
          placeholder={`当前 ${round1(target.current)}s`}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      {input.trim() !== '' && !valid && (
        <p className="hint rehearsal-warn">预演值须不小于当前值（{round1(target.current)}s）。</p>
      )}
      {cycle && (
        <p className="hint rehearsal-warn">
          当前口令图存在环依赖，无法试算。成环路径：
          {cycle.nodeIds.map(nameOf).join(' → ')}
        </p>
      )}
      {rehearsal && !rehearsal.ok && rehearsal.cycle && (
        <p className="hint rehearsal-warn">
          试算图存在环依赖，无法试算。成环路径：
          {rehearsal.cycle.nodeIds.map(nameOf).join(' → ')}
        </p>
      )}
      {rehearsal?.ok && trialSchedule && (
        <>
          <table className="rehearsal-compare">
            <thead>
              <tr>
                <th />
                <th>现行</th>
                <th>试算</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>总工期</td>
                <td>{schedule ? `${round1(schedule.makespan)}s` : '—'}</td>
                <td className={deltaClass(trialSchedule.makespan, schedule?.makespan)}>
                  {round1(trialSchedule.makespan)}s
                </td>
              </tr>
              <tr>
                <td>截止超期</td>
                <td>{baseBackward ? overrunText(baseBackward.overrun) : '—'}</td>
                <td className={deltaClass(trialBackward?.overrun ?? 0, baseBackward?.overrun ?? 0)}>
                  {trialBackward ? overrunText(trialBackward.overrun) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
          {rehearsal.delays.length === 0 ? (
            <p className="hint">无口令的开始时刻推迟。</p>
          ) : (
            <ul className="rehearsal-delays">
              {rehearsal.delays.map((d) => (
                <li key={d.id}>
                  <span className="rehearsal-delay-head">
                    {nameOf(d.id)} <em>+{round1(d.delay)}s</em>
                  </span>
                  <span className="rehearsal-path">
                    传播路径：{d.pathNodeIds.map(nameOf).join(' → ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="rehearsal-actions">
            <button
              className="primary"
              onClick={() => {
                props.onApply({ kind: target.kind, id: target.id, value: value! });
                reset();
              }}
            >
              应用
            </button>
            <button onClick={reset}>取消</button>
          </div>
        </>
      )}
      {!rehearsal && !cycle && (
        <p className="hint">输入新值后即时试算，不写入口令图；点「应用」才会保存。</p>
      )}
    </div>
  );
}

function overrunText(overrun: number): string {
  return overrun > 1e-9 ? `超期 ${round1(overrun)}s` : '未超期';
}

/** 试算列相对现行的增减着色：增大标红、不变不着色。 */
function deltaClass(trial: number, base: number | undefined): string {
  if (base === undefined) return '';
  return trial > base + 1e-9 ? 'rehearsal-worse' : '';
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}
