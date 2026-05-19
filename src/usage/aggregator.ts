import type { Usage } from '../shared/adapter.js';

/**
 * Token usage 聚合器。
 *
 * 来自 §token-usage-tracking "持久化到 meta.json" + tasks.md §15.1 §15.5。
 *
 * 二维归档：[agent_name][round_number] = Usage | null
 * usage_totals.agent + usage_totals.grand_total（仅累加非 null 项）
 *
 * null 透传不阻塞流程；v1 不本地估算（adapter 自报 provisional 加 ~ 前缀，
 * 已由 adapters/runtime/usage.ts 处理）。
 */

/** 二维归档形态：agent → round → Usage | null（null 显式记录"该轮 CLI 不暴露 usage"）。 */
export type UsageMatrix = Record<string, Record<string, Usage | null>>;

export interface UsageTotals {
  /** 每个 agent 的累加 token 数（input + output + cached + reasoning，仅非 null 累加） */
  byAgent: Record<string, number>;
  /** 所有 agent 总和（仅非 null 累加） */
  grand_total: number;
}

/**
 * 聚合器：累积每个 agent 每轮的 usage，最终输出 matrix + totals。
 *
 * 设计：可变 class（runtime 用），结尾 build() 输出不可变 plain object 便于序列化进 meta.json。
 */
export class UsageAggregator {
  private matrix: UsageMatrix = {};

  /**
   * 记录某 agent 某轮的 usage。
   *
   * @param agent  agent 名（如 "claude"）
   * @param round  轮号（单 agent 路径用 1）
   * @param usage  来自 AdapterResult.usage；null 表示 CLI 不暴露
   */
  record(agent: string, round: number, usage: Usage | null): void {
    const byRound = this.matrix[agent] ?? (this.matrix[agent] = {});
    byRound[String(round)] = usage;
  }

  /** 取已记录的 matrix 副本（不可变深拷贝）。 */
  getMatrix(): UsageMatrix {
    const out: UsageMatrix = {};
    for (const [agent, byRound] of Object.entries(this.matrix)) {
      out[agent] = { ...byRound };
    }
    return out;
  }

  /** 计算 usage_totals。 */
  computeTotals(): UsageTotals {
    const byAgent: Record<string, number> = {};
    let grand = 0;
    for (const [agent, byRound] of Object.entries(this.matrix)) {
      let agentSum = 0;
      for (const usage of Object.values(byRound)) {
        if (usage === null) continue;
        agentSum += sumUsage(usage);
      }
      byAgent[agent] = agentSum;
      grand += agentSum;
    }
    return { byAgent, grand_total: grand };
  }

  /**
   * 取每个 agent 截至目前的 cumulative usage（TUI 实时 ticker 用）。
   *
   * 返回 agent → { input, output, cached, reasoning, total, hasAnyProvisional }
   * - 任一 round 是 null 则跳过累加（但 agent key 仍出现，便于显示 "-"）
   * - 任一 round usage.provisional=true 则 hasAnyProvisional=true（TUI 加 ~ 前缀）
   */
  getCumulative(): Record<
    string,
    {
      input_tokens: number | null;
      output_tokens: number | null;
      cached_input_tokens: number | null;
      reasoning_tokens: number | null;
      total: number | null;
      provisional: boolean;
      roundsCounted: number;
    }
  > {
    const out: Record<string, ReturnType<UsageAggregator['getCumulative']>[string]> = {};
    for (const [agent, byRound] of Object.entries(this.matrix)) {
      let input = 0;
      let output = 0;
      let cached = 0;
      let reasoning = 0;
      let hasInput = false;
      let hasOutput = false;
      let hasCached = false;
      let hasReasoning = false;
      let provisional = false;
      let roundsCounted = 0;

      for (const usage of Object.values(byRound)) {
        if (usage === null) continue;
        roundsCounted++;
        input += usage.input_tokens;
        output += usage.output_tokens;
        hasInput = true;
        hasOutput = true;
        if (usage.cached_input_tokens !== undefined) {
          cached += usage.cached_input_tokens;
          hasCached = true;
        }
        if (usage.reasoning_tokens !== undefined) {
          reasoning += usage.reasoning_tokens;
          hasReasoning = true;
        }
        if (usage.provisional === true) provisional = true;
      }

      const total = hasInput || hasOutput || hasCached || hasReasoning
        ? input + output + cached + reasoning
        : null;
      out[agent] = {
        input_tokens: hasInput ? input : null,
        output_tokens: hasOutput ? output : null,
        cached_input_tokens: hasCached ? cached : null,
        reasoning_tokens: hasReasoning ? reasoning : null,
        total,
        provisional,
        roundsCounted,
      };
    }
    return out;
  }

  /** 序列化为 meta.json 中的 { usage, usage_totals } 结构。 */
  build(): { usage: UsageMatrix; usage_totals: { grand_total: number } & Record<string, number> } {
    const totals = this.computeTotals();
    // meta.json 形态：usage_totals 是平铺的 { <agent>: N, grand_total: N }
    const flatTotals: Record<string, number> = { ...totals.byAgent, grand_total: totals.grand_total };
    return {
      usage: this.getMatrix(),
      usage_totals: flatTotals as { grand_total: number } & Record<string, number>,
    };
  }
}

function sumUsage(u: Usage): number {
  return (
    u.input_tokens +
    u.output_tokens +
    (u.cached_input_tokens ?? 0) +
    (u.reasoning_tokens ?? 0)
  );
}
