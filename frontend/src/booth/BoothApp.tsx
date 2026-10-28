import { t, useLanguage, useDocumentLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "../auth/AuthContext";
import { LoginPage } from "../pages/Auth/LoginPage";
import { RegisterPage } from "../pages/Auth/RegisterPage";
import { ResetPasswordPage } from "../pages/Auth/ResetPasswordPage";
import { onUnauthorized } from "../api/client";
import { boothIdentityStore, boothTokenStore, tokenStore } from "../api/storage";
import { useApi } from "../api/useApi";
import {
  Button,
  Modal,
  Skeleton,
  TextField,
  ToastProvider,
} from "../components/ui";
import { boothApi } from "./api";
import { localizeBoothState } from "./localize";
import { LanguageSelector } from "../i18n/LanguageSelector";
import { AdminView } from "./AdminView";
import { BroadcastView } from "./BroadcastView";
import { FundsView } from "./FundsView";
import { MarketView } from "./MarketView";
import { PortfolioView } from "./PortfolioView";
import { RankingView } from "./RankingView";
import { TradeDialog } from "./TradeDialog";
import { time, won } from "./format";
import type { BoothConfig, TradeTarget } from "./types";
import styles from "./Booth.module.css";

function Countdown({
  end,
  now,
  scale = 1,
}: {
  end: string;
  now: string;
  scale?: number;
}) {
  useLanguage();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(
      () => setElapsed(((Date.now() - started) / 1000) * scale),
      1000,
    );
    return () => window.clearInterval(id);
  }, [now, scale]);
  const seconds = Math.max(
    0,
    Math.ceil(
      (new Date(end).getTime() - new Date(now).getTime()) / 1000 - elapsed,
    ),
  );
  return (
    <strong className={styles.countdown}>
      {Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0")}
      :{(seconds % 60).toString().padStart(2, "0")}
    </strong>
  );
}
function BoothShell({ config }: { config: BoothConfig }) {
  useLanguage();
  const auth = useAuth();
  const location = useLocation();
  const broadcast = location.pathname === "/broadcast";
  const admin = location.pathname === "/admin";
  const [linkAttempt, setLinkAttempt] = useState(0);
  const [token, setToken] = useState(() => boothTokenStore.get());
  const linkedSession = useRef<{ identity: string; booth: string } | null>(null);
  const identityToken = tokenStore.get();
  const sessionGeneration = useRef(0);
  const tokenRef = useRef(token);
  const [selected, setSelected] = useState<number>();
  const [joinOpen, setJoinOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [recovery, setRecovery] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<TradeTarget | null>(null);
  const state = useApi(
    () => boothApi.state(selected, token),
    [selected, token],
    {
      refreshInterval: 2000,
    },
  );
  const data = state.data ? localizeBoothState(state.data) : undefined;
  const currentRound = useRef(data?.round.id);
  currentRound.current = data?.round.id;
  function activateSession(next: string | null, persist = true) {
    sessionGeneration.current += 1;
    tokenRef.current = next;
    if (persist) boothTokenStore.set(next);
    setToken(next);
    setTarget(null);
    setJoinOpen(false);
    setJoinBusy(false);
    setError("");
  }
  useEffect(() => {
    if (auth.status !== "authenticated" || !identityToken) return;
    if (token !== boothTokenStore.get()) {
      syncSession();
      return;
    }
    const shared = boothIdentityStore.get();
    if (shared?.identity === identityToken && shared.booth === token) {
      linkedSession.current = shared;
      return;
    }
    if (linkedSession.current?.identity === identityToken && linkedSession.current.booth === token) return;
    let cancelled = false;
    const generation = sessionGeneration.current;
    const expected = tokenRef.current;
    void boothApi.session(identityToken).then((result) => {
      if (!cancelled && identityToken === tokenStore.get() && isCurrent(generation, expected)) {
        linkedSession.current = { identity: identityToken, booth: result.token };
        // Publish the association before the token's storage event reaches other tabs.
        boothIdentityStore.set(linkedSession.current);
        activateSession(result.token);
      }
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "계좌를 연결하지 못했습니다.");
    });
    return () => { cancelled = true; };
  }, [auth.status, identityToken, token, linkAttempt]);
  function syncSession() {
    const latest = boothTokenStore.get();
    if (latest !== tokenRef.current) activateSession(latest, false);
  }
  function isCurrent(generation: number, expected: string | null) {
    return (
      generation === sessionGeneration.current &&
      expected === tokenRef.current &&
      expected === boothTokenStore.get()
    );
  }
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage)
        return;
      if (event.key === "dino.booth.token" || event.key === null)
        syncSession();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.event;
    root.dataset.event = "booth";
    return () => {
      if (previous) root.dataset.event = previous;
      else delete root.dataset.event;
    };
  }, []);
  useEffect(
    () =>
      onUnauthorized((mode) => {
        if (mode === "booth") {
          activateSession(null);
          setError("참가 정보를 다시 확인하세요.");
        }
      }),
    [],
  );
  useEffect(() => {
    if (target && data && target.round_id !== data.round.id) setTarget(null);
  }, [target, data]);
  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (joinBusy) return;
    const generation = ++sessionGeneration.current;
    const expected = tokenRef.current;
    setJoinBusy(true);
    setError("");
    try {
      const result = await boothApi.join(nickname);
      if (isCurrent(generation, expected)) activateSession(result.token);
      else syncSession();
    } catch (err) {
      if (isCurrent(generation, expected))
        setError(err instanceof Error ? err.message : "참가하지 못했습니다.");
      else syncSession();
    } finally {
      if (generation === sessionGeneration.current) setJoinBusy(false);
    }
  }
  async function enroll() {
    if (!data) return;
    const id = data.round.id;
    const expected = tokenRef.current;
    const generation = sessionGeneration.current;
    if (expected !== boothTokenStore.get()) {
      syncSession();
      return;
    }
    try {
      await boothApi.enroll(id, expected);
      if (isCurrent(generation, expected) && currentRound.current === id)
        await state.refetch();
      else syncSession();
    } catch (err) {
      if (isCurrent(generation, expected))
        setError(err instanceof Error ? err.message : "참가하지 못했습니다.");
      else syncSession();
    }
  }
  function trade(next: TradeTarget) {
    if (tokenRef.current !== boothTokenStore.get()) {
      syncSession();
      return;
    }
    if (!data?.me) {
      setJoinOpen(true);
      return;
    }
    if (!data.me.enrolled) {
      setError("상단의 이 장에 참가하기를 눌러 시드를 받으세요.");
      return;
    }
    setTarget(next);
  }
  async function logout() {
    const expected = tokenRef.current;
    const generation = sessionGeneration.current;
    if (expected !== boothTokenStore.get()) {
      syncSession();
      return;
    }
    try {
      if (auth.status === "authenticated") await auth.logout();
      await boothApi.logout(expected);
      if (isCurrent(generation, expected)) activateSession(null);
      else syncSession();
    } catch (err) {
      if (isCurrent(generation, expected))
        setError(
          err instanceof Error ? err.message : "로그아웃하지 못했습니다.",
        );
      else syncSession();
    }
  }
  const lastEvent = data?.events.find(
    (e) => e.kind === "ghost" || e.kind === "meteor" || e.kind === "manual",
  );
  return (
    <div className={styles.app + (broadcast ? " " + styles.broadcast : "")}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brand} to="/">
            <span className={styles.logo} aria-hidden>
              <svg viewBox="0 0 30 30" fill="currentColor">
                <path d="M6 22v-7H3l-2-4 5 1 3-5h6l2-4h10v9h-7v4h-4v6h-3v5h-3v-5z" />
                <circle cx="23" cy="6" r="1" fill="#c8e59c" />
                <path d="M20 15h6v3h-6z" />
              </svg>
            </span>
            <span>
              <strong>{t("난 운석이 떨어진 줄 알았지")}</strong>
              <small>{t("소프트의 밤 · 공룡 귀신의 거래소")}</small>
            </span>
          </Link>
          {!broadcast && (
            <nav className={styles.nav} aria-label={t("주 메뉴")}>
              {[
                ["/", t("거래소")],
                ["/funds", t("에이전트 펀드")],
                ["/portfolio", t("내 자산")],
                ["/ranking", t("랭킹")],
              ].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to!}
                  end={to === "/"}
                  className={({ isActive }) => (isActive ? styles.active : "")}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className={styles.headerActions}>
            <LanguageSelector />
            <Link
              className={styles.outline}
              to={broadcast ? "/" : "/broadcast"}
            >
              {broadcast ? t("참가 화면") : t("↗ 부스 화면")}
            </Link>
            {!broadcast &&
              (data?.me ? (
                <>
                  <span>{data.me.nickname}{" "}{t("님")}</span>
                  <button className={styles.logout} onClick={logout}>{t("나가기")}</button>
                </>
              ) : (
                <>
                <Link className={styles.outline} to="/login">{t("로그인")}</Link>
                <Button
                  size="sm"
                  className={styles.solid}
                  onClick={() => setJoinOpen(true)}
                >
                  {t("참가하기")}
                </Button>
                </>
              ))}
          </div>
        </div>
      </header>
      <main className={styles.wrap}>
        {config.qa_tools && (
          <div className={styles.qaBanner}>{t("테스트 운영 모드 · 실제 행사 시각과 다를 수 있습니다.")}</div>
        )}
        {error && !joinOpen && (
          <div role="alert" className={styles.errorBanner}>
            {t(error)}
            {auth.status === "authenticated" &&
              (linkedSession.current?.identity !== identityToken || linkedSession.current?.booth !== token) && (
              <Button onClick={() => setLinkAttempt((value) => value + 1)}>{t("계좌 연결 다시 시도")}</Button>
            )}
            <button onClick={() => setError("")} aria-label={t("알림 닫기")}>
              ×
            </button>
          </div>
        )}
        {admin ? (
          <AdminView config={config} />
        ) : state.error && !data ? (
          <div className={styles.empty}>
            <h1>{t("거래소에 연결하지 못했습니다.")}</h1>
            <p>{t(state.error.message)}</p>
            <Button onClick={state.refetch}>{t("다시 연결하기")}</Button>
          </div>
        ) : !data ? (
          <Skeleton lines={8} />
        ) : (
          <>
            {state.error && (
              <div role="alert" className={styles.errorBanner}>{t("조회에 실패해 마지막 갱신 정보를 표시하고 있습니다.")}{" "}{t(state.error.message)}
                <Button onClick={state.refetch}>{t("다시 연결하기")}</Button>
              </div>
            )}
            <div className={styles.timeline} aria-label={t("장 일정")}>
              {data.rounds.map((r) => (
                <button
                  key={r.id}
                  className={
                    styles.era +
                    (r.id === data.round.id ? " " + styles.eraActive : "")
                  }
                  onClick={() => {
                    setSelected(r.id);
                    setTarget(null);
                    setError("");
                  }}
                  aria-pressed={r.id === data.round.id}
                >
                  <span className={styles.circle}>{r.id}</span>
                  <span>
                    <strong>{r.era}</strong>
                    <small>
                      {time(r.opens_at)} — {time(r.closes_at)}
                    </small>
                  </span>
                  <span className={styles.eraStatus}>
                    {r.is_open
                      ? t("거래 중")
                      : r.state === "closed"
                        ? t("종료")
                        : r.state === "paused"
                          ? t("정지")
                          : t("개장 예정")}
                  </span>
                </button>
              ))}
            </div>
            <div className={styles.sessionBar}>
              <span className={styles.pill}>
                <i />
                {t("{round}장 · {era}", { round: data.round.id, era: data.round.era })}
              </span>
              <div className={styles.connection}>
                <span>
                  {state.fetching
                    ? t("갱신 중")
                    : t("마지막 갱신 ") +
                      (data.round.published_at
                        ? time(data.round.published_at)
                        : t("개장 전"))}
                </span>
                {selected !== undefined && (
                  <button onClick={() => setSelected(undefined)}>{t("현재 장으로")}</button>
                )}
              </div>
              {data.round.is_open && (
                <div className={styles.clock}>
                  <small>{t("마감까지")}</small>
                  <Countdown
                    end={data.round.closes_at}
                    now={data.now}
                    scale={config.time_scale}
                  />
                </div>
              )}
            </div>
            {!data.round.is_open && (
              <div className={styles.notice}>
                {data.round.state === "paused"
                  ? (data.round.paused_reason ??
                    t("시세 갱신을 기다리고 있습니다."))
                  : data.round.state === "pending"
                    ? time(data.round.opens_at) + t("에 거래소가 열립니다.")
                    : t("거래가 종료되었습니다. 장별 랭킹에서 결과를 확인하세요.")}
              </div>
            )}
            {data.me && !data.me.enrolled && data.round.state !== "closed" && (
              <div className={styles.enrollBanner}>
                <span>{t("이번 장은 가상 시드 100만원으로 새로 시작합니다.")}</span>
                <Button onClick={enroll}>{t("이 장에 참가하기")}</Button>
              </div>
            )}
            {data.me?.disqualified && (
              <div role="alert" className={styles.errorBanner}>{t("이 장에서 실격 처리되었습니다.")}{" "}{data.me.reason}
              </div>
            )}
            {data.me?.enrolled && !broadcast && (
              <div className={styles.mobileCash}>{t("내 주문 가능 현금")}{" "}<strong>{won(data.me.cash)}</strong>
              </div>
            )}
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/"
                element={
                  <>
                    <div className={styles.intro}>
                      <h1>{t("공룡은 떠났고,")}{" "}<br />{t("주식은 남았다.")}</h1>
                      <p>
                        {
                          [
                            t("판게아 거래소 개장. 낮은 변동성에서 첫 투자를 시작하세요."),
                            t("초식공룡이 번성하자 사료주가 들썩입니다. 오늘의 기회를 찾아보세요."),
                            t("운석이 다가옵니다. 마지막 장에서 살아남으세요."),
                          ][data.round.id - 1]
                        }
                      </p>
                    </div>
                    {lastEvent && (
                      <div className={styles.eventBanner}>
                        <strong>{t("공룡 귀신 속보")}</strong>
                        <span>{lastEvent.headline}</span>
                        <small>{time(lastEvent.created_at)}</small>
                      </div>
                    )}
                    <MarketView data={data} onTrade={trade} />
                  </>
                }
              />
              <Route
                path="/funds"
                element={<FundsView data={data} onTrade={trade} />}
              />
              <Route
                path="/portfolio"
                element={
                  <PortfolioView
                    data={data}
                    onTrade={trade}
                    onJoin={() => setJoinOpen(true)}
                    onEnroll={enroll}
                  />
                }
              />
              <Route path="/ranking" element={<RankingView data={data} />} />
              <Route
                path="/broadcast"
                element={<BroadcastView data={data} config={config} />}
              />
              <Route
                path="*"
                element={
                  <div className={styles.empty}>
                    <h1>{t("길을 잃은 공룡인가요?")}</h1>
                    <Link to="/">{t("거래소로 돌아가기")}</Link>
                  </div>
                }
              />
            </Routes>
            {target && data && (
              <TradeDialog
                key={target.round_id + target.kind + target.code + target.side}
                target={target}
                data={data}
                sessionToken={token}
                onSessionChanged={syncSession}
                onClose={() => setTarget(null)}
                onFilled={() => {
                  setTarget(null);
                  void state.refetch();
                }}
              />
            )}
          </>
        )}
        <footer className={styles.footer}>
          <span>
            {config.event_day.replaceAll("-", ".")}{" "}{t("소프트의 밤 · 가상 투자 게임 · 실제 금전 거래 없음")}</span>
          <Link to="/admin">{t("운영자")}</Link>
        </footer>
      </main>
      <Modal
        open={joinOpen}
        onClose={() => {
          if (!joinBusy) setJoinOpen(false);
        }}
        title={t("거래소 참가")}
        description={t("닉네임으로 입장하고 가상 시드 100만원을 받아보세요.")}
      >
        <form onSubmit={join} className={styles.form}>
          <TextField
            label={t("닉네임")}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={32}
            required
            disabled={joinBusy}
          />
          <p className={styles.muted}>{t("같은 브라우저로 돌아오면 계좌가 이어집니다. 기기를 바꾸면 운영자에게 계좌 복구를 요청하세요.")}</p>
          {error && (
            <p role="alert" className={styles.error}>
              {t(error)}
            </p>
          )}
          <Button
            type="submit"
            fullWidth
            loading={joinBusy}
            className={styles.solid}
          >
            {t("거래소 입장하기")}
          </Button>
        </form>
        <details className={styles.recovery}>
          <summary>{t("운영자에게 복구 토큰을 받았나요?")}</summary>
          <TextField
            label={t("복구 토큰")}
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
            type="password"
            disabled={joinBusy}
          />
          <Button
            disabled={joinBusy || !recovery.trim()}
            onClick={() => {
              if (!joinBusy) activateSession(recovery.trim());
            }}
          >
            {t("계좌 복구하기")}
          </Button>
        </details>
      </Modal>
    </div>
  );
}
export function BoothApp({ config }: { config: BoothConfig }) {
  useDocumentLanguage();
  return (
    <ToastProvider>
      <AuthProvider><BoothShell config={config} /></AuthProvider>
    </ToastProvider>
  );
}
