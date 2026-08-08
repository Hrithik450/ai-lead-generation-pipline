import { cn } from "@/lib/utils";

/* Cream rather than a grey wash, so a loading row sits in the same palette as
   the table header it appears under. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-lg bg-cream", className)}
      {...props}
    />
  );
}

export { Skeleton };
