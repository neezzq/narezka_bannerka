import { MotionConfig } from "framer-motion";
import { WifiOff } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router-dom";
import { ActivityIndicator, Button, DialogHost, EmptyState, toast, ToastHost } from "@/components/ios";
import { t } from "@/i18n";
import { HomeScreen } from "@/screens/HomeScreen";
import { useApp } from "@/store/app";
import { resumeRenderJobs, useRenderJobs } from "@/store/backgroundJobs";

const SelectRangeScreen = lazy(() => import("@/screens/SelectRangeScreen"));
const EditorScreen = lazy(() => import("@/screens/EditorScreen"));

function Fallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <ActivityIndicator size={32} />
    </div>
  );
}

function NotFound() {
  const nav = useNavigate();
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState title={t("app.notFound")} action={<Button onClick={() => nav("/")}>{t("app.toHome")}</Button>} />
    </div>
  );
}

function BackgroundJobs() {
  const nav = useNavigate();
  useEffect(() => {
    resumeRenderJobs((tracked, job) => {
      if (useRenderJobs.getState().viewing === job.id) return;
      if (job.status === "done") {
        toast({
          title: t("export.ready"),
          message: t("export.readyToast", { title: tracked.title }),
          tone: "success",
          action: {
            label: t("export.open"),
            onClick: () => nav(`/p/${tracked.projectId}?export=${job.id}`),
          },
          duration: 10000,
        });
      } else if (job.status === "error") {
        toast({ title: t("export.failed"), message: job.error ?? undefined, tone: "error" });
      }
    });
  }, [nav]);
  return null;
}

function OfflineBanner() {
  const online = useApp((s) => s.online);
  if (online) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--safe-bottom)+8px)] z-[70] flex justify-center px-4" role="status">
      <div className="material-thick flex items-center gap-2 rounded-full px-4 py-2 text-footnote font-medium shadow-lg">
        <WifiOff size={16} className="text-warning" /> {t("app.offline")}
      </div>
    </div>
  );
}

export default function App() {
  const loadConfig = useApp((s) => s.loadConfig);
  const setOnline = useApp((s) => s.setOnline);
  useEffect(() => {
    loadConfig();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [loadConfig, setOnline]);

  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <BackgroundJobs />
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/new" element={<SelectRangeScreen />} />
            <Route path="/p/:id" element={<EditorScreen />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <ToastHost />
        <DialogHost />
        <OfflineBanner />
      </BrowserRouter>
    </MotionConfig>
  );
}
