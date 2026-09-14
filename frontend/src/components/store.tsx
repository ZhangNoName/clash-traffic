"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  keepPreviousData,
  useQueryClient,
} from "@tanstack/react-query";
import { api, post } from "@/lib/api";
import {
  defaults,
  initial,
  readFilters,
  query,
  type Filters,
  type Preferences,
  type Options,
  type Status,
  type Summary,
  type Details,
} from "@/lib/model";

type ContextValue = {
  filters: Filters;
  setFilters: (p: Partial<Filters>) => void;
  ready: boolean;
  preferences: Preferences;
  preference: (p: Partial<Preferences>) => Promise<void>;
  status?: Status;
  options?: Options;
  error: string;
  notice: string;
  notify: (s: string) => void;
  reset: () => void;
  csrf: string;
  refresh: () => void;
};
const Context = createContext<ContextValue | null>(null);
function TrafficProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient(),
    [filters, set] = useState<Filters>(initial),
    [preferences, setPrefs] = useState(defaults),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [notice, notify] = useState("");
  const latest = useRef(filters),
    prefsRef = useRef(preferences),
    savedVersion = useRef(0),
    queue = useRef(Promise.resolve());
  latest.current = filters;
  prefsRef.current = preferences;
  const status = useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api<Status>("/api/status", { signal }),
    refetchInterval: 5000,
  });
  const options = useQuery({
    queryKey: ["options"],
    queryFn: ({ signal }) => api<Options>("/api/options", { signal }),
    refetchInterval: 30000,
  });
  useEffect(() => {
    let live = true;
    api<Preferences>("/api/preferences")
      .then((p) => {
        if (live) {
          setPrefs(p);
          set(readFilters(location.search, p));
        }
      })
      .catch((e) => {
        if (live) {
          set(readFilters(location.search, defaults));
          setError("显示偏好读取失败：" + e.message);
        }
      })
      .finally(() => {
        if (live) setReady(true);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const pop = () => set(readFilters(location.search, prefsRef.current));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => notify(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const setFilters = useCallback((patch: Partial<Filters>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    set(next);
    window.history.replaceState(
      null,
      "",
      location.pathname + "?" + query(next),
    );
  }, []);
  const preference = async (patch: Partial<Preferences>) => {
    if (!status.data?.csrf) throw new Error("服务尚未就绪");
    const version = ++savedVersion.current,
      next = { ...prefsRef.current, ...patch };
    setPrefs(next);
    prefsRef.current = next;
    setFilters({ ...patch, ...(patch.app_mode ? { app: "" } : {}) });
    queue.current = queue.current
      .catch(() => {})
      .then(async () => {
        try {
          await post("/api/preferences", patch, status.data!.csrf);
          if (savedVersion.current === version) setError("");
        } catch (e) {
          const msg = e instanceof Error ? e.message : "请求失败";
          setError("显示已切换，但偏好未保存：" + msg);
        }
      });
    await queue.current;
  };
  const refresh = () => {
    void client.invalidateQueries();
  };
  return (
    <Context.Provider
      value={{
        filters,
        setFilters,
        ready,
        preferences,
        preference,
        status: status.data,
        options: options.data,
        error: error || (status.error?.message ?? ""),
        notice,
        notify,
        reset: () => setFilters(initial(prefsRef.current)),
        csrf: status.data?.csrf || "",
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10000, retry: 1, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TrafficProvider>{children}</TrafficProvider>
    </QueryClientProvider>
  );
}
export function useTraffic() {
  const c = useContext(Context);
  if (!c) throw new Error("Missing provider");
  return c;
}
export function useSummary() {
  const { filters, ready } = useTraffic();
  const { chart_type, detail_mode, ...statFilters } = filters;
  void chart_type;
  void detail_mode;
  return useQuery({
    queryKey: ["summary", statFilters],
    queryFn: ({ signal }) =>
      api<Summary>("/api/summary?" + query(filters), { signal }),
    enabled: ready,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
}
export function useDetails(offset = 0, override?: Partial<Filters>) {
  const { filters, ready } = useTraffic();
  const f = { ...filters, ...override };
  const { chart_type, granularity, group, ...detailFilters } = f;
  void chart_type;
  void granularity;
  void group;
  return useQuery({
    queryKey: ["details", detailFilters, offset],
    queryFn: ({ signal }) =>
      api<Details>("/api/details?" + query(f, { offset }), { signal }),
    enabled: ready,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
  });
}
