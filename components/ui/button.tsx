import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white hover:opacity-90",
        outline:
          "border border-line bg-surface-raised text-ink hover:bg-brand-tint hover:text-ink",
        ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink",
        subtle: "bg-brand-tint text-brand hover:opacity-90",
      },
      size: {
        // 44px minimum touch target on the default and icon sizes.
        sm: "h-9 px-3 text-xs",
        md: "h-11 px-4",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
