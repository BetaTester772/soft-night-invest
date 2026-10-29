import { act, render, screen } from '@testing-library/react';
import { useTurnstile, type Turnstile } from '../turnstile';
import { setLanguage } from '../../i18n';

interface Widget {
  action: string;
  language?: string;
  callback?: (t: string) => void;
  'error-callback'?: (code: string) => void;
  'before-interactive-callback'?: () => void;
}

/** window.turnstile 대역: render한 위젯의 callback을 테스트가 직접 부른다. */
function fakeTurnstile() {
  const widgets: Widget[] = [];
  const api = {
    render: vi.fn((_el: HTMLElement, opts: Widget) => {
      widgets.push(opts);
      return `w${widgets.length}`;
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  window.turnstile = api;
  return { api, widgets };
}

let hook: Turnstile;
function Harness({ siteKey }: { siteKey: string | null }) {
  hook = useTurnstile(siteKey, 'login');
  return <div data-testid="slot">{hook.widget}</div>;
}

afterEach(() => {
  delete window.turnstile;
  vi.useRealTimers();
});

describe('useTurnstile', () => {
  it('uses the selected language for security checks and recreates the widget on a language change', async () => {
    setLanguage('en');
    const { api, widgets } = fakeTurnstile();
    render(<Harness siteKey="site" />);
    await act(async () => {});
    expect(widgets[0]!.language).toBe('en');
    let pending!: Promise<string | undefined>;
    act(() => { pending = hook.take(); });
    expect(screen.getByRole('status')).toHaveTextContent('Checking security. Please wait.');
    act(() => widgets[0]!['before-interactive-callback']?.());
    expect(screen.getByRole('status')).toHaveTextContent('Click the security checkbox.');
    act(() => widgets[0]!['error-callback']?.('110200'));
    await expect(pending).rejects.toMatchObject({ message: '보안 확인 중 오류가 났습니다(110200). 페이지를 새로고침한 뒤 다시 시도해 주세요.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Security check failed (110200).');
    await act(async () => setLanguage('ko'));
    expect(api.remove).toHaveBeenCalledWith('w1');
    expect(widgets[1]!.language).toBe('ko');
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => widgets[1]!.callback?.('new-token'));
    await expect(hook.take()).resolves.toBe('new-token');
  });

  it('continues a pending security check after switching language', async () => {
    setLanguage('en');
    const { widgets } = fakeTurnstile();
    render(<Harness siteKey="site" />);
    await act(async () => {});
    let pending!: Promise<string | undefined>;
    act(() => { pending = hook.take(); });
    // Attach handlers before the effect cleanup can settle the request.
    const result = pending.then((token) => ({ token }), (error: unknown) => ({ error }));
    await act(async () => setLanguage('ko'));
    expect(hook.waiting).toBe(true);
    act(() => widgets[1]!.callback?.('replacement-token'));
    expect(await result).toEqual({ token: 'replacement-token' });
  });

  it('is a no-op without a site key', async () => {
    render(<Harness siteKey={null} />);
    expect(screen.getByTestId('slot')).toBeEmptyDOMElement();
    await expect(hook.take()).resolves.toBeUndefined();
  });

  it('renders the widget with the action and hands out each token once', async () => {
    const { api, widgets } = fakeTurnstile();
    render(<Harness siteKey="site" />);
    await act(async () => {});
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(widgets[0]!.action).toBe('login');

    act(() => widgets[0]!.callback?.('tok-1'));
    await expect(hook.take()).resolves.toBe('tok-1');
    // 꺼내면 새 토큰을 받도록 reset하고, 새 토큰이 올 때까지 기다린다.
    expect(api.reset).toHaveBeenCalledWith('w1');
    const next = hook.take();
    act(() => widgets[0]!.callback?.('tok-2'));
    await expect(next).resolves.toBe('tok-2');
  });

  it('removes the widget on unmount', async () => {
    const { api } = fakeTurnstile();
    const { unmount } = render(<Harness siteKey="site" />);
    await act(async () => {});
    unmount();
    expect(api.remove).toHaveBeenCalledWith('w1');
  });

  it('reports waiting (and asks for a click when interactive) until the token arrives', async () => {
    const { widgets } = fakeTurnstile();
    render(<Harness siteKey="site" />);
    await act(async () => {});
    let pending!: Promise<string | undefined>;
    act(() => {
      pending = hook.take();
    });
    expect(hook.waiting).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('보안 확인 중');
    act(() => widgets[0]!['before-interactive-callback']?.());
    expect(screen.getByRole('status')).toHaveTextContent('상자를 눌러');
    act(() => widgets[0]!.callback?.('tok'));
    await expect(pending).resolves.toBe('tok');
    await act(async () => {});
    expect(hook.waiting).toBe(false);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('throws the widget error instead of sending without a token', async () => {
    const { widgets } = fakeTurnstile();
    render(<Harness siteKey="site" />);
    await act(async () => {});
    let pending!: Promise<string | undefined>;
    act(() => {
      pending = hook.take();
    });
    act(() => widgets[0]!['error-callback']?.('110200'));
    await expect(pending).rejects.toMatchObject({ code: 'CAPTCHA_PENDING', message: expect.stringContaining('110200') });
    expect(screen.getByRole('alert')).toHaveTextContent('110200');
    // 오류가 남아 있는 동안은 기다리지 않고 바로 안내한다. 새 토큰이 오면 다시 쓸 수 있다.
    await expect(hook.take()).rejects.toMatchObject({ code: 'CAPTCHA_PENDING' });
    act(() => widgets[0]!.callback?.('tok'));
    await expect(hook.take()).resolves.toBe('tok');
  });

  it('gives up after a while with a message', async () => {
    fakeTurnstile();
    render(<Harness siteKey="site" />);
    await act(async () => {});
    vi.useFakeTimers();
    let pending!: Promise<string | undefined>;
    act(() => {
      pending = hook.take();
    });
    const check = expect(pending).rejects.toMatchObject({ message: expect.stringContaining('마치지 못했습니다') });
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await check;
  });
});
