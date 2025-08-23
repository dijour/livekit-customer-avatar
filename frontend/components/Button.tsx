import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
  width?: string;
  height?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, children, width, height, ...props }, ref) => {
    return (
      <button
        ref={ref}
        style={{ 
          fontSize: '24px', 
          lineHeight: '120%',
          ...(width && { width, minWidth: width }),
          ...(height && { height, minHeight: height })
        }}
        className={`
          ${!width ? 'min-w-[208px]' : ''}
          ${!height ? 'h-[72px]' : ''}
          px-[24px]
          bg-[#0074B8]/20 text-[#0ABEFF] 
          hover:bg-[#0074B8]/35
          rounded-full font-medium 
          transition-colors duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className || ''}
        `}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
