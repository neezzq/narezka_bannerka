import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ReactNode } from "react";
import { ActivityIndicator } from "./ActivityIndicator";

type Variant = "filled" | "tinted" | "gray" | "plain" | "destructive" | "glass";
type Size = "lg" | "md" | "sm";

const variants: Record<Variant, string> = {
  filled: "bg-accent text-on-accent disabled:bg-fill disabled:text-label-3",
  tinted: "bg-accent/15 text-accent-text disabled:text-label-3 disabled:bg-fill-2",
  gray: "bg-fill-2 text-label disabled:text-label-3",
  plain: "bg-transparent text-accent-text disabled:text-label-3",
  destructive: "bg-danger/15 text-danger disabled:text-label-3",
  glass: "material text-label",
};

const sizes: Record<Size, string> = {
  lg: "h-[50px] px-6 text-headline font-semibold gap-2",
  md: "h-11 px-5 text-body font-semibold gap-2",
  sm: "h-8 px-3.5 text-subhead font-semibold gap-1.5 before:absolute before:-inset-y-1.5 before:inset-x-0",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "filled", size = "md", loading, icon, full, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      whileTap={disabled || loading ? undefined : { scale: 0.97, opacity: 0.8 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`relative inline-flex select-none items-center justify-center rounded-full whitespace-nowrap transition-colors disabled:cursor-not-allowed [&_svg]:shrink-0 ${variants[variant]} ${sizes[size]} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {loading ? <ActivityIndicator size={18} className={variant === "filled" ? "text-on-accent" : ""} /> : icon}
      {children && <span className={`min-w-0 truncate ${loading ? "opacity-80" : ""}`}>{children}</span>}
    </motion.button>
  );
});

export interface IconButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  label: string;
  children: ReactNode;
  tone?: "accent" | "label" | "danger" | "glass" | "filled";
  size?: number;
}

/** 44×44 hit area, icon centred. `label` is the VoiceOver text. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, tone = "accent", size = 44, className = "", disabled, ...rest },
  ref,
) {
  const toneCls = {
    accent: "text-accent-text",
    label: "text-label",
    danger: "text-danger",
    glass: "material text-label rounded-full",
    filled: "bg-accent text-on-accent rounded-full",
  }[tone];
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.9, opacity: 0.7 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full disabled:opacity-30 ${toneCls} ${className}`}
      {...rest}
    >
      {children}
    </motion.button>
  );
});
