/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Chakra Petch"', '"PingFang SC"', '"Microsoft YaHei"', "sans-serif"],
        sans: ['"IBM Plex Sans"', '"PingFang SC"', '"Microsoft YaHei"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "Menlo", "Monaco", "monospace"],
      },
      colors: {
        ink: {
          950: "#070c15",
          900: "#0b1421",
          850: "#101b2d",
          800: "#152238",
          700: "#1c2d47",
        },
        slate: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#b8c4d4",
          500: "#9aa9bd",
          600: "#8493a9",
          700: "#687a92",
          800: "#4b5d75",
          900: "#33465e",
          950: "#1e3048",
        },
        edge: "rgba(148, 163, 184, 0.19)",
        cyan: {
          400: "#22d3ee",
          500: "#06b6d4",
        },
        acid: "#a3e635",
        violet: "#818cf8",
        rose: "#fb7185",
        amber: "#f59e0b",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,.18), 0 0 32px rgba(34,211,238,.10)",
        "glow-acid": "0 0 0 1px rgba(163,230,53,.18), 0 0 32px rgba(163,230,53,.10)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.45", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.35)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        rise: "rise .55s cubic-bezier(.22,.8,.32,1) both",
        pulseSoft: "pulseSoft 2.4s ease-in-out infinite",
        scan: "scan 9s linear infinite",
        shimmer: "shimmer 2.2s linear infinite",
      },
    },
  },
  plugins: [],
};
