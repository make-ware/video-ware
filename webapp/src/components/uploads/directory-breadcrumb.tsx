'use client';

import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import React from 'react';

interface DirectoryBreadcrumbProps {
  breadcrumbs: { id: string; name: string }[];
  onNavigate: (directoryId: string | null) => void;
}

export function DirectoryBreadcrumb({
  breadcrumbs,
  onNavigate,
}: DirectoryBreadcrumbProps) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {breadcrumbs.length === 0 ? (
            <BreadcrumbPage>Root</BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(null);
              }}
            >
              All
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return (
            <React.Fragment key={crumb.id}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.name}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate(crumb.id);
                    }}
                  >
                    {crumb.name}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
