import { WorkspaceTabs } from '@/components/layout/workspace-tabs';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <WorkspaceTabs />
      {children}
    </>
  );
}
