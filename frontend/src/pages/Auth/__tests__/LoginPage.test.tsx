import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError, authApi, tokenStore, type Participant } from '../../../api';
import { AuthProvider } from '../../../auth/AuthContext';
import { ToastProvider } from '../../../components/ui';
import { setLanguage } from '../../../i18n';
import { LanguageSelector } from '../../../i18n/LanguageSelector';
import { LoginPage } from '../LoginPage';

const participant: Participant = {
  id: 1, nickname: '김공룡', status: 'normal', joined_at: '2026-10-29T09:00:00+09:00',
  masked_email: 'a***@g.skku.edu', verified: true, email_verified: true, needs_profile: false,
};

beforeEach(() => {
  tokenStore.set(null);
  setLanguage('en');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ signup: { turnstile_site_key: null } }))));
});
afterEach(() => {
  tokenStore.set(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function page() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/portfolio' } }]}>
      <AuthProvider>
        <ToastProvider>
          <LanguageSelector />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/portfolio" element={<p>Portfolio destination</p>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

it('shows the login form and links in English', async () => {
  page();
  await act(async () => {});
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Student ID' })).toBeInTheDocument();
  expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();
  expect(screen.getByText('10 digits. You can also sign in with your school email address.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Reset with school email' })).toHaveAttribute('href', '/reset-password');
  expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/register');
});

it('switches existing validation errors and labels without clearing input', async () => {
  const user = userEvent.setup();
  page();
  await user.type(screen.getByRole('textbox', { name: 'Student ID' }), '2026310000');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter both your student ID and password.');
  await user.click(screen.getByRole('button', { name: '한국어' }));
  expect(screen.getByRole('heading', { name: '로그인' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '학번' })).toHaveValue('2026310000');
  expect(screen.getByRole('alert')).toHaveTextContent('학번과 비밀번호를 모두 입력해 주세요.');
  await user.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter both your student ID and password.');
});

it.each([
  [new ApiError(401, 'INVALID_CREDENTIALS', '학번이나 비밀번호가 맞지 않습니다.'), 'Your student ID or password is incorrect. Please check and try again.'],
  [new ApiError(429, 'RATE_LIMITED', '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.'), 'Too many requests. Please try again shortly.'],
  [new ApiError(503, 'CAPTCHA_UNAVAILABLE', '지금은 보안 확인을 할 수 없습니다. 잠시 후 다시 시도하세요.'), 'The security check is currently unavailable. Please try again shortly.'],
  [new ApiError(403, 'CAPTCHA_FAILED', '보안 확인에 실패했습니다. 확인이 끝난 뒤 다시 시도하거나 페이지를 새로고침하세요.'), 'The security check failed. Complete the check and try again, or refresh the page.'],
  [new ApiError(0, 'CAPTCHA_PENDING', '보안 확인 중 오류가 났습니다(110200). 페이지를 새로고침한 뒤 다시 시도해 주세요.'), 'Security check failed (110200). Refresh the page and try again.'],
  [new Error('offline'), 'Unable to sign in. Please try again shortly.'],
])('translates login failures: %s', async (error, message) => {
  vi.spyOn(authApi, 'login').mockRejectedValue(error);
  const user = userEvent.setup();
  page();
  await user.type(screen.getByRole('textbox', { name: 'Student ID' }), '2026310000');
  await user.type(screen.getByLabelText(/^Password/), 'password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByLabelText(/^Password/)).toHaveValue('password');
  act(() => setLanguage('ko'));
  expect(screen.getByRole('button', { name: '로그인하기' })).toBeInTheDocument();
  if (error instanceof ApiError && error.code === 'CAPTCHA_PENDING') {
    expect(screen.getByRole('alert')).toHaveTextContent(error.message);
  }
});

it('greets the participant in English, preserves their nickname, and returns to the requested page', async () => {
  vi.spyOn(authApi, 'login').mockResolvedValue({ token: 'identity-token', participant });
  const user = userEvent.setup();
  page();
  await user.type(screen.getByRole('textbox', { name: 'Student ID' }), '2026310000');
  await user.type(screen.getByLabelText(/^Password/), 'password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Portfolio destination')).toBeInTheDocument();
  expect(screen.getByText('Welcome, 김공룡')).toBeInTheDocument();
});
