import * as React from "react";
import { clsx } from "clsx";

interface TooltipProps {
  content: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
  show?: boolean;
}

export function Tooltip({ content, side = "right", children, show = true }: TooltipProps) {
  const [isVisible, setIsVisible] = React.useState(false);

  if (!show) return <>{children}</>;

  const positions = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={clsx(
            "absolute z-50 px-2 py-1 text-xs font-medium text-white bg-gray-900 rounded whitespace-nowrap",
            positions[side]
          )}
        >
          {content}
        </div>
      )}
    </div>
  );
}
