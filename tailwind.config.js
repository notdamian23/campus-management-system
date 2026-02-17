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
            colors: {
                // Primary Brand Red - Modern SaaS palette
                'primary': {
                    50: '#FEF2F2',
                    100: '#FEE2E2',    // Soft background
                    200: '#FECACA',
                    300: '#FCA5A5',
                    400: '#F87171',
                    500: '#DC2626',    // Main brand color
                    600: '#B91C1C',    // Hover state
                    700: '#991B1B',    // Active state
                    800: '#7F1D1D',
                    900: '#7b0000',    // Legacy dark
                    950: '#450A0A',
                    DEFAULT: '#DC2626',
                },
                // Background Palette
                'bg': {
                    main: '#FFFFFF',
                    subtle: '#FAFAFA',
                    muted: '#F3F4F6',
                    border: '#E5E7EB',
                },
                // Text Colors (Semantic)
                'text': {
                    primary: '#111827',      // Headings, strong emphasis
                    secondary: '#374151',    // Paragraphs, body text
                    muted: '#6B7280',        // Metadata, subtle info
                    disabled: '#9CA3AF',     // Disabled states
                    'on-primary': '#FFFFFF', // Text on red buttons
                },
                // Component-specific colors
                'border': {
                    DEFAULT: '#E5E7EB',
                    input: '#D1D5DB',
                    'input-focus': '#DC2626',
                },
                // Alert colors
                'alert': {
                    'error-bg': '#FEE2E2',
                    'error-text': '#991B1B',
                    'success-bg': '#DCFCE7',
                    'success-text': '#166534',
                    'warning-bg': '#FEF3C7',
                    'warning-text': '#92400E',
                },
            },
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
