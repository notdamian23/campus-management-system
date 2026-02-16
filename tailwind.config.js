/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: "class",
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                campusPrimary: "#8B0000",
                campusPrimaryDark: "#7A0000",
                campusAccent: "#F6C800",
            },
        },
    },
    plugins: [],
};
