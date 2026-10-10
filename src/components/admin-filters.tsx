'use client';

import { createContext, useContext } from 'react';

export const AdminFilters = createContext({ campus: 'all', days: 'all', search: '' });
export const useAdminFilters = () => useContext(AdminFilters);
