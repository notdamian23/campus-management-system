/** @type {import('tailwindcss').Config} */
const { heroui } = require("@heroui/theme");

module.exports = {
    darkMode: "class",
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./node_modules/@heroui/theme/dist/components/**/*.js",
    ],
    theme: {
        extend: {
            // Colors are defined in globals.css using @theme directive (Tailwind v4)
        },
    },
    plugins: [
        heroui({
            themes: {
                light: {
                    colors: {
                        primary: {
                            50: '#FEF2F2',
                            100: '#FEE2E2',
                            200: '#FECACA',
                            300: '#FCA5A5',
                            400: '#F87171',
                            500: '#DC2626',
                            600: '#B91C1C',
                            700: '#991B1B',
                            800: '#7F1D1D',
                            900: '#7b0000',
                            DEFAULT: "#DC2626",
                            foreground: "#FFFFFF",
                        },
                        secondary: {
                            50: '#FEF2F2',
                            100: '#FEE2E2',
                            200: '#FECACA',
                            300: '#FCA5A5',
                            400: '#F87171',
                            500: '#EF4444',
                            600: '#DC2626',
                            DEFAULT: "#FEE2E2",
                            foreground: "#B91C1C",
                        },
                        success: {
                            DEFAULT: "#16A34A",
                            foreground: "#FFFFFF",
                        },
                        warning: {
                            DEFAULT: "#F59E0B",
                            foreground: "#FFFFFF",
                        },
                        danger: {
                            DEFAULT: "#EF4444",
                            foreground: "#FFFFFF",
                        },
                        default: {
                            DEFAULT: "#F3F4F6",
                            foreground: "#111827",
                        },
                    },
                },
            },
        }),
    ],
};
