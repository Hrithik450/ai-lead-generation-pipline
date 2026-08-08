import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Re-skinned from the shadcn radix-nova base into the paper idiom: a 2px ink
 * keyline, a full pill radius, and the hard offset shadow the whole product
 * shares. The lift/press choreography lives in `.btn-ink` in globals.css rather
 * than here, so a plain <Link className="btn-ink"> matches a <Button> exactly.
 *
 * Sizes run a notch taller than stock. The base scale is built for dense
 * application chrome; this dashboard is a reading surface first, and 32px pills
 * read as cramped against 15px Banda Nova.
 */
const buttonVariants = cva(
  "btn-ink group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap outline-none select-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /* The neutral action, and the safe default: white fill, ink keyline. */
        default: "bg-white hover:bg-cream",
        /* Blue marks the one action on a surface that commits — starting a run,
           approving a plan. Two of these on a page means neither reads. */
        primary: "bg-blue text-white",
        secondary: "bg-cream",
        destructive: "bg-red text-white",
        /* Borderless, for tertiary actions inside a card that already carries a
           keyline. Drops the stamp with it — nested shadows muddy each other. */
        ghost: "border-transparent shadow-none hover:bg-cream",
        link: "border-transparent shadow-none underline underline-offset-4",
      },
      size: {
        default: "h-10 gap-1.5 px-5 text-sm",
        sm: "h-8 gap-1 px-3.5 text-xs",
        lg: "h-12 gap-2 px-7 text-base",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
