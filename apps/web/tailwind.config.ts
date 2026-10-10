import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#121316",
        ember: "#f97316",
        sand: "#f4ede4",
        slate: "#232732",
        glass: "rgba(255,255,255,0.2)",
      },
      boxShadow: {
        glow: "0 20px 60px rgba(18,19,22,0.35)",
      },
      fontFamily: {
        display: ["'Avenir Next Condensed'", "'Trebuchet MS'", "sans-serif"],
        body: ["'Avenir Next'", "'Helvetica Neue'", "sans-serif"],
      },
      backgroundImage: {
        "hero-gradient": "radial-gradient(circle at top left, #ffe8c2, #f6d4b7 40%, #e7a98b 70%, #8b4b39)",
        "glass-gradient": "linear-gradient(135deg, rgba(255,255,255,0.25), rgba(255,255,255,0.05))",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        fadeInUp: "fadeInUp 0.8s ease both",
      },
    },
  },
  plugins: [],
};

export default config;
