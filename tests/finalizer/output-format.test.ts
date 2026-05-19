import { describe, expect, it } from 'vitest';
import {
  KNOWN_OUTPUT_FORMATS,
  buildFormatPromptLine,
  isKnownOutputFormat,
} from '../../src/finalizer/output-format.js';

describe('KNOWN_OUTPUT_FORMATS', () => {
  it('正好 6 种合法 format', () => {
    expect(KNOWN_OUTPUT_FORMATS).toHaveLength(6);
    expect(KNOWN_OUTPUT_FORMATS).toContain('markdown');
    expect(KNOWN_OUTPUT_FORMATS).toContain('markdown_with_comparison_table');
    expect(KNOWN_OUTPUT_FORMATS).toContain('markdown_with_code_blocks');
    expect(KNOWN_OUTPUT_FORMATS).toContain('markdown_with_citations');
    expect(KNOWN_OUTPUT_FORMATS).toContain('markdown_with_pros_cons');
    expect(KNOWN_OUTPUT_FORMATS).toContain('markdown_with_stepped_reasoning');
  });
});

describe('isKnownOutputFormat', () => {
  it('6 种合法值都识别为已知', () => {
    for (const f of KNOWN_OUTPUT_FORMATS) {
      expect(isKnownOutputFormat(f)).toBe(true);
    }
  });

  it('未知值识别为非已知', () => {
    expect(isKnownOutputFormat('markdown_with_unknown')).toBe(false);
    expect(isKnownOutputFormat('html')).toBe(false);
    expect(isKnownOutputFormat('')).toBe(false);
  });
});

describe('buildFormatPromptLine', () => {
  it('每种合法 format 都返回 "**期望输出格式**：..." 行', () => {
    for (const f of KNOWN_OUTPUT_FORMATS) {
      const r = buildFormatPromptLine(f);
      expect(r.promptLine).toContain('**期望输出格式**');
      expect(r.fellBack).toBe(false);
    }
  });

  it('markdown_with_comparison_table 含"对比表"提示', () => {
    expect(buildFormatPromptLine('markdown_with_comparison_table').promptLine).toContain('对比表');
  });

  it('markdown_with_citations 含"引用源"提示', () => {
    expect(buildFormatPromptLine('markdown_with_citations').promptLine).toContain('引用源');
  });

  it('markdown_with_pros_cons 含 pros / cons', () => {
    const line = buildFormatPromptLine('markdown_with_pros_cons').promptLine;
    expect(line).toContain('pros');
    expect(line).toContain('cons');
  });

  it('未知值 → fallback markdown + fellBack=true + originalValue', () => {
    const r = buildFormatPromptLine('totally_unknown');
    expect(r.fellBack).toBe(true);
    expect(r.originalValue).toBe('totally_unknown');
    expect(r.promptLine).toContain('markdown 自由格式');
  });
});
