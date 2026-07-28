import AdminHeader from "@/components/AdminHeader";

/**
 * TEMPORARY PREVIEW ROUTE — delete before launch. Mock data only.
 * Tracked in project sheet.
 *
 * Exists to render the built components together on a real deployed URL so
 * the surface stack can be checked at full size. It is not a product page and
 * nothing links to it.
 *
 * This layout is the thing actually under test. Every stats-strip and
 * list-detail mockup sets `html, body { background: var(--gray-100) }`, but
 * StatsStrip and ListDetailLayout deliberately paint no background of their
 * own — the ground belongs to the route-group layout. This file rehearses
 * that division exactly as app/(admin)/layout.tsx will: gray-100 ground,
 * AdminHeader full-bleed above it, page content in a max-w-app container.
 *
 * If the division is right, the panes sit on an unbroken gray field. If it is
 * wrong, we see hard-edged bands or a paper-coloured gutter.
 *
 * The root layout paints the body bg-paper; the min-h-screen wrapper here
 * covers it, which is the same override the real admin layout will perform.
 */

export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      <AdminHeader
        currentPath="/admin/claims"
        userName="Demo Admin"
        userInitials="DA"
        pendingClaims={7}
        pendingLeads={12}
      />

      {/* .page-container — max-width 1480px, padding 32px (admin_claim_review) */}
      <main className="mx-auto max-w-app p-8">{children}</main>
    </div>
  );
}
