import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "ink-input field-sizing-content min-h-24 text-base leading-relaxed focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
