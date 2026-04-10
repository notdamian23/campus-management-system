/**
 * Standardized button styles following Campus design system.
 * Use with native HTML buttons for consistent styling.
 */
export const buttonStyles = {
  primary:
    "px-6 py-3 bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all focus:ring-4 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "px-6 py-3 bg-primary-100 hover:bg-primary-200 text-primary-700 font-semibold rounded-xl shadow-sm hover:shadow transition-all focus:ring-4 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "px-6 py-3 bg-transparent hover:bg-primary-100 text-primary-600 font-medium rounded-xl transition-all focus:ring-4 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
  danger:
    "px-6 py-3 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold rounded-xl shadow-md hover:shadow-lg transition-all focus:ring-4 focus:ring-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
  icon: "p-2 bg-transparent hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-lg transition-colors focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
  primarySm:
    "px-4 py-2 text-sm bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white font-semibold rounded-lg shadow-sm hover:shadow transition-all focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
  secondarySm:
    "px-4 py-2 text-sm bg-primary-100 hover:bg-primary-200 text-primary-700 font-semibold rounded-lg shadow-sm hover:shadow transition-all focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
  ghostSm:
    "px-4 py-2 text-sm bg-transparent hover:bg-primary-100 text-primary-600 font-medium rounded-lg transition-all focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50 disabled:cursor-not-allowed",
} as const;
