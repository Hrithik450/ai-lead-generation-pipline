import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The sticker, in the palette's own colours. Every run and domain status in the
 * product renders as one of these.
 *
 * Two rules hold across all variants. Fills are solid, never the 10%-alpha tints
 * stock uses — a washed fill behind a 2px black keyline reads as a disabled
 * control. And yellow is the only variant that keeps ink text: that yellow fails
 * contrast against white, so it appears exclusively as a fill.
 *
 * Colour is never the only signal — callers pass a word alongside. WCAG 2.2 AA
 * forbids conveying state by colour alone, and these badges are the primary
 * status channel on both the runs list and the domain table.
 */
const badgeVariants = cva(
  "sticker group/badge w-fit shrink-0 overflow-hidden [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-white",
        ok: "bg-green text-white",
        warn: "bg-yellow text-ink",
        danger: "bg-red text-white",
        info: "bg-blue text-white",
        /* Queued, idle, cancelled — anything not yet doing work. Muted text
           rather than a fill, so an inactive row does not compete with a live
           one for attention. */
        idle: "bg-white text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
