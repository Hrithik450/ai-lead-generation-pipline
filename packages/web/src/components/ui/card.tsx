import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The card, re-skinned onto `.ink-card`: 2px keyline, 1.25rem radius, and the
 * flat stamped shadow offset left and down.
 *
 * Stock ships `overflow-hidden` to clip images at the corners. That is dropped
 * here — this dashboard puts stickers and pills on card edges, and clipping ate
 * them. Any image inside one needs its own rounding.
 */
function Card({
  className,
  tone = "white",
  ...props
}: React.ComponentProps<"div"> & { tone?: "white" | "cream" }) {
  return (
    <div
      data-slot="card"
      data-tone={tone}
      className={cn(
        "ink-card group/card flex flex-col gap-(--card-spacing) py-(--card-spacing) text-sm [--card-spacing:--spacing(6)]",
        tone === "cream" && "bg-cream",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min items-start gap-1.5 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-heading text-xl leading-tight", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("caption text-sm", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  );
}

/* The footer's separator is a full-weight ink rule, not a hairline — a 1px grey
   line inside a 2px black frame reads as a rendering artifact. */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "mt-(--card-spacing) flex items-center gap-3 rounded-b-[calc(1.25rem-2px)] border-t-2 border-ink bg-cream px-(--card-spacing) py-4",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
