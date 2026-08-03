import axios from 'axios';

import { API_URL } from '@/utils/var';

export const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});
