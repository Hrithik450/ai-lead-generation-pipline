"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Runs" },
  { href: "/leads", label: "Leads" },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Main">
      {LINKS.map((link) => {
        /* Exact match for the index, prefix match elsewhere — otherwise "Runs"
           stays highlighted while you are reading a lead. A run detail page is
           still under Runs, so /runs/... counts too. */
        const active =
          link.href === "/"
            ? pathname === "/" || pathname.startsWith("/runs")
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex-none rounded-full border-2 border-ink px-4 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
              active ? "bg-ink text-white" : "bg-white hover:bg-cream",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
