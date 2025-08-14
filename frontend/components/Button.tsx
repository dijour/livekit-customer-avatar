import { motion, MotionProps } from "framer-motion";
import { ButtonHTMLAttributes, forwardRef } from "react";

// Button variants
const buttonVariants = {
  primary: "bg-[#0074B8]/20 text-[#0ABEFF] hover:bg-[#0074B8]/35",
//   secondary: "bg-white text-black hover:bg-white/90",
//   danger: "bg-red-500/80 text-white hover:bg-red-500/90",
//   ghost: "bg-transparent text-white hover:bg-white/10",
};

// Button sizes
const buttonSizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-base",
  lg: "px-6 py-3 text-[28px] leading-[120%]",
};

interface ButtonProps 
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps>,
    MotionProps {
  variant?: keyof typeof buttonVariants;
  size?: keyof typeof buttonSizes;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

// Default animation props for consistency
const defaultAnimationProps: MotionProps = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.2, ease: "easeOut" },
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.98 },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "lg",
      className,
      children,
      disabled,
      initial,
      animate,
      exit,
      transition,
      whileHover,
      whileTap,
      ...props
    },
    ref
  ) => {
    // Merge custom animation props with defaults
    const animationProps: MotionProps = {
      initial: initial ?? defaultAnimationProps.initial,
      animate: animate ?? defaultAnimationProps.animate,
      exit: exit ?? defaultAnimationProps.exit,
      transition: transition ?? defaultAnimationProps.transition,
      whileHover: disabled ? undefined : (whileHover ?? defaultAnimationProps.whileHover),
      whileTap: disabled ? undefined : (whileTap ?? defaultAnimationProps.whileTap),
    };

    return (
      <motion.button
        ref={ref}
        className={cn(
          // Base styles
          "rounded-full font-medium transition-colors duration-200",
        //   "focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          // Variant styles
          buttonVariants[variant],
          // Size styles
          buttonSizes[size],
          className
        )}
        disabled={disabled}
        {...animationProps}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);

Button.displayName = "Button";

// Utility function for className merging (if not already available)
// You can replace this with your existing cn utility if you have one
function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(" ");
}
