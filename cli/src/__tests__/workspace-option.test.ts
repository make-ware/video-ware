import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { fakePb, listResult, type Stub } from './fake-pb.js';

const config: { workspaceId?: string } = {};
vi.mock('../lib/config.js', () => ({
  loadConfig: () => config,
  updateConfig: vi.fn(),
  CONFIG_PATH: '/tmp/vw-test-config.json',
}));

const {
  assertWorkspaceMatch,
  installWorkspaceOption,
  resolveWorkspaceRef,
  setWorkspaceOverride,
  workspaceOverride,
} = await import('../lib/workspace-option.js');
const { buildProgram } = await import('../program.js');

/** Every command in the tree, the root program included. */
function allCommands(cmd: Command): Command[] {
  return [cmd, ...cmd.commands.flatMap(allCommands)];
}

/** Full path of a command, e.g. "vw timeline clips update". */
function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) {
    names.unshift(c.name());
  }
  return names.join(' ');
}

/** A three-level program with the option installed, actions inert. */
function harness(): Command {
  const program = new Command('vw');
  const group = program.command('group');
  group.command('leaf').action(() => {});
  return installWorkspaceOption(program);
}

beforeEach(() => {
  setWorkspaceOverride(undefined);
  delete config.workspaceId;
});

describe('-w is accepted everywhere', () => {
  it('registers -w on every command in the real program', () => {
    const missing = allCommands(buildProgram())
      .filter(
        (cmd) =>
          !cmd.options.some(
            (opt) => opt.short === '-w' && opt.long === '--workspace'
          )
      )
      .map(commandPath);
    expect(missing).toEqual([]);
  });

  it('covers commands that never resolve a workspace', () => {
    const paths = allCommands(buildProgram()).map(commandPath);
    // Sanity check on the walk: id-addressed and auth commands are included,
    // so an agent passing -w uniformly never hits "unknown option".
    expect(paths).toContain('vw login');
    expect(paths).toContain('vw media show');
    expect(paths).toContain('vw timeline clips update');
  });

  it('takes a value (never parses as a boolean flag)', () => {
    const option = buildProgram()
      .commands.find((c) => c.name() === 'media')!
      .commands.find((c) => c.name() === 'list')!
      .options.find((opt) => opt.short === '-w')!;
    expect(option.required).toBe(true);
  });
});

describe('capturing the override', () => {
  it('accepts -w before, between, and after the subcommands', async () => {
    for (const argv of [
      ['-w', 'wsA', 'group', 'leaf'],
      ['group', '-w', 'wsA', 'leaf'],
      ['group', 'leaf', '-w', 'wsA'],
    ]) {
      setWorkspaceOverride(undefined);
      await harness().parseAsync(argv, { from: 'user' });
      expect(workspaceOverride(), argv.join(' ')).toBe('wsA');
    }
  });

  it('prefers the most specific -w and ignores empty values', async () => {
    await harness().parseAsync(
      ['-w', 'outer', 'group', '-w', 'middle', 'leaf', '-w', 'leafws'],
      { from: 'user' }
    );
    expect(workspaceOverride()).toBe('leafws');

    setWorkspaceOverride(undefined);
    await harness().parseAsync(['-w', ' ', 'group', 'leaf'], { from: 'user' });
    expect(workspaceOverride()).toBeUndefined();
  });

  it('leaves the override unset when -w is omitted', async () => {
    await harness().parseAsync(['group', 'leaf'], { from: 'user' });
    expect(workspaceOverride()).toBeUndefined();
  });
});

describe('resolveWorkspaceRef', () => {
  const workspaces = (): Stub => ({
    getOne: vi.fn(async (id: string) => {
      if (id !== 'ws1') throw Object.assign(new Error('nf'), { status: 404 });
      return { id: 'ws1', name: 'Test WS', slug: 'test-ws' };
    }),
    getFirstListItem: vi.fn(async (filter: string) => {
      if (!filter.includes('test-ws')) {
        throw Object.assign(new Error('nf'), { status: 404 });
      }
      return { id: 'ws1', name: 'Test WS', slug: 'test-ws' };
    }),
    getList: vi.fn(async () =>
      listResult([{ id: 'ws1', name: 'Test WS', slug: 'test-ws' }])
    ),
  });

  it('skips the lookup for the already-active workspace', async () => {
    config.workspaceId = 'ws1';
    const collections = { Workspaces: workspaces() };
    expect(await resolveWorkspaceRef(fakePb(collections), 'ws1')).toBe('ws1');
    expect(collections.Workspaces.getOne).not.toHaveBeenCalled();
  });

  it('resolves an id, a slug, or a name', async () => {
    expect(
      await resolveWorkspaceRef(fakePb({ Workspaces: workspaces() }), 'ws1')
    ).toBe('ws1');
    expect(
      await resolveWorkspaceRef(fakePb({ Workspaces: workspaces() }), 'test-ws')
    ).toBe('ws1');
    expect(
      await resolveWorkspaceRef(fakePb({ Workspaces: workspaces() }), 'Test ws')
    ).toBe('ws1');
  });

  it('looks a ref up once per invocation', async () => {
    const collections = { Workspaces: workspaces() };
    const pb = fakePb(collections);
    await resolveWorkspaceRef(pb, 'test-ws');
    await resolveWorkspaceRef(pb, 'test-ws');
    expect(collections.Workspaces.getFirstListItem).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown ref instead of silently listing nothing', async () => {
    await expect(
      resolveWorkspaceRef(fakePb({ Workspaces: workspaces() }), 'nope')
    ).rejects.toThrow(/No workspace matching "nope"/);
  });
});

describe('assertWorkspaceMatch', () => {
  const pb = () =>
    fakePb({
      Workspaces: {
        getOne: vi.fn(async (id: string) => ({ id, name: id })),
      },
    });

  it('does nothing when no -w was passed', async () => {
    const collections = { Workspaces: { getOne: vi.fn() } };
    await assertWorkspaceMatch(fakePb(collections), 'ws2', 'Timeline tl1');
    expect(collections.Workspaces.getOne).not.toHaveBeenCalled();
  });

  it('passes when -w agrees with the record', async () => {
    setWorkspaceOverride('ws1');
    await expect(
      assertWorkspaceMatch(pb(), 'ws1', 'Timeline tl1')
    ).resolves.toBeUndefined();
  });

  it('refuses a -w that contradicts the record', async () => {
    setWorkspaceOverride('ws2');
    await expect(
      assertWorkspaceMatch(pb(), 'ws1', 'Timeline tl1')
    ).rejects.toThrow(/Timeline tl1 belongs to workspace ws1, not ws2 \(-w\)/);
  });
});
