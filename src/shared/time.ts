/**
 * 时间戳工具。
 *
 * §presenters "事件总线驱动" Event 接口的 timestamp 字段 MUST 是 ISO 8601；
 * §persistence-history meta.json 中 started_at / ended_at 同样要求 ISO 8601。
 *
 * 实现仅薄包装 Date.prototype.toISOString，目的是统一一个调用点便于
 * 测试 mock 与未来精度升级（如改用 process.hrtime 时不影响调用方）。
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 给定时间戳格式化为 ISO 8601。便于持久化层把已知 Date 对象写入 events.jsonl。
 */
export function toIso(date: Date): string {
  return date.toISOString();
}
