import { useQuery } from '@tanstack/react-query';
import { http } from '../../api/client';

const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export function useProductList(params) {
  return useQuery({ queryKey: ['products', 'list', clean(params)], queryFn: () => http.get('/products', clean(params)), placeholderData: (p) => p });
}

export function useProduct(id) {
  return useQuery({ queryKey: ['products', 'detail', Number(id)], queryFn: () => http.get(`/products/${id}`).then((r) => r.data), enabled: Boolean(id) });
}

export function useProductCategories(options = {}) {
  return useQuery({ queryKey: ['product-categories'], queryFn: () => http.get('/product-categories').then((r) => r.data), staleTime: 60_000, ...options });
}

export function useSupplierOptions(options = {}) {
  return useQuery({ queryKey: ['suppliers', 'options'], queryFn: () => http.get('/suppliers', { limit: 100, status: 'active' }).then((r) => r.data), staleTime: 60_000, ...options });
}

export function useStockTransactions(params) {
  return useQuery({ queryKey: ['inventory', 'transactions', clean(params)], queryFn: () => http.get('/inventory/transactions', clean(params)), placeholderData: (p) => p });
}

export function useValuation() {
  return useQuery({ queryKey: ['inventory', 'valuation'], queryFn: () => http.get('/inventory/valuation').then((r) => r.data) });
}

export const inventoryApi = {
  createProduct: (body) => http.post('/products', body),
  updateProduct: (id, body) => http.patch(`/products/${id}`, body),
  deleteProduct: (id) => http.delete(`/products/${id}`),
  adjust: (body) => http.post('/inventory/adjust', body),
  createCategory: (body) => http.post('/product-categories', body),
  updateCategory: (id, body) => http.patch(`/product-categories/${id}`, body),
  deleteCategory: (id) => http.delete(`/product-categories/${id}`),
};

export const MOVEMENT_LABELS = {
  opening: 'Opening stock',
  purchase: 'Purchase received',
  sale: 'Sale',
  refund: 'Refund (returned)',
  adjustment: 'Stock count adjustment',
  stock_in: 'Stock in',
  stock_out: 'Stock out',
  damage: 'Damaged / expired',
  internal_use: 'Salon use',
};
