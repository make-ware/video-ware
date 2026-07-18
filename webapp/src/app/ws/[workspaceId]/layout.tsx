import { ProtectedRoute } from '@/components/auth/protected-route';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
