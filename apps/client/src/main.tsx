import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import "./index.css";
import { TopGearPrototypeRoute } from "./prototype/top-gear/route";
import { QuickSimPage } from "./quick-sim/QuickSimPage";
import { SimPage } from "./quick-sim/SimPage";
import { SimcPage } from "./simc/SimcPage";

const queryClient = new QueryClient();

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/quick-sim" replace /> },
  { path: "/quick-sim", element: <QuickSimPage /> },
  { path: "/sims/:id", element: <SimPage /> },
  { path: "/prototype/top-gear", element: <TopGearPrototypeRoute /> },
  { path: "/simc", element: <SimcPage /> },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
