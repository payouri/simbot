import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import "./index.css";
import { LiveConnection } from "./live/live";
import { TopGearPrototypeRoute } from "./prototype/top-gear/route";
import { QueuePage } from "./queue/QueuePage";
import { HistoryPage } from "./quick-sim/HistoryPage";
import { QuickSimPage } from "./quick-sim/QuickSimPage";
import { SimPage } from "./quick-sim/SimPage";
import { AppShell } from "./shell/AppShell";
import { SimcPage } from "./simc/SimcPage";

const queryClient = new QueryClient();

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/quick-sim" replace /> },
  { path: "/quick-sim", element: <QuickSimPage /> },
  { path: "/history", element: <HistoryPage /> },
  { path: "/sims/:id", element: <SimPage /> },
  { path: "/prototype/top-gear", element: <TopGearPrototypeRoute /> },
  {
    element: <AppShell />,
    children: [
      { path: "/simc", element: <SimcPage /> },
      { path: "/queue", element: <QueuePage /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LiveConnection />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
