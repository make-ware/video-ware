'use client';

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';

/** Windowed page numbers around the current page (max 5). */
function getPageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
  const end = Math.min(totalPages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * Numbered prev/next pagination footer with edge ellipses. Renders nothing
 * for a single page. Page-state conventions: keep `page` in useState, derive
 * a clamped page (`totalPages > 0 ? Math.min(page, totalPages) : page`) for
 * both the query hook and this component, and reset to 1 inside search/tab
 * change handlers.
 */
export function PaginationControls({
  page,
  totalPages,
  onPageChange,
  className,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;

  const goTo = (p: number) =>
    onPageChange(Math.max(1, Math.min(totalPages, p)));

  const pageNumbers = getPageNumbers(page, totalPages);
  const showStartEllipsis = pageNumbers.length > 0 && pageNumbers[0] > 1;
  const showEndEllipsis =
    pageNumbers.length > 0 && pageNumbers[pageNumbers.length - 1] < totalPages;

  return (
    <Pagination className={className}>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={page === 1}
            className={
              page === 1 ? 'pointer-events-none opacity-50' : undefined
            }
            onClick={(e) => {
              e.preventDefault();
              goTo(page - 1);
            }}
          />
        </PaginationItem>

        {showStartEllipsis && (
          <>
            <PaginationItem>
              <PaginationLink
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  goTo(1);
                }}
              >
                1
              </PaginationLink>
            </PaginationItem>
            {pageNumbers[0] > 2 && (
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            )}
          </>
        )}

        {pageNumbers.map((p) => (
          <PaginationItem key={p}>
            <PaginationLink
              href="#"
              isActive={p === page}
              onClick={(e) => {
                e.preventDefault();
                goTo(p);
              }}
            >
              {p}
            </PaginationLink>
          </PaginationItem>
        ))}

        {showEndEllipsis && (
          <>
            {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
              <PaginationItem>
                <PaginationEllipsis />
              </PaginationItem>
            )}
            <PaginationItem>
              <PaginationLink
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  goTo(totalPages);
                }}
              >
                {totalPages}
              </PaginationLink>
            </PaginationItem>
          </>
        )}

        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={page === totalPages}
            className={
              page === totalPages ? 'pointer-events-none opacity-50' : undefined
            }
            onClick={(e) => {
              e.preventDefault();
              goTo(page + 1);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
