// Centralized API URL — reads from environment variable in production,
// falls back to localhost for local development.
// In Vercel, set VITE_API_URL to your Render.com backend URL.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
