import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Input and Textarea both sit on `.ink-input`, so the focus state is the blue
 * offset stamp rather than a ring. The stock outline ring is suppressed here to
 * avoid drawing two focus indicators on the same element.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "ink-input text-base focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55 md:text-sm",
        "aria-invalid:focus:shadow-[-3px_3px_0_0_var(--red)]",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
