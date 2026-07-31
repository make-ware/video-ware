import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import {
  applyOptions,
  parseCropRect,
  parseIndex,
  parseSecondsList,
  pickOptions,
} from '../lib/options.js';

const group = {
  label: { flags: '--label <text>', description: 'a label' },
  limit: {
    flags: '-n, --limit <count>',
    description: 'a count',
    parse: (v: string) => parseInt(v, 10),
  },
};

function parsed(argv: string[], extra?: (cmd: Command) => void): Command {
  const cmd = new Command();
  extra?.(cmd);
  applyOptions(cmd, group);
  cmd.parse(argv, { from: 'user' });
  return cmd;
}

describe('applyOptions / pickOptions', () => {
  it('registers flags and extracts parsed values under group keys', () => {
    const cmd = parsed(['--label', 'hello', '-n', '42']);
    expect(pickOptions(cmd.opts(), group)).toEqual({
      label: 'hello',
      limit: 42,
    });
  });

  it('omits options that were not passed', () => {
    const cmd = parsed(['--label', 'hello']);
    const picked = pickOptions(cmd.opts(), group);
    expect(picked).toEqual({ label: 'hello' });
    expect('limit' in picked).toBe(false);
  });

  it('leaves options outside the group untouched', () => {
    const cmd = parsed(['-w', 'ws1', '--label', 'x'], (c) => {
      c.option('-w, --workspace <id>', 'workspace');
    });
    expect(pickOptions(cmd.opts(), group)).toEqual({ label: 'x' });
    expect(cmd.opts().workspace).toBe('ws1');
  });

  it('rejects a group key that does not match its flag attribute name', () => {
    expect(() =>
      applyOptions(new Command(), {
        clipLabel: { flags: '--label <text>', description: 'mismatched key' },
      })
    ).toThrow(/clipLabel/);
  });
});

describe('parseSecondsList', () => {
  it('parses comma-separated non-negative seconds', () => {
    expect(parseSecondsList('1.5,3.2, 9')).toEqual([1.5, 3.2, 9]);
    expect(parseSecondsList('12.4')).toEqual([12.4]);
  });

  it('rejects empty lists and negative or non-numeric values', () => {
    expect(() => parseSecondsList(',')).toThrow(/comma-separated/i);
    expect(() => parseSecondsList('1,-2')).toThrow(/non-negative/i);
    expect(() => parseSecondsList('abc')).toThrow(/non-negative/i);
  });
});

describe('parseIndex', () => {
  it('parses a non-negative integer', () => {
    expect(parseIndex('0')).toBe(0);
    expect(parseIndex('7')).toBe(7);
  });

  it('rejects negatives, floats, and non-numbers', () => {
    expect(() => parseIndex('-1')).toThrow(/non-negative integer/i);
    expect(() => parseIndex('1.5')).toThrow(/non-negative integer/i);
    expect(() => parseIndex('x')).toThrow(/non-negative integer/i);
  });
});

describe('parseCropRect', () => {
  it('parses four comma-separated fractions', () => {
    expect(parseCropRect('0.1,0,0.8,1')).toEqual({
      left: 0.1,
      top: 0,
      width: 0.8,
      height: 1,
    });
    expect(parseCropRect(' 0.25 , 0 , 0.5 , 1 ')).toEqual({
      left: 0.25,
      top: 0,
      width: 0.5,
      height: 1,
    });
  });

  it('rejects wrong arity and non-numeric parts', () => {
    expect(() => parseCropRect('0.1,0,0.8')).toThrow(/left,top,width,height/i);
    expect(() => parseCropRect('a,b,c,d')).toThrow(/left,top,width,height/i);
  });

  it('rejects rects that escape the frame or are degenerate', () => {
    expect(() => parseCropRect('0.6,0,0.6,1')).toThrow(/right edge/i);
    expect(() => parseCropRect('0,0.6,1,0.6')).toThrow(/bottom edge/i);
    expect(() => parseCropRect('0,0,0,1')).toThrow();
  });
});
