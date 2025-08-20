import { ButtonHTMLAttributes, forwardRef } from "react";
import { XmarkIcon } from './icons';

interface ToggleProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  children: React.ReactNode;
  className?: string;
  isToggled: boolean;
  onToggle: (toggled: boolean) => void;
  icon?: React.ReactNode;
}

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ className, children, isToggled, onToggle, icon, ...props }, ref) => {
    const handleClick = () => {
      onToggle(!isToggled);
    };

    return (
      <button
        ref={ref}
        onClick={handleClick}
        style={{ fontSize: '24px', lineHeight: '120%' }}
        className={`
          h-[72px]
          px-[24px]
          ${isToggled 
            ? 'bg-[#F5F5F5]/90 text-[#121C23]' 
            : 'bg-[#F5F5F5]/10 text-[#F5F5F5]'
          }
          
          rounded-full font-medium 
          transition-all duration-200
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className || ''}
        `}
        {...props}
      >
        <div className="flex items-center justify-center gap-2">
          {!isToggled && icon && (
            <span className="flex-shrink-0">
              {icon}
            </span>
          )}
          <span>{children}</span>
          {isToggled && (
            <span className="flex-shrink-0">
              <XmarkIcon size={32} />
            </span>
          )}
        </div>
      </button>
    );
  }
);

Toggle.displayName = "Toggle";
