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
                campusPrimary: "#7b0000",
                campusPrimaryDark: "#7A0000",
                campusAccent: "#F6C800",
            },
        },
    },
    plugins: [
        heroui({
            themes: {
                light: {
                    colors: {
                        primary: {
                            DEFAULT: "#7b0000",
                            foreground: "#ffffff",
                        },
                        secondary: {
                            DEFAULT: "#F6C800",
                            foreground: "#000000",
                        },
                    },
                },
            },
        }),
    ],
};
