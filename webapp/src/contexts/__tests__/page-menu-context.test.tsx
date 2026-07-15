import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, renderHook, fireEvent } from '@testing-library/react';
import {
  PageMenuProvider,
  usePageMenuStore,
  type PageMenuItem,
} from '@/contexts/page-menu-context';
import { usePageMenus, useRegisterPageMenu } from '@/hooks/use-page-menu';

function Consumer() {
  const menus = usePageMenus();
  return (
    <div>
      <div data-testid="file">{menus.file.map((i) => i.label).join(',')}</div>
      <div data-testid="edit">{menus.edit.map((i) => i.label).join(',')}</div>
      {menus.file.map((item) => (
        <button key={item.id} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function Registrant({
  menu,
  items,
}: {
  menu: 'file' | 'edit';
  items: PageMenuItem[];
}) {
  useRegisterPageMenu(menu, items);
  return null;
}

describe('page-menu registry', () => {
  it('exposes an empty snapshot when nothing is registered', () => {
    render(
      <PageMenuProvider>
        <Consumer />
      </PageMenuProvider>
    );

    expect(screen.getByTestId('file')).toHaveTextContent('');
    expect(screen.getByTestId('edit')).toHaveTextContent('');
  });

  it('reflects items registered by a sibling and clears them on unmount', () => {
    const items: PageMenuItem[] = [
      { id: 'export', label: 'Export XML', onSelect: vi.fn() },
    ];

    const { rerender } = render(
      <PageMenuProvider>
        <Registrant menu="file" items={items} />
        <Consumer />
      </PageMenuProvider>
    );

    expect(screen.getByTestId('file')).toHaveTextContent('Export XML');

    // Unmounting the registrant (same provider instance) clears its menu.
    rerender(
      <PageMenuProvider>
        <Consumer />
      </PageMenuProvider>
    );

    expect(screen.getByTestId('file')).toHaveTextContent('');
  });

  it('invokes the registered onSelect handler', () => {
    const onSelect = vi.fn();
    const items: PageMenuItem[] = [{ id: 'go', label: 'Go', onSelect }];

    render(
      <PageMenuProvider>
        <Registrant menu="file" items={items} />
        <Consumer />
      </PageMenuProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps a referentially stable snapshot until a mutation occurs', () => {
    const { result } = renderHook(() => usePageMenuStore(), {
      wrapper: PageMenuProvider,
    });
    const store = result.current;

    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);

    store.setMenu('file', [{ id: 'a', label: 'A', onSelect: vi.fn() }]);
    const second = store.getSnapshot();
    expect(second).not.toBe(first);
    expect(second.file).toHaveLength(1);

    // Clearing an already-empty menu must not churn the snapshot reference.
    const beforeNoop = store.getSnapshot();
    store.clearMenu('edit');
    expect(store.getSnapshot()).toBe(beforeNoop);
  });

  it('throws when the store hook is used outside a provider', () => {
    expect(() => renderHook(() => usePageMenuStore())).toThrow(
      /within a PageMenuProvider/
    );
  });
});
