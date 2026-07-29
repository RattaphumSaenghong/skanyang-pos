import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import ProtectedRoute from '../components/ProtectedRoute';
import Layout from '../components/Layout';

const LoginPage = lazy(() => import('../pages/LoginPage'));
const PosSearchPage = lazy(() => import('../pages/pos/PosSearchPage'));
const QuotationPage = lazy(() => import('../pages/pos/QuotationPage'));
const CheckoutPage = lazy(() => import('../pages/pos/CheckoutPage'));
const StockDashboardPage = lazy(() => import('../pages/stock/StockDashboardPage'));
const ProductsImportPage = lazy(() => import('../pages/products/ProductsImportPage'));
const MarginsReportPage = lazy(() => import('../pages/reports/MarginsReportPage'));
const SalesReportPage = lazy(() => import('../pages/reports/SalesReportPage'));
const StockReportPage = lazy(() => import('../pages/reports/StockReportPage'));
const UsersSettingsPage = lazy(() => import('../pages/settings/UsersSettingsPage'));
const BayBoardPage = lazy(() => import('../pages/bays/BayBoardPage'));
const BaysSettingsPage = lazy(() => import('../pages/settings/BaysSettingsPage'));
const BayReportsPage = lazy(() => import('../pages/reports/BayReportsPage'));
const CustomerDisplayPage = lazy(() => import('../pages/display/CustomerDisplayPage'));

export default function App() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-gray-400">กำลังโหลด...</div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/display/:shopId" element={<CustomerDisplayPage />} />
        <Route path="/display/:shopId/:staffId" element={<CustomerDisplayPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/pos/search" replace />} />
          <Route path="pos/search" element={<PosSearchPage />} />
          <Route path="pos/quotation/:id" element={<QuotationPage />} />
          <Route path="pos/checkout/:id" element={<CheckoutPage />} />
          <Route path="stock/dashboard" element={<StockDashboardPage />} />
          <Route path="products/list" element={<ProductsImportPage />} />
          <Route path="products/import" element={<ProductsImportPage />} />
          <Route path="reports/margins" element={<MarginsReportPage />} />
          <Route path="reports/sales" element={<SalesReportPage />} />
          <Route path="reports/stock" element={<StockReportPage />} />
          <Route path="reports/bays" element={<BayReportsPage />} />
          <Route path="bays/board" element={<BayBoardPage />} />
          <Route path="settings/users" element={<UsersSettingsPage />} />
          <Route path="settings/bays" element={<BaysSettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/pos/search" replace />} />
      </Routes>
    </Suspense>
  );
}
