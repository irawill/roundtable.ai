import { randomUUID } from 'node:crypto';

/**
 * v4 UUID 工具。
 *
 * 用 Node 内置 crypto.randomUUID（Node 14.17+ 提供，22 LTS 稳定）。
 * v1 持久化层 run_id MUST 是 v4 UUID（来自 §persistence-history "Run 目录内的文件结构"）。
 */
export function uuidv4(): string {
  return randomUUID();
}

/** 校验字符串是否合法 v4 UUID 形式（用于 rtai show / resume / forget 的 input 校验）。 */
const V4_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuidV4(s: string): boolean {
  return V4_UUID_RE.test(s);
}
