import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  type = "button",
  ...props
}) => {
  return (
    <button
      type={type}
      className={`px-3 py-1 text-sm bg-blue-600 text-white hover:bg-blue-700 uppercase ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
