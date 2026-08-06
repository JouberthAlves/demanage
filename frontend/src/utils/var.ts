const apiUrl = import.meta.env.VITE_API_URL as string | undefined;

if (import.meta.env.PROD && !apiUrl?.trim()) {
  throw new Error(
    '[deManage] VITE_API_URL is required in production builds. Set it in the frontend env.',
  );
}

export const API_URL = apiUrl?.trim() || 'http://localhost:8888';
