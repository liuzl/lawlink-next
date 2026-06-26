/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        "card-foreground": "hsl(var(--card-foreground))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        border: "hsl(var(--border))",
        hairline: "hsl(var(--hairline))",
        destructive: "hsl(var(--destructive))",
        "status-green": "hsl(var(--status-green))",
        "status-orange": "hsl(var(--status-orange))",
        "status-red": "hsl(var(--status-red))",
        "status-purple": "hsl(var(--status-purple))",
        "status-blue": "hsl(var(--status-blue))",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
      },
      fontFamily: {
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};
